// src/lib/extract-pages.ts
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export type ExtractedPages = {
  numPages: number;
  pages: { pageNumber: number; text: string }[];
};

export async function extractPagesFromPdfBuffer(pdfBuffer: Buffer): Promise<ExtractedPages> {
  const data = new Uint8Array(pdfBuffer);

  const loadingTask = (pdfjsLib as any).getDocument({ data });
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