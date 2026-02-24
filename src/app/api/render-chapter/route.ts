import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import textToSpeech from "@google-cloud/text-to-speech";
import { inferDocType, type DocType } from "@/lib/doc-type";

export const runtime = "nodejs";
export const maxDuration = 300;

const CHIRP_HD_VOICES: Record<string, { languageCode: string; voiceName: string }> = {
  Iapetus: { languageCode: "en-US", voiceName: "en-US-Chirp3-HD-Iapetus" },
  Enceladus: { languageCode: "en-US", voiceName: "en-US-Chirp3-HD-Enceladus" },
  Orus: { languageCode: "en-US", voiceName: "en-US-Chirp3-HD-Orus" },
  Leda: { languageCode: "en-US", voiceName: "en-US-Chirp3-HD-Leda" },
  Callirrhoe: { languageCode: "en-US", voiceName: "en-US-Chirp3-HD-Callirrhoe" },
};

function getGoogleClient() {
  const b64 = process.env.GOOGLE_TTS_KEY_B64;
  if (!b64) throw new Error("Missing GOOGLE_TTS_KEY_B64");
  const json = Buffer.from(b64, "base64").toString("utf8");
  const credentials = JSON.parse(json);
  return new textToSpeech.TextToSpeechClient({ credentials });
}

function stripLikelyHeaderFooterLines(lines: string[]) {
  const counts = new Map<string, number>();
  for (const ln of lines) {
    const s = ln.trim();
    if (!s) continue;
    counts.set(s, (counts.get(s) || 0) + 1);
  }

  const threshold = Math.max(3, Math.floor(lines.length * 0.2));
  const bad = new Set<string>();
  for (const [k, v] of counts.entries()) {
    if (k.length >= 12 && v >= threshold) bad.add(k);
  }

  return lines.filter((ln) => !bad.has(ln.trim()));
}

function audiobookPolish(t: string) {
  return (t || "")
    .replace(/\be\.g\.\b/gi, "for example")
    .replace(/\bi\.e\.\b/gi, "that is")
    .replace(/\bvs\.\b/gi, "versus")
    .replace(/\bw\/\b/gi, "with")
    .replace(/\betc\.\b/gi, "etcetera")
    .replace(/([!?])\1+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanTextForAudio(raw: string) {
  let t = raw || "";
  t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  let lines = t.split("\n").map((l) => l.trim());
  lines = lines.filter((l) => l && !/^\d+$/.test(l) && !/^page\s+\d+$/i.test(l));
  lines = stripLikelyHeaderFooterLines(lines);

  t = lines.join("\n");
  t = t.replace(/(\w)-\n(\w)/g, "$1$2");
  t = t.replace(/\n{3,}/g, "\n\n").replace(/([^\n])\n([^\n])/g, "$1 $2");
  t = t.replace(/[•●▪︎◦·]/g, "-");
  t = t.replace(/^\s*-\s+/gm, "Item: ");
  t = t.replace(/[ \t]{2,}/g, " ").trim();
  return audiobookPolish(t);
}

function forceSentenceBoundaries(text: string, maxWordsPerSentence = 32) {
  const tokens = (text || "").split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";

  const out: string[] = [];
  let wordsSinceBoundary = 0;

  for (const tok of tokens) {
    out.push(tok);
    const hasBoundary = /[.!?]["')\]]*$/.test(tok);

    if (hasBoundary) {
      wordsSinceBoundary = 0;
      continue;
    }

    wordsSinceBoundary += 1;
    if (wordsSinceBoundary >= maxWordsPerSentence) {
      out.push(".");
      wordsSinceBoundary = 0;
    }
  }

  return out.join(" ").replace(/\s+([.!?,;:])/g, "$1").trim();
}

function utf8Bytes(s: string) {
  return Buffer.byteLength(s, "utf8");
}

function escapeSsmlText(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function splitToByteSafeParts(input: string, maxBytes: number) {
  const text = (input || "").trim();
  if (!text) return [];
  if (utf8Bytes(text) <= maxBytes) return [text];

  const out: string[] = [];
  let cur = "";

  const pushCur = () => {
    const v = cur.trim();
    if (v) out.push(v);
    cur = "";
  };

  // Split by sentence first, then by words if a single sentence is too large.
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  for (const sentence of sentences) {
    if (utf8Bytes(sentence) <= maxBytes) {
      const candidate = cur ? `${cur} ${sentence}` : sentence;
      if (utf8Bytes(candidate) <= maxBytes) cur = candidate;
      else {
        pushCur();
        cur = sentence;
      }
      continue;
    }

    const words = sentence.split(/\s+/).filter(Boolean);
    for (const w of words) {
      if (utf8Bytes(w) > maxBytes) {
        // Ultra-defensive fallback for pathological tokens.
        let token = w;
        while (utf8Bytes(token) > maxBytes) {
          let sliceLen = token.length;
          while (sliceLen > 1 && utf8Bytes(token.slice(0, sliceLen)) > maxBytes) {
            sliceLen = Math.floor(sliceLen * 0.8);
          }
          const part = token.slice(0, Math.max(1, sliceLen));
          const candidate = cur ? `${cur} ${part}` : part;
          if (utf8Bytes(candidate) <= maxBytes) cur = candidate;
          else {
            pushCur();
            cur = part;
          }
          token = token.slice(part.length);
        }
        if (token) {
          const candidate = cur ? `${cur} ${token}` : token;
          if (utf8Bytes(candidate) <= maxBytes) cur = candidate;
          else {
            pushCur();
            cur = token;
          }
        }
        continue;
      }

      const candidate = cur ? `${cur} ${w}` : w;
      if (utf8Bytes(candidate) <= maxBytes) cur = candidate;
      else {
        pushCur();
        cur = w;
      }
    }
  }

  pushCur();
  return out;
}

function buildSsmlFromParagraphs(paragraphs: string[]) {
  const paraSsml = paragraphs
    .map((p) => {
      const sentenceBits = forceSentenceBoundaries(p, 28)
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => `<s>${escapeSsmlText(s)}</s>`)
        .join("");
      return sentenceBits ? `<p>${sentenceBits}</p>` : "";
    })
    .filter(Boolean)
    .join(`<break time="250ms"/>`);

  return `<speak>${paraSsml}</speak>`;
}

function chunkTextToSsml(text: string, maxSsmlBytes = 4800) {
  const paragraphs = text
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const atomParagraphs: string[] = [];
  for (const p of paragraphs) {
    const normalized = forceSentenceBoundaries(p, 28);
    if (!normalized) continue;
    const singleParaSsml = buildSsmlFromParagraphs([normalized]);
    if (utf8Bytes(singleParaSsml) <= maxSsmlBytes) {
      atomParagraphs.push(normalized);
      continue;
    }
    const splitParts = splitToByteSafeParts(normalized, 1200);
    for (const part of splitParts) {
      if (part.trim()) atomParagraphs.push(part.trim());
    }
  }

  const chunks: string[] = [];
  let curParagraphs: string[] = [];

  const flush = () => {
    if (!curParagraphs.length) return;
    const ssml = buildSsmlFromParagraphs(curParagraphs);
    if (utf8Bytes(ssml) > maxSsmlBytes) {
      throw new Error("Internal chunking error: generated SSML exceeds max bytes");
    }
    chunks.push(ssml);
    curParagraphs = [];
  };

  for (const p of atomParagraphs) {
    const candidate = [...curParagraphs, p];
    const candidateSsml = buildSsmlFromParagraphs(candidate);
    if (utf8Bytes(candidateSsml) <= maxSsmlBytes) {
      curParagraphs = candidate;
    } else {
      flush();
      curParagraphs = [p];
      const single = buildSsmlFromParagraphs(curParagraphs);
      if (utf8Bytes(single) > maxSsmlBytes) {
        throw new Error("Internal chunking error: single paragraph exceeds SSML byte budget");
      }
    }
  }

  flush();
  return chunks;
}

function normalizeDocType(value: unknown): DocType {
  if (
    value === "book" ||
    value === "report" ||
    value === "paper" ||
    value === "slides" ||
    value === "manual"
  ) {
    return value;
  }
  return "unknown";
}

function buildIntroSlate(input: {
  docType: DocType;
  chapterIndex: number;
  chapterTitle: string;
  totalChapters: number;
}) {
  const title = String(input.chapterTitle || "").trim();
  const genericTitle =
    !title ||
    /^document$/i.test(title) ||
    new RegExp(`^chapter\\s+${input.chapterIndex}$`, "i").test(title);

  if (input.docType === "slides") return "";

  if (input.docType === "book") {
    const lines = [`Chapter ${input.chapterIndex}`];
    if (!genericTitle) lines.push(title.replace(/[.]+$/g, "").trim());
    return lines.join("\n");
  }

  const sectioned = input.totalChapters > 1;
  if (
    sectioned &&
    (input.docType === "report" ||
      input.docType === "manual" ||
      input.docType === "paper" ||
      input.docType === "unknown")
  ) {
    const lines = [`Section ${input.chapterIndex}`];
    if (!genericTitle) lines.push(title.replace(/[.]+$/g, "").trim());
    return lines.join("\n");
  }

  return "";
}

function compressPages(pages: number[]) {
  const uniq = Array.from(new Set(pages)).sort((a, b) => a - b);
  if (!uniq.length) return "";

  const ranges: Array<[number, number]> = [];
  let start = uniq[0];
  let prev = uniq[0];

  for (let i = 1; i < uniq.length; i++) {
    const p = uniq[i];
    if (p === prev + 1) prev = p;
    else {
      ranges.push([start, prev]);
      start = prev = p;
    }
  }
  ranges.push([start, prev]);

  const parts = ranges.map(([a, b]) => (a === b ? `${a}` : `${a} through ${b}`));

  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]}, and ${parts[1]}`;
  return parts.slice(0, -1).join(", ") + `, and ${parts[parts.length - 1]}`;
}

async function fetchPrivateBlobBuffer(url: string): Promise<Buffer> {
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

async function synthesizeWithRetry(client: any, req: any, tries = 3) {
  let lastErr: any = null;
  for (let i = 0; i < tries; i++) {
    try {
      const [resp] = await client.synthesizeSpeech(req);
      return resp;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const pdfUrl = body?.pdfUrl;
    const extractedUrl = body?.extractedUrl;
    const startPage = Number(body?.startPage);
    const endPage = Number(body?.endPage);
    const chapterIndex = Number(body?.chapterIndex);
    const chapterTitle = String(body?.chapterTitle || "Chapter");
    const voiceKey = body?.voiceKey;
    const totalChapters = Number(body?.totalChapters);
    const requestDocType = normalizeDocType(body?.docType);

    if (!pdfUrl || !Number.isFinite(startPage) || !Number.isFinite(endPage) || !Number.isFinite(chapterIndex)) {
      return NextResponse.json({ error: "Missing/invalid inputs" }, { status: 400 });
    }

    let pages: { pageNumber: number; text: string }[] | null = null;
    let docType: DocType = requestDocType;

    if (extractedUrl && typeof extractedUrl === "string") {
      try {
        const cachedBuf = await fetchPrivateBlobBuffer(extractedUrl);
        const cached = JSON.parse(cachedBuf.toString("utf8"));
        pages = Array.isArray(cached?.pages) ? cached.pages : null;
        if (docType === "unknown") {
          docType = normalizeDocType(cached?.docType);
        }
      } catch (cacheReadErr) {
        console.warn("RENDER_CACHE_READ_WARNING:", cacheReadErr);
      }
    }

    if (!pages) {
      const { extractPagesFromPdfBuffer } = await import("@/lib/extract-pages");
      const pdfBuf = await fetchPrivateBlobBuffer(pdfUrl);
      const extracted = await extractPagesFromPdfBuffer(pdfBuf);
      pages = extracted.pages;
    }

    if (docType === "unknown") {
      docType = inferDocType(pages).docType;
    }

    const inRange = pages.filter((p) => p.pageNumber >= startPage && p.pageNumber <= endPage);
    const chapterText = cleanTextForAudio(inRange.map((p) => p.text).join("\n\n"));

    const visualPages = inRange
      .filter((p) => {
        const s = (p.text || "").trim();
        const letters = (s.match(/[A-Za-z]/g) || []).length;
        const chars = s.length || 1;

        if (chars < 80) return true;
        if (letters / chars < 0.35 && chars < 220) return true;
        if (/(figure|table|chart|diagram|exhibit)/i.test(s) && chars < 180) return true;

        return false;
      })
      .map((p) => p.pageNumber);

    const intro = buildIntroSlate({
      docType,
      chapterIndex,
      chapterTitle,
      totalChapters: Number.isFinite(totalChapters) ? totalChapters : 0,
    });
    let finalText = `${intro ? `${intro}\n\n` : ""}${chapterText}`.trim();

    if (process.env.INCLUDE_VISUALS_NOTE === "1" && visualPages.length) {
      const pagesStr = compressPages(visualPages);
      finalText =
        (finalText ? finalText + "\n\n" : "") +
        `For the visuals in this chapter, see pages ${pagesStr}.`;
    }

    if (finalText.length > 200000) {
      throw new Error("Chapter is too long to render in one pass. Split into smaller chapters.");
    }

    const client = getGoogleClient();
    const chosen =
      typeof voiceKey === "string" && CHIRP_HD_VOICES[voiceKey] ? CHIRP_HD_VOICES[voiceKey] : null;

    const languageCode =
      chosen?.languageCode ||
      (typeof body?.languageCode === "string" && body.languageCode) ||
      process.env.GOOGLE_TTS_LANG ||
      "en-US";

    const voiceName =
      chosen?.voiceName ||
      (typeof body?.voiceName === "string" && body.voiceName.trim()) ||
      process.env.GOOGLE_TTS_VOICE ||
      "en-US-Neural2-F";

    const chunks = chunkTextToSsml(finalText, 4800);
    const mp3Parts: Buffer[] = [];

    for (const ssml of chunks) {
      if (utf8Bytes(ssml) > 5000) {
        throw new Error("Internal chunking error: generated SSML exceeds 5000 bytes");
      }
      const resp = await synthesizeWithRetry(client, {
        input: { ssml },
        voice: { languageCode, name: voiceName },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: 0.98,
          pitch: 0,
          volumeGainDb: 1,
        },
      });

      if (!resp.audioContent) throw new Error("No audio returned from Google TTS");

      const buf = Buffer.isBuffer(resp.audioContent)
        ? resp.audioContent
        : Buffer.from(resp.audioContent as any);

      mp3Parts.push(buf);
    }

    const mp3 = Buffer.concat(mp3Parts);

    const safeTitle = chapterTitle
      .replace(/[^\w.\- ]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);

    const filename = `chapters/${Date.now()}-ch${String(chapterIndex).padStart(2, "0")}-${safeTitle || "Chapter"}.mp3`;

    const blob = await put(filename, mp3, {
      access: "private",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
    });

    const downloadUrl = `/api/download?url=${encodeURIComponent(blob.url)}&name=${encodeURIComponent(
      `Chapter_${String(chapterIndex).padStart(2, "0")}.mp3`
    )}`;

    return NextResponse.json({ downloadUrl, voiceName, languageCode });
  } catch (err: any) {
    console.error("RENDER_CHAPTER_ERROR:", err);
    return NextResponse.json({ error: err?.message || "Failed to render chapter" }, { status: 500 });
  }
}
