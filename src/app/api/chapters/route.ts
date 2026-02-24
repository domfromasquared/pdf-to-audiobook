import { NextResponse } from "next/server";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

function runNodeExtractor(
  pdfPath: string
): Promise<{ numPages: number; pages: { pageNumber: number; text: string }[] }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [join(process.cwd(), "scripts", "extract-pages.mjs"), pdfPath],
      { maxBuffer: 1024 * 1024 * 40 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`Failed to parse extractor output: ${stdout.slice(0, 250)}`));
        }
      }
    );
  });
}

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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const pdfUrl = body?.pdfUrl;

    if (!pdfUrl || typeof pdfUrl !== "string") {
      return NextResponse.json({ error: "Missing pdfUrl" }, { status: 400 });
    }

    // Fetch PDF bytes through your internal endpoint (private blob-safe)
    const baseUrl = new URL(req.url).origin;
    const bytesRes = await fetch(`${baseUrl}/api/blob-bytes?url=${encodeURIComponent(pdfUrl)}`);
    if (!bytesRes.ok) {
      const txt = await bytesRes.text().catch(() => "");
      return NextResponse.json(
        { error: `blob-bytes failed (${bytesRes.status}): ${txt}` },
        { status: 500 }
      );
    }

    const ab = await bytesRes.arrayBuffer();
    const buf = Buffer.from(ab);

    // Write temp pdf
    const pdfPath = join(tmpdir(), `in-${Date.now()}.pdf`);
    writeFileSync(pdfPath, buf);

    // Extract all pages once
    const { numPages, pages } = await runNodeExtractor(pdfPath);

    // Cache extraction output into private Blob
    const extractedBlob = await put(
      `extracted/${Date.now()}-pages.json`,
      Buffer.from(JSON.stringify({ numPages, pages }), "utf8"),
      { access: "private", contentType: "application/json", addRandomSuffix: false }
    );

    // Heading candidates (same heuristic)
    const candidates: { page: number; title: string }[] = [];
    for (const p of pages) {
      const firstChunk = p.text.split(" ").slice(0, 14).join(" ").trim();
      if (looksLikeHeading(firstChunk)) candidates.push({ page: p.pageNumber, title: cleanTitle(firstChunk) });
    }

    let chapters: Chapter[] =
      candidates.length >= 2
        ? candidates.map((c, idx) => {
            const startPage = c.page;
            const endPage = (candidates[idx + 1]?.page ?? (numPages + 1)) - 1;
            return {
              index: idx + 1,
              title: c.title || `Chapter ${idx + 1}`,
              startPage,
              endPage: Math.max(startPage, Math.min(endPage, numPages)),
            };
          })
        : [{ index: 1, title: "Document", startPage: 1, endPage: numPages }];

    // ✅ Ensure pages 1..(firstStart-1) are included
    const firstStart = chapters[0]?.startPage ?? 1;
    if (firstStart > 1) {
      const frontMatter: Chapter = {
        index: 1,
        title: "Front Matter",
        startPage: 1,
        endPage: firstStart - 1,
      };

      chapters = [
        frontMatter,
        ...chapters.map((c) => ({ ...c, index: c.index + 1 })),
      ];
    }

    return NextResponse.json({
      numPages,
      chapters,
      extractedUrl: extractedBlob.url,
    });
  } catch (err: any) {
    console.error("CHAPTERS_ERROR:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to detect chapters" },
      { status: 500 }
    );
  }
}