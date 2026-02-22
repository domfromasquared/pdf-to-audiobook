import { head } from "@vercel/blob";

async function fetchPrivateBlobAsUint8Array(baseUrl: string, blobUrl: string): Promise<Uint8Array> {
  const res = await fetch(`${baseUrl}/api/blob-bytes?url=${encodeURIComponent(blobUrl)}`);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`blob-bytes failed (${res.status}): ${txt}`);
  }
  const ab = await res.arrayBuffer();
  return new Uint8Array(ab);
}

async function loadPdfJs() {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsLib as any;
}

export async function extractPdfPagesFromPrivateBlob(baseUrl: string, pdfUrl: string) {
  const data = await fetchPrivateBlobAsUint8Array(baseUrl, pdfUrl);

  const pdfjsMod: any = await loadPdfJs();
  const pdfjsLib: any = pdfjsMod?.getDocument ? pdfjsMod : pdfjsMod?.default ?? pdfjsMod;

  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  const pages: { pageNumber: number; text: string }[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    const strings = content.items
      .map((it: any) => (typeof it.str === "string" ? it.str : ""))
      .filter(Boolean);

    const text = strings.join(" ").replace(/\s+/g, " ").trim();
    pages.push({ pageNumber: i, text });
  }

  return { numPages: pdf.numPages, pages };
}