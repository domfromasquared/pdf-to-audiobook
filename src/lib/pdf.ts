import { PDFParse } from "pdf-parse";

async function fetchPrivateBlobAsUint8Array(baseUrl: string, blobUrl: string): Promise<Uint8Array> {
  const res = await fetch(`${baseUrl}/api/blob-bytes?url=${encodeURIComponent(blobUrl)}`);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`blob-bytes failed (${res.status}): ${txt}`);
  }
  const ab = await res.arrayBuffer();
  return new Uint8Array(ab);
}

export async function extractPdfPagesFromPrivateBlob(baseUrl: string, pdfUrl: string) {
  const data = await fetchPrivateBlobAsUint8Array(baseUrl, pdfUrl);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText({ pageJoiner: "" });
    const pages = (result.pages || []).map((p: any) => ({
      pageNumber: Number(p?.num || 0),
      text: String(p?.text || "").replace(/\s+/g, " ").trim(),
    }));

    const normalized = pages.filter((p) => Number.isFinite(p.pageNumber) && p.pageNumber > 0);
    return { numPages: normalized.length, pages: normalized };
  } finally {
    await parser.destroy().catch(() => {});
  }
}
