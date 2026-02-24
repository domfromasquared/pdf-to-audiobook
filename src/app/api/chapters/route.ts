import { NextResponse } from "next/server";
import { put, get } from "@vercel/blob";

export const runtime = "nodejs";

type Chapter = { index: number; title: string; startPage: number; endPage: number };

function looksLikeHeading(s: string) {
  const line = (s || "").trim();
  if (!line) return false;
  if (/^chapter\s+\d+/i.test(line)) return true;
  if (/^\d+(\.\d+)*\s+/.test(line)) return true;
  if (line.length <= 60 && line === line.toUpperCase() && /[A-Z]/.test(line)) return true;
  return false;
}

function cleanTitle(s: string) {
  return s.replace(/\s+/g, " ").trim().slice(0, 120) || "Chapter";
}

// Read private blob bytes directly (avoids calling /api/blob-bytes, so no Deployment Protection issues)
async function fetchPrivateBlobBytes(url: string): Promise<Buffer> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  let blobRes: any;
  const readOpts: any = { access: "private" };
  if (token) readOpts.token = token;

  try {
    // Works with full blob URL in most environments.
    blobRes = await get(url, readOpts);
  } catch {
    // Fallback for environments expecting pathname keys.
    const pathname = new URL(url).pathname.replace(/^\/+/, "");
    blobRes = await get(pathname, readOpts);
  }

  // Some SDK responses include `body`, some include `data`
  if (blobRes?.data) {
    if (typeof blobRes.data === "string") return Buffer.from(blobRes.data, "utf8");
    if (blobRes.data instanceof ArrayBuffer) return Buffer.from(blobRes.data);
    if (blobRes.data instanceof Uint8Array) return Buffer.from(blobRes.data);
    if (Buffer.isBuffer(blobRes.data)) return blobRes.data;
  }

  if (blobRes?.body) {
    // node fetch Response-like body
    if (typeof blobRes.body.arrayBuffer === "function") {
      const ab = await blobRes.body.arrayBuffer();
      return Buffer.from(ab);
    }
    // ReadableStream (edge-ish)
    if (typeof blobRes.body.getReader === "function") {
      const reader = blobRes.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      return Buffer.from(merged);
    }
  }

  throw new Error("Blob response missing body/data");
}

async function detectChapters(pdfUrl: string) {
  let step = "init";
  // Lazy import keeps route boot resilient: module-load failures become JSON errors.
  step = "import-extractor";
  const { extractPagesFromPdfBuffer } = await import("@/lib/extract-pages");

  // Fetch PDF bytes directly from private blob (no internal HTTP call)
  step = "read-pdf-blob";
  const pdfBuf = await fetchPrivateBlobBytes(pdfUrl);

  // Extract pages via bundled helper (no /scripts dependency)
  step = "extract-pages";
  const { numPages, pages } = await extractPagesFromPdfBuffer(pdfBuf);

  // Cache extraction output into private Blob
  step = "write-extraction-cache";
  const extractedBlob = await put(
    `extracted/${Date.now()}-pages.json`,
    Buffer.from(JSON.stringify({ numPages, pages }), "utf8"),
    { access: "private", contentType: "application/json", addRandomSuffix: false }
  );

  // Heading candidates
  step = "detect-headings";
  const candidates: { page: number; title: string }[] = [];
  for (const p of pages) {
    const firstChunk = p.text.split(" ").slice(0, 14).join(" ").trim();
    if (looksLikeHeading(firstChunk)) {
      candidates.push({ page: p.pageNumber, title: cleanTitle(firstChunk) });
    }
  }

  let chapters: Chapter[] =
    candidates.length >= 2
      ? candidates.map((c, idx) => {
          const startPage = c.page;
          const endPage = (candidates[idx + 1]?.page ?? numPages + 1) - 1;
          return {
            index: idx + 1,
            title: c.title || `Chapter ${idx + 1}`,
            startPage,
            endPage: Math.max(startPage, Math.min(endPage, numPages)),
          };
        })
      : [{ index: 1, title: "Document", startPage: 1, endPage: numPages }];

  // Ensure pages 1..(firstStart-1) are included
  const firstStart = chapters[0]?.startPage ?? 1;
  if (firstStart > 1) {
    const frontMatter: Chapter = {
      index: 1,
      title: "Front Matter",
      startPage: 1,
      endPage: firstStart - 1,
    };

    chapters = [frontMatter, ...chapters.map((c) => ({ ...c, index: c.index + 1 }))];
  }

  step = "done";
  return NextResponse.json({ numPages, chapters, extractedUrl: extractedBlob.url });
}

export async function POST(req: Request) {
  let step = "parse-request";
  try {
    const body = await req.json().catch(() => ({}));
    const pdfUrl = body?.pdfUrl;

    if (!pdfUrl || typeof pdfUrl !== "string") {
      return NextResponse.json({ error: "Missing pdfUrl" }, { status: 400 });
    }

    step = "detect-chapters";
    return await detectChapters(pdfUrl);
  } catch (err: any) {
    const message = err?.message || "Failed to detect chapters";
    console.error("CHAPTERS_ERROR:", { step, message, err });
    return NextResponse.json({ error: message, step }, { status: 500 });
  }
}

export async function GET(req: Request) {
  let step = "parse-request";
  try {
    const { searchParams } = new URL(req.url);
    const pdfUrl = searchParams.get("pdfUrl");

    if (!pdfUrl) {
      return NextResponse.json({ error: "Missing pdfUrl" }, { status: 400 });
    }

    step = "detect-chapters";
    return await detectChapters(pdfUrl);
  } catch (err: any) {
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
