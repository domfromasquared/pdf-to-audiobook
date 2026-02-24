import { PDFParse } from "pdf-parse";

export type ExtractedPages = {
  numPages: number;
  pages: { pageNumber: number; text: string }[];
};

async function extractWithPdfParse(pdfBuffer: Buffer): Promise<ExtractedPages> {
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

function ensureDomMatrixPolyfill() {
  if (typeof (globalThis as any).DOMMatrix !== "undefined") return;
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    constructor(_init?: any) {}
    multiplySelf() { return this; }
    translateSelf() { return this; }
    scaleSelf() { return this; }
    rotateSelf() { return this; }
    skewXSelf() { return this; }
    skewYSelf() { return this; }
    inverse() { return this; }
    toFloat64Array() { return new Float64Array([this.a, this.b, this.c, this.d, this.e, this.f]); }
  };
}

let pdfjsLibPromise: Promise<any> | null = null;
async function loadPdfJs() {
  if (!pdfjsLibPromise) {
    ensureDomMatrixPolyfill();
    pdfjsLibPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((mod: any) =>
      mod?.getDocument ? mod : mod?.default ?? mod
    );
  }
  return pdfjsLibPromise;
}

async function extractWithPdfJs(pdfBuffer: Buffer): Promise<ExtractedPages> {
  const pdfjsLib = await loadPdfJs();
  const data = new Uint8Array(pdfBuffer);
  const loadingTask = pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;

  const pages: { pageNumber: number; text: string }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it: any) => (typeof it.str === "string" ? it.str : ""))
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push({ pageNumber: i, text });
  }

  return { numPages: pdf.numPages, pages };
}

export async function extractPagesFromPdfBuffer(pdfBuffer: Buffer): Promise<ExtractedPages> {
  try {
    return await extractWithPdfParse(pdfBuffer);
  } catch (pdfParseErr: any) {
    try {
      return await extractWithPdfJs(pdfBuffer);
    } catch (pdfJsErr: any) {
      const p1 = pdfParseErr?.message || "pdf-parse failed";
      const p2 = pdfJsErr?.message || "pdfjs failed";
      throw new Error(`Failed to extract PDF pages (${p1}; ${p2})`);
    }
  }
}
