import { PDFParse } from "pdf-parse";

export type ExtractedPages = {
  numPages: number;
  pages: { pageNumber: number; text: string }[];
};

export async function extractPagesFromPdfBuffer(pdfBuffer: Buffer): Promise<ExtractedPages> {
  const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
  try {
    const result = await parser.getText({ pageJoiner: "" });

    const pages = (result.pages || [])
      .map((p: any) => ({
        pageNumber: Number(p?.num || 0),
        text: String(p?.text || "").replace(/\s+/g, " ").trim(),
      }))
      .filter((p) => Number.isFinite(p.pageNumber) && p.pageNumber > 0);

    return {
      numPages: pages.length,
      pages,
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}
