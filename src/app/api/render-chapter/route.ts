import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import textToSpeech from "@google-cloud/text-to-speech";

export const runtime = "nodejs";

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

function utf8Bytes(s: string) {
  return Buffer.byteLength(s, "utf8");
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

function chunkText(text: string, maxBytes = 4800) {
  const paragraphs = text
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let cur = "";

  const flush = () => {
    const v = cur.trim();
    if (v) chunks.push(v);
    cur = "";
  };

  for (const p of paragraphs) {
    const paraParts = splitToByteSafeParts(p, maxBytes);
    for (const part of paraParts) {
      const candidate = cur ? `${cur}\n\n${part}` : part;
      if (utf8Bytes(candidate) <= maxBytes) {
        cur = candidate;
      } else {
        flush();
        cur = part;
      }
    }
  }

  flush();
  return chunks;
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

    if (!pdfUrl || !Number.isFinite(startPage) || !Number.isFinite(endPage) || !Number.isFinite(chapterIndex)) {
      return NextResponse.json({ error: "Missing/invalid inputs" }, { status: 400 });
    }

    let pages: { pageNumber: number; text: string }[] | null = null;

    if (extractedUrl && typeof extractedUrl === "string") {
      try {
        const cachedBuf = await fetchPrivateBlobBuffer(extractedUrl);
        const cached = JSON.parse(cachedBuf.toString("utf8"));
        pages = Array.isArray(cached?.pages) ? cached.pages : null;
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

    const intro = `Chapter ${chapterIndex}.\n${chapterTitle}.\n`;
    let finalText = `${intro}\n${chapterText}`.trim();

    if (visualPages.length) {
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

    const chunks = chunkText(finalText, 4800);
    const mp3Parts: Buffer[] = [];

    for (const chunk of chunks) {
      if (utf8Bytes(chunk) > 5000) {
        throw new Error("Internal chunking error: generated chunk exceeds 5000 bytes");
      }
      const resp = await synthesizeWithRetry(client, {
        input: { text: chunk },
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
