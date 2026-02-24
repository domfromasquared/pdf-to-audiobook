import { createRequire } from "module";

export type ExtractedPages = {
  numPages: number;
  pages: { pageNumber: number; text: string }[];
};

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

let PDFParseCtorPromise: Promise<any> | null = null;
const require = createRequire(import.meta.url);

async function loadPDFParseCtor() {
  if (!PDFParseCtorPromise) {
    ensureDomMatrixPolyfill();
    PDFParseCtorPromise = Promise.resolve().then(() => require("pdf-parse").PDFParse);
  }
  return PDFParseCtorPromise;
}

export async function extractPagesFromPdfBuffer(pdfBuffer: Buffer): Promise<ExtractedPages> {
  const PDFParse = await loadPDFParseCtor();
  if (typeof (PDFParse as any).setWorker === "function") {
    (PDFParse as any).setWorker(
      "https://cdn.jsdelivr.net/npm/pdf-parse@2.4.5/dist/pdf-parse/web/pdf.worker.min.mjs"
    );
  }

  const parser = new PDFParse({
    data: new Uint8Array(pdfBuffer),
    // Keep parsing on the server side when possible.
    disableWorker: true,
    worker: null,
  } as any);

  try {
    const result = await parser.getText({ pageJoiner: "" });

    const pages: { pageNumber: number; text: string }[] = (result.pages || [])
      .map((p: any) => ({
        pageNumber: Number(p?.num || 0),
        text: String(p?.text || "").replace(/\s+/g, " ").trim(),
      }))
      .filter((p: { pageNumber: number; text: string }) => Number.isFinite(p.pageNumber) && p.pageNumber > 0);

    return {
      numPages: pages.length,
      pages,
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}
