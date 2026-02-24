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

let pdfjsLibPromise: Promise<any> | null = null;

async function loadPdfJs() {
  if (!pdfjsLibPromise) {
    ensureDomMatrixPolyfill();
    pdfjsLibPromise = Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
    ]).then(([pdfMod, workerMod]: any[]) => {
      // Seed the worker module to avoid pdfjs dynamic worker import resolution in serverless bundles.
      (globalThis as any).pdfjsWorker = workerMod;
      const pdfjsLib = pdfMod?.getDocument ? pdfMod : pdfMod?.default ?? pdfMod;
      return pdfjsLib;
    });
  }
  return pdfjsLibPromise;
}

export async function extractPagesFromPdfBuffer(pdfBuffer: Buffer): Promise<ExtractedPages> {
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

    const strings = content.items
      .map((it: any) => (typeof it.str === "string" ? it.str : ""))
      .filter(Boolean);

    const text = strings.join(" ").replace(/\s+/g, " ").trim();
    pages.push({ pageNumber: i, text });
  }

  return { numPages: pdf.numPages, pages };
}
