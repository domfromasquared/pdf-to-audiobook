"use client";

import { useMemo, useState } from "react";

type Chapter = {
  index: number;
  title: string;
  startPage: number;
  endPage: number;
};

type ChapterStatus = "ready" | "generating" | "done" | "error";
type DocType = "book" | "report" | "paper" | "slides" | "manual" | "unknown";

const voiceOptions = ["Iapetus", "Enceladus", "Orus", "Leda", "Callirrhoe"] as const;
type VoiceOption = (typeof voiceOptions)[number];

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [extractedUrl, setExtractedUrl] = useState<string | null>(null);

  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [docType, setDocType] = useState<DocType>("unknown");

  const [selectedVoice, setSelectedVoice] = useState<VoiceOption>("Iapetus");

  const [generating, setGenerating] = useState(false);
  const [chapterDownloads, setChapterDownloads] = useState<Record<number, string>>({});
  const [chapterStatus, setChapterStatus] = useState<Record<number, ChapterStatus>>({});
  const [chapterErrors, setChapterErrors] = useState<Record<number, string>>({});

  const [error, setError] = useState<string | null>(null);

  const previewUrl = useMemo(
    () => `/previews/${selectedVoice.toLowerCase()}.mp3`,
    [selectedVoice]
  );

  const readyForGeneration = useMemo(
    () => Boolean(pdfUrl) && Boolean(chapters?.length) && !uploading && !detecting,
    [pdfUrl, chapters, uploading, detecting]
  );

  const canGenerateAll = useMemo(
    () => readyForGeneration && !generating,
    [readyForGeneration, generating]
  );

  const statusText = useMemo(() => {
    if (uploading) return "Uploading PDF…";
    if (detecting) return "Detecting chapters…";
    if (chapters?.length) return `Ready • ${chapters.length} sections • ${numPages ?? "?"} pages`;
    return "Upload a PDF to begin";
  }, [uploading, detecting, chapters, numPages]);

  async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs = 240000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const raw = await res.text();
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {}
      return { res, raw, data };
    } finally {
      clearTimeout(timer);
    }
  }

  async function detectChaptersForUrl(uploadedPdfUrl: string) {
    if (!uploadedPdfUrl || typeof uploadedPdfUrl !== "string") {
      setError("Upload succeeded, but no PDF URL was available for chapter detection.");
      return;
    }

    setDetecting(true);
    setError(null);

    setChapters(null);
    setNumPages(null);
    setDocType("unknown");
    setExtractedUrl(null);

    // reset generation (new doc)
    setGenerating(false);
    setChapterDownloads({});
    setChapterStatus({});
    setChapterErrors({});

    try {
      let res = await fetch("/api/chapters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfUrl: uploadedPdfUrl, url: uploadedPdfUrl }),
      });

      if (res.status === 405) {
        const qs = new URLSearchParams({ pdfUrl: uploadedPdfUrl });
        res = await fetch(`/api/chapters?${qs.toString()}`, { method: "GET" });
      }

      const contentType = res.headers.get("content-type") || "";
      const raw = await res.text();
      let data: any = null;
      try {
        data = raw && contentType.includes("application/json") ? JSON.parse(raw) : null;
      } catch {}

      if (!res.ok) {
        const fallbackMsg = contentType.includes("text/html")
          ? `Detect chapters failed (${res.status}) — server returned HTML instead of JSON.`
          : `Detect chapters failed (${res.status})`;
        const stepSuffix =
          data?.step && typeof data.step === "string" ? ` [step: ${data.step}]` : "";
        setError((data?.error || fallbackMsg) + stepSuffix);
        setDetecting(false);
        return;
      }

      if (!data?.chapters || !Array.isArray(data.chapters)) {
        setError(`Detect chapters succeeded but response missing chapters. Raw: ${raw}`);
        setDetecting(false);
        return;
      }

      setNumPages(typeof data?.numPages === "number" ? data.numPages : null);
      setChapters(data.chapters);
      setExtractedUrl(typeof data?.extractedUrl === "string" ? data.extractedUrl : null);
      setDocType(
        data?.docType === "book" ||
          data?.docType === "report" ||
          data?.docType === "paper" ||
          data?.docType === "slides" ||
          data?.docType === "manual"
          ? data.docType
          : "unknown"
      );

      const initialStatus: Record<number, ChapterStatus> = {};
      for (const ch of data.chapters as Chapter[]) initialStatus[ch.index] = "ready";
      setChapterStatus(initialStatus);

      setDetecting(false);
    } catch (e: any) {
      setError(e?.message || "Detect chapters failed");
      setDetecting(false);
    }
  }

  async function uploadPdf() {
    if (!file) return;

    setUploading(true);
    setError(null);

    setPdfUrl(null);
    setExtractedUrl(null);
    setChapters(null);
    setNumPages(null);
    setDocType("unknown");

    // reset generation
    setGenerating(false);
    setChapterDownloads({});
    setChapterStatus({});
    setChapterErrors({});

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const raw = await res.text();

      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {}

      if (!res.ok) {
        setError(data?.error || raw || `Upload failed (${res.status})`);
        setUploading(false);
        return;
      }

      const uploadedPdfUrl = (data?.pdfUrl || data?.url) as string | undefined;
      if (!uploadedPdfUrl) {
        setError(`Upload succeeded but response missing pdfUrl/url. Raw: ${raw}`);
        setUploading(false);
        return;
      }
      setPdfUrl(uploadedPdfUrl);
      setUploading(false);

      // Auto-detect chapters
      await detectChaptersForUrl(uploadedPdfUrl);
    } catch (e: any) {
      setError(e?.message || "Upload failed");
      setUploading(false);
    }
  }

  async function generateOneChapter(ch: Chapter) {
    if (!pdfUrl) return;

    setError(null);
    setChapterErrors((prev) => ({ ...prev, [ch.index]: "" }));
    setChapterStatus((prev) => ({ ...prev, [ch.index]: "generating" }));

    try {
      const { res, raw, data } = await fetchJsonWithTimeout(
        "/api/render-chapter",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pdfUrl,
            extractedUrl,
            startPage: ch.startPage,
            endPage: ch.endPage,
            chapterIndex: ch.index,
            chapterTitle: ch.title,
            voiceKey: selectedVoice,
            docType,
            totalChapters: chapters?.length || 0,
          }),
        },
        240000
      );

      if (!res.ok) {
        const msg = data?.error || raw || `Render failed (${res.status})`;
        setChapterStatus((prev) => ({ ...prev, [ch.index]: "error" }));
        setChapterErrors((prev) => ({ ...prev, [ch.index]: msg }));
        return;
      }

      if (!data?.downloadUrl) {
        const msg = `Missing downloadUrl. Raw: ${raw}`;
        setChapterStatus((prev) => ({ ...prev, [ch.index]: "error" }));
        setChapterErrors((prev) => ({ ...prev, [ch.index]: msg }));
        return;
      }

      setChapterDownloads((prev) => ({ ...prev, [ch.index]: data.downloadUrl }));
      setChapterStatus((prev) => ({ ...prev, [ch.index]: "done" }));
    } catch (e: any) {
      const msg =
        e?.name === "AbortError"
          ? "Generation timed out after 4 minutes. Try a smaller chapter/page range."
          : e?.message || "Failed generating chapter";
      setChapterStatus((prev) => ({ ...prev, [ch.index]: "error" }));
      setChapterErrors((prev) => ({ ...prev, [ch.index]: msg }));
    }
  }

  async function generateAllChapters() {
    if (!pdfUrl || !chapters?.length) return;

    setGenerating(true);
    setError(null);
    setChapterErrors({});

    const reset: Record<number, ChapterStatus> = {};
    for (const ch of chapters) reset[ch.index] = chapterDownloads[ch.index] ? "done" : "ready";
    setChapterStatus(reset);

    try {
      for (const ch of chapters) {
        if (chapterDownloads[ch.index]) continue;

        setChapterStatus((prev) => ({ ...prev, [ch.index]: "generating" }));

        const { res, raw, data } = await fetchJsonWithTimeout(
          "/api/render-chapter",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pdfUrl,
              extractedUrl,
              startPage: ch.startPage,
              endPage: ch.endPage,
              chapterIndex: ch.index,
              chapterTitle: ch.title,
              voiceKey: selectedVoice,
              docType,
              totalChapters: chapters.length,
            }),
          },
          240000
        );

        if (!res.ok) {
          const msg = data?.error || raw || `Render failed (${res.status})`;
          setChapterStatus((prev) => ({ ...prev, [ch.index]: "error" }));
          setChapterErrors((prev) => ({ ...prev, [ch.index]: msg }));
          throw new Error(msg);
        }

        if (!data?.downloadUrl) {
          const msg = `Missing downloadUrl. Raw: ${raw}`;
          setChapterStatus((prev) => ({ ...prev, [ch.index]: "error" }));
          setChapterErrors((prev) => ({ ...prev, [ch.index]: msg }));
          throw new Error(msg);
        }

        setChapterDownloads((prev) => ({ ...prev, [ch.index]: data.downloadUrl }));
        setChapterStatus((prev) => ({ ...prev, [ch.index]: "done" }));
      }
    } catch (e: any) {
      const msg =
        e?.name === "AbortError"
          ? "Generation timed out after 4 minutes. Try generating one chapter at a time."
          : e?.message || "Failed generating chapters";
      setError(msg);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.bgGlowA} />
      <div style={styles.bgGlowB} />
      <div style={styles.bgGrid} />

      <div style={styles.shell}>
        <header style={styles.header}>
          <div style={styles.brandRow}>
            <div style={styles.logoMark} aria-hidden />
            <div>
              <div style={styles.brand}>PDF → Chapter Audiobook</div>
              <div style={styles.subBrand}>
                Upload a PDF, pick a voice, download per-chapter MP3s.
              </div>
            </div>
          </div>
        </header>

        {/* Top row: Upload + Voice */}
        <section style={styles.topGrid}>
          <div style={styles.card}>
            <div style={styles.cardTitleRow}>
              <h2 style={styles.cardTitle}>1) Upload PDF</h2>
              <div style={styles.cardHint}>{statusText}</div>
            </div>

            <div style={styles.uploadRow}>
              <label style={styles.fileLabel}>
                <input
                  type="file"
                  accept="application/pdf"
                  style={styles.fileInput}
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setFile(f);
                    setError(null);
                  }}
                />
                <span style={styles.fileButton}>Choose PDF</span>
                <span style={styles.fileName}>{file ? file.name : "No file selected"}</span>
              </label>

              <button
                style={styles.primaryButton}
                onClick={uploadPdf}
                disabled={!file || uploading || detecting}
              >
                {uploading ? "Uploading…" : detecting ? "Detecting…" : "Upload"}
              </button>
            </div>

            {pdfUrl && (
              <div style={styles.smallRow}>
                <a style={styles.link} href={pdfUrl} target="_blank" rel="noreferrer">
                  Open uploaded PDF
                </a>
              </div>
            )}
          </div>

          <div style={styles.card}>
            <div style={styles.cardTitleRow}>
              <h2 style={styles.cardTitle}>2) Voice</h2>
              <div style={styles.cardHint}>Preview instantly</div>
            </div>

            <div style={styles.voiceRow}>
              <select
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value as VoiceOption)}
                style={styles.select}
              >
                {voiceOptions.map((v) => (
                  <option key={v} value={v} style={{ color: "#111" }}>
                    {v}
                  </option>
                ))}
              </select>

              <audio controls preload="none" src={previewUrl} style={styles.audio} />
            </div>

            
          </div>
        </section>

        {/* Chapters */}
        <section style={styles.card}>
          <div style={styles.cardTitleRow}>
            <h2 style={styles.cardTitle}>3) Chapters</h2>
            <div style={styles.cardHint}>
              {detecting
                ? "Detecting…"
                : chapters?.length
                ? `${chapters.length} sections • ${numPages ?? "?"} pages`
                : "Waiting for upload"}
            </div>
          </div>

          <div style={styles.actionsRow}>
            <button
              style={{
                ...styles.primaryButton,
                opacity: canGenerateAll ? 1 : 0.55,
                cursor: canGenerateAll ? "pointer" : "not-allowed",
              }}
              onClick={generateAllChapters}
              disabled={!canGenerateAll}
            >
              {generating ? "Generating…" : "Generate all MP3s"}
            </button>

            <span style={{ ...styles.pill, opacity: readyForGeneration ? 1 : 0.5 }}>
              voice: {selectedVoice}
            </span>

            <span style={{ ...styles.pill, opacity: extractedUrl ? 1 : 0.5 }}>
              status {extractedUrl ? "ready" : "not ready"}
            </span>
          </div>

          {!chapters && (
            <div style={styles.emptyState}>
              Upload a PDF and we’ll automatically detect chapters.
            </div>
          )}

          {chapters && (
            <div style={styles.chapterList}>
              {chapters.map((ch) => {
                const status = chapterStatus[ch.index] || "ready";
                const dl = chapterDownloads[ch.index];
                const chErr = chapterErrors[ch.index];

                return (
                  <div key={ch.index} style={styles.chapterItem}>
                    <div style={styles.chapterLeft}>
                      <div style={styles.chapterIndex}>{String(ch.index).padStart(2, "0")}</div>
                      <div style={styles.chapterMeta}>
                        <div style={styles.chapterTitleText}>{ch.title}</div>
                        <div style={styles.chapterPages}>
                          Pages {ch.startPage}–{ch.endPage}
                        </div>
                        {status === "error" && chErr && (
                          <div style={styles.chapterError}>{chErr}</div>
                        )}
                      </div>
                    </div>

                    <div style={styles.chapterRight}>
                      {status === "generating" ? (
                        <span style={styles.badgeMuted}>generating…</span>
                      ) : dl ? (
                        <>
                          <a style={styles.downloadLink} href={dl}>
                            Download MP3
                          </a>
                          <button
                            style={styles.secondaryButton}
                            onClick={() => generateOneChapter(ch)}
                            disabled={generating || detecting}
                          >
                            Regenerate
                          </button>
                        </>
                      ) : (
                        <button
                          style={styles.secondaryButton}
                          onClick={() => generateOneChapter(ch)}
                          disabled={!readyForGeneration || generating}
                        >
                          Generate
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {error && (
          <section style={styles.errorCard} role="alert">
            <div style={styles.errorTitle}>Error</div>
            <div style={styles.errorText}>{error}</div>
          </section>
        )}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#050511",
    color: "white",
    position: "relative",
    overflow: "hidden",
  },
  bgGlowA: {
    position: "absolute",
    inset: "-30%",
    background:
      "radial-gradient(60% 60% at 25% 25%, rgba(255, 0, 153, 0.25) 0%, rgba(255, 0, 153, 0.0) 55%), radial-gradient(50% 50% at 70% 40%, rgba(0, 229, 255, 0.22) 0%, rgba(0, 229, 255, 0.0) 60%)",
    filter: "blur(30px)",
    pointerEvents: "none",
  },
  bgGlowB: {
    position: "absolute",
    inset: "-30%",
    background:
      "radial-gradient(55% 55% at 55% 85%, rgba(124, 58, 237, 0.25) 0%, rgba(124, 58, 237, 0.0) 60%), radial-gradient(40% 40% at 85% 20%, rgba(255, 122, 0, 0.15) 0%, rgba(255, 122, 0, 0.0) 60%)",
    filter: "blur(40px)",
    pointerEvents: "none",
  },
  bgGrid: {
    position: "absolute",
    inset: 0,
    backgroundImage:
      "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
    backgroundSize: "48px 48px",
    maskImage: "radial-gradient(circle at 40% 15%, black 0%, transparent 55%)",
    opacity: 0.35,
    pointerEvents: "none",
  },

  shell: { position: "relative", maxWidth: 1040, margin: "0 auto", padding: "42px 18px 30px" },

  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 18 },
  brandRow: { display: "flex", gap: 12, alignItems: "center" },
  logoMark: {
    width: 44,
    height: 44,
    borderRadius: 14,
    background:
      "linear-gradient(135deg, rgba(255,0,153,0.9), rgba(0,229,255,0.85), rgba(124,58,237,0.9))",
    boxShadow:
      "0 0 0 1px rgba(255,255,255,0.12), 0 18px 50px rgba(0,229,255,0.12), 0 18px 55px rgba(255,0,153,0.10)",
  },
  brand: { fontSize: 28, fontWeight: 800, letterSpacing: 0.2, lineHeight: 1.1 },
  subBrand: { marginTop: 4, color: "rgba(255,255,255,0.72)", fontSize: 13, lineHeight: 1.35, maxWidth: 560 },

  pillRow: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
  pill: {
    fontSize: 12,
    color: "rgba(255,255,255,0.78)",
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    backdropFilter: "blur(10px)",
  },

  topGrid: { display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 14, marginBottom: 14 },

  card: {
    borderRadius: 18,
    background: "rgba(8, 10, 24, 0.55)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 0 0 1px rgba(255,255,255,0.02), 0 18px 80px rgba(0,0,0,0.40)",
    backdropFilter: "blur(16px)",
    padding: 16,
  },

  cardTitleRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 12 },
  cardTitle: { margin: 0, fontSize: 16, fontWeight: 800, letterSpacing: 0.2 },
  cardHint: { fontSize: 12, color: "rgba(255,255,255,0.62)" },

  uploadRow: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" },

  fileLabel: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.05)",
    flex: "1 1 420px",
    minWidth: 240,
  },
  fileInput: { display: "none" },
  fileButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 10px",
    borderRadius: 12,
    background: "linear-gradient(135deg, rgba(255,0,153,0.9), rgba(124,58,237,0.9))",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "white",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.2,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  fileName: { fontSize: 13, color: "rgba(255,255,255,0.72)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },

  primaryButton: {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "linear-gradient(135deg, rgba(0,229,255,0.85), rgba(124,58,237,0.90))",
    color: "white",
    fontWeight: 800,
    fontSize: 13,
    letterSpacing: 0.2,
    cursor: "pointer",
  },
  secondaryButton: {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.92)",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },

  smallRow: { marginTop: 10 },

  link: {
    fontSize: 13,
    color: "rgba(0,229,255,0.95)",
    textDecoration: "none",
    borderBottom: "1px solid rgba(0,229,255,0.35)",
    width: "fit-content",
  },

  voiceRow: { display: "grid", gridTemplateColumns: "1fr", gap: 10 },
  select: {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.92)",
    outline: "none",
    cursor: "pointer",
  },
  audio: { width: "100%" },
  smallNote: { marginTop: 10, fontSize: 12, color: "rgba(255,255,255,0.58)" },

  actionsRow: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 },

  emptyState: {
    padding: "14px 12px",
    borderRadius: 14,
    border: "1px dashed rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.72)",
  },

  chapterList: { display: "flex", flexDirection: "column", gap: 10 },
  chapterItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "12px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.05)",
  },
  chapterLeft: { display: "flex", alignItems: "center", gap: 12, minWidth: 0 },
  chapterIndex: {
    width: 36,
    height: 36,
    borderRadius: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    fontSize: 12,
    letterSpacing: 0.3,
    background: "linear-gradient(135deg, rgba(255,0,153,0.85), rgba(0,229,255,0.80))",
    border: "1px solid rgba(255,255,255,0.12)",
    flex: "0 0 auto",
  },
  chapterMeta: { minWidth: 0 },
  chapterTitleText: {
    fontWeight: 800,
    fontSize: 13,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 520,
  },
  chapterPages: { marginTop: 3, fontSize: 12, color: "rgba(255,255,255,0.62)" },
  chapterError: { marginTop: 6, fontSize: 12, color: "rgba(255,160,180,0.95)", maxWidth: 520 },

  chapterRight: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
  downloadLink: {
    fontSize: 13,
    color: "rgba(255,255,255,0.92)",
    textDecoration: "none",
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
  },
  badgeMuted: {
    fontSize: 11,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "rgba(255,255,255,0.85)",
    fontWeight: 800,
  },

  errorCard: {
    marginTop: 14,
    borderRadius: 18,
    border: "1px solid rgba(255, 80, 80, 0.35)",
    background: "rgba(255, 20, 80, 0.10)",
    padding: 14,
  },
  errorTitle: {
    fontWeight: 900,
    fontSize: 12,
    color: "rgba(255, 130, 150, 0.95)",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  errorText: {
    marginTop: 8,
    fontSize: 13,
    color: "rgba(255,255,255,0.88)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },

  footer: { marginTop: 18 },
  footerLine: {
    height: 1,
    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)",
  },
  footerText: { marginTop: 10, fontSize: 12, color: "rgba(255,255,255,0.55)" },
};
