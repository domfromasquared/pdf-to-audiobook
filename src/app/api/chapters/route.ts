import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { inferDocType } from "@/lib/doc-type";
import { LayoutLine } from "@/lib/extract-pages";

export const runtime = "nodejs";

type Chapter = { index: number; title: string; startPage: number; endPage: number };

type PageText = { pageNumber: number; text: string; lines: LayoutLine[]; maxFontSize: number };
type HeadingCandidate = { page: number; title: string; score: number };

function textToLines(text: string) {
  const baseLines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (baseLines.length > 1) return baseLines;

  const words = text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (!words.length) return [];

  const out: string[] = [];
  for (let i = 0; i < words.length; i += 8) {
    out.push(words.slice(i, i + 8).join(" "));
  }
  return out;
}

function layoutLinesForPage(page: PageText) {
  if (page.lines && page.lines.length) return page.lines;
  return textToLines(page.text).map((text) => ({ text, fontSize: 0, indent: 0 }));
}

function normalizeLine(s: string) {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s.:/-]/g, "")
    .trim();
}

function buildCommonLineSet(pages: PageText[]) {
  const counts = new Map<string, number>();
  for (const p of pages) {
    for (const line of layoutLinesForPage(p).map((l) => l.text)) {
      const n = normalizeLine(line);
      if (!n || n.length < 4) continue;
      counts.set(n, (counts.get(n) || 0) + 1);
    }
  }

  const threshold = Math.max(3, Math.floor(pages.length * 0.25));
  const common = new Set<string>();
  for (const [k, v] of counts.entries()) {
    if (v >= threshold) common.add(k);
  }
  return common;
}

function suppressLikelyHeaderFooter(lines: string[], common: Set<string>) {
  return lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^\d+$/.test(trimmed)) return false;
    if (/^page\s+\d+$/i.test(trimmed)) return false;
    return !common.has(normalizeLine(trimmed));
  });
}

function cleanTitle(s: string) {
  return s.replace(/\s+/g, " ").trim().slice(0, 120) || "Chapter";
}

function looksLikeHeadingLegacy(s: string) {
  const line = (s || "").trim();
  if (!line) return false;
  if (/^chapter\s+\d+/i.test(line)) return true;
  if (/^\d+(\.\d+)*\s+/.test(line)) return true;
  if (line.length <= 60 && line === line.toUpperCase() && /[A-Z]/.test(line)) return true;
  return false;
}

function scoreHeadingCandidate(
  candidate: string,
  common: Set<string>,
  meta: LayoutLine | null,
  pageMaxFont: number
) {
  const line = candidate.trim();
  if (!line) return -999;

  let score = 0;
  if (/^chapter\s+\d+\b/i.test(line)) score += 95;
  if (/^chapter\s+[ivxlcdm]+\b/i.test(line)) score += 90;
  if (/^[ivxlcdm]+\.\s+[a-z]/i.test(line)) score += 58;
  if (/^\d+(\.\d+)*\s+\S+/.test(line)) score += 62;
  if (/^part\s+[ivxlcdm\d]+\b/i.test(line)) score += 55;
  if (/\btable of contents\b/i.test(line)) score += 20;

  const letters = (line.match(/[a-z]/gi) || []).length;
  const chars = line.length || 1;
  if (chars <= 80 && letters / chars > 0.55) score += 18;

  if (chars > 120) score -= 18;
  if (/^\W*\d+\W*$/.test(line)) score -= 90;
  if (common.has(normalizeLine(line))) score -= 45;
  if (/^(copyright|all rights reserved)\b/i.test(line)) score -= 40;

  if (meta?.fontSize && pageMaxFont) {
    const ratio = meta.fontSize / pageMaxFont;
    if (ratio >= 0.92) score += 24;
    else if (ratio >= 0.86) score += 12;
  }
  if (meta && meta.indent > 30) score -= 8;

  return score;
}

function detectTocEntries(pages: PageText[]) {
  const earlyPages = pages.slice(0, Math.min(8, pages.length));
  for (const p of earlyPages) {
    const lines = textToLines(p.text).slice(0, 80);
    if (!lines.length) continue;

    const hasContentsMarker = lines.some((l) => /\btable of contents\b|\bcontents\b/i.test(l));
    if (!hasContentsMarker) continue;

    const trailingRefDensity =
      lines.filter((l) => /\b\d{1,4}\s*$/.test(l)).length / Math.max(1, lines.length);
    if (trailingRefDensity < 0.18) continue;

    const entries: Array<{ title: string; page: number }> = [];
    for (const line of lines) {
      const m =
        line.match(/^(.+?)\.{2,}\s*(\d{1,4})\s*$/) ||
        line.match(/^(.+?\D)\s+(\d{1,4})\s*$/);
      if (!m) continue;
      const title = cleanTitle(m[1]);
      const page = Number(m[2]);
      if (!title || !Number.isFinite(page)) continue;
      if (page < 1) continue;
      entries.push({ title, page });
    }

    if (entries.length >= 3) {
      return { tocPage: p.pageNumber, entries };
    }
  }
  return null;
}

function inferTocOffset(
  tocEntries: Array<{ title: string; page: number }>,
  headingCandidates: HeadingCandidate[]
) {
  const deltas = new Map<number, number>();
  for (const te of tocEntries) {
    const normToc = normalizeLine(te.title);
    for (const hc of headingCandidates) {
      const normHeading = normalizeLine(hc.title);
      if (!normToc || !normHeading) continue;
      if (normHeading.includes(normToc) || normToc.includes(normHeading)) {
        const delta = hc.page - te.page;
        deltas.set(delta, (deltas.get(delta) || 0) + 1);
      }
    }
  }
  if (!deltas.size) return 0;
  return Array.from(deltas.entries()).sort((a, b) => b[1] - a[1])[0][0];
}

function toChaptersFromStarts(starts: Array<{ page: number; title: string }>, numPages: number) {
  const uniq = Array.from(
    new Map(
      starts
        .filter((s) => Number.isFinite(s.page))
        .map((s) => [Math.max(1, Math.min(numPages, Math.floor(s.page))), cleanTitle(s.title)])
    ).entries()
  )
    .map(([page, title]) => ({ page, title }))
    .sort((a, b) => a.page - b.page);

  if (uniq.length < 2) {
    return [{ index: 1, title: "Document", startPage: 1, endPage: numPages }];
  }

  const chapters: Chapter[] = uniq.map((c, idx) => {
    const startPage = c.page;
    const nextStart = uniq[idx + 1]?.page;
    const endPage = Math.max(startPage, Math.min((nextStart ?? numPages + 1) - 1, numPages));
    return {
      index: idx + 1,
      title: c.title || `Chapter ${idx + 1}`,
      startPage,
      endPage,
    };
  });

  return chapters;
}

async function fetchPrivateBlobBytes(url: string): Promise<Buffer> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("Missing BLOB_READ_WRITE_TOKEN");
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Private blob fetch failed (${res.status}): ${txt.slice(0, 200)}`);
  }

  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function detectChapters(pdfUrl: string) {
  let step = "read-pdf-blob";
  try {
    step = "import-extractor";
    const { extractPagesFromPdfBuffer } = await import("@/lib/extract-pages");

    const pdfBuf = await fetchPrivateBlobBytes(pdfUrl);
    step = "extract-pages";
    const { numPages, pages } = await extractPagesFromPdfBuffer(pdfBuf);
    const commonLines = buildCommonLineSet(pages);

    step = "detect-headings";
    const headingCandidates: HeadingCandidate[] = [];
    for (const p of pages) {
      const lines = suppressLikelyHeaderFooter(
        layoutLinesForPage(p).map((l) => l.text),
        commonLines
      ).slice(0, 12);
      const layout = layoutLinesForPage(p);
      const candidates: Array<{ text: string; meta: LayoutLine | null }> = [];

      for (let i = 0; i < lines.length; i++) {
        const one = lines[i];
        if (one) {
          candidates.push({ text: one, meta: layout[i] ?? null });
        }
        const two =
          layout[i] && layout[i + 1]
            ? `${layout[i].text} ${layout[i + 1].text}`
            : lines[i] && lines[i + 1]
            ? `${lines[i]} ${lines[i + 1]}`
            : "";
        if (two) {
          candidates.push({ text: two, meta: layout[i] ?? null });
        }
      }

      let best: { title: string; score: number } | null = null;
      for (const c of candidates) {
        const s = scoreHeadingCandidate(c.text, commonLines, c.meta, p.maxFontSize);
        if (!best || s > best.score) best = { title: c.text, score: s };
      }
      if (best && best.score >= 60) {
        headingCandidates.push({ page: p.pageNumber, title: cleanTitle(best.title), score: best.score });
      }
    }

    step = "detect-toc";
    const toc = detectTocEntries(pages);
    const tocStarts: Array<{ page: number; title: string }> = [];
    if (toc) {
      const offset = inferTocOffset(toc.entries, headingCandidates);
      for (const entry of toc.entries) {
        const page = entry.page + offset;
        if (page >= 1 && page <= numPages) {
          tocStarts.push({ page, title: entry.title });
        }
      }
    }

    const scoredStarts = headingCandidates.map((c) => ({ page: c.page, title: c.title }));
    const useToc = tocStarts.length >= 2;
    const sourceStarts = useToc ? tocStarts : scoredStarts;

    let chapters = toChaptersFromStarts(sourceStarts, numPages);
    if (chapters.length < 2) {
      // Legacy fallback preserved for stability.
      const legacyCandidates = pages
        .map((p) => {
          const firstChunk = p.text.split(/\s+/).slice(0, 14).join(" ").trim();
          return { page: p.pageNumber, title: cleanTitle(firstChunk), ok: looksLikeHeadingLegacy(firstChunk) };
        })
        .filter((c) => c.ok)
        .map((c) => ({ page: c.page, title: c.title }));

      chapters = toChaptersFromStarts(legacyCandidates, numPages);
    }

    if (chapters.length < 2) {
      chapters = [{ index: 1, title: "Document", startPage: 1, endPage: numPages }];
    }

    // Insert front matter if the first real section starts after page 1.
    const firstStart = chapters[0]?.startPage ?? 1;
    if (firstStart > 1) {
      chapters = [
        { index: 1, title: "Front Matter", startPage: 1, endPage: firstStart - 1 },
        ...chapters.map((c) => ({ ...c, index: c.index + 1 })),
      ];
    }

    const docTypeInfo = inferDocType(pages, { tocPageNumber: toc?.tocPage || null });
    const confidenceRaw =
      chapters.length >= 3 ? 0.9 : chapters.length >= 2 ? 0.75 : headingCandidates.length ? 0.6 : 0.35;
    const confidence = Math.max(0, Math.min(1, confidenceRaw));

    let extractedUrl: string | null = null;
    try {
      step = "write-extraction-cache";
      const extractedBlob = await put(
        `extracted/${Date.now()}-pages.json`,
        Buffer.from(JSON.stringify({ numPages, pages, docType: docTypeInfo.docType }), "utf8"),
        { access: "private", contentType: "application/json", addRandomSuffix: false }
      );
      extractedUrl = extractedBlob.url;
    } catch (cacheErr) {
      console.warn("CHAPTERS_CACHE_WRITE_WARNING:", cacheErr);
    }
    const payload: Record<string, any> = {
      numPages,
      chapters,
      extractedUrl,
      docType: docTypeInfo.docType,
      confidence,
    };

    if (process.env.DEBUG_CHAPTERS === "1") {
      payload.debug = {
        headingsDetected: headingCandidates.length,
        tocDetected: Boolean(toc),
        tocEntries: toc?.entries.length || 0,
        usedToc: useToc,
      };
    }

    return NextResponse.json(payload);
  } catch (err: any) {
    err.step = step;
    throw err;
  }
}

export async function POST(req: Request) {
  let step = "parse-request";
  try {
    const body = await req.json().catch(() => ({}));
    const pdfUrl = body?.pdfUrl || body?.url;

    if (!pdfUrl || typeof pdfUrl !== "string") {
      return NextResponse.json({ error: "Missing pdfUrl" }, { status: 400 });
    }

    step = "detect-chapters";
    return await detectChapters(pdfUrl);
  } catch (err: any) {
    if (err?.step) step = err.step;
    const message = err?.message || "Failed to detect chapters";
    console.error("CHAPTERS_ERROR:", { step, message, err });
    return NextResponse.json({ error: message, step }, { status: 500 });
  }
}

export async function GET(req: Request) {
  let step = "parse-request";
  try {
    const { searchParams } = new URL(req.url);
    const pdfUrl = searchParams.get("pdfUrl") || searchParams.get("url");

    if (!pdfUrl) {
      return NextResponse.json({ error: "Missing pdfUrl" }, { status: 400 });
    }

    step = "detect-chapters";
    return await detectChapters(pdfUrl);
  } catch (err: any) {
    if (err?.step) step = err.step;
    const message = err?.message || "Failed to detect chapters";
    console.error("CHAPTERS_ERROR:", { step, message, err });
    return NextResponse.json({ error: message, step }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, POST, OPTIONS",
    },
  });
}
