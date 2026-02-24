// src/lib/extract-pages.ts

// --- Server polyfills for pdfjs in Node ---
declare global {
  // eslint-disable-next-line no-var
  var DOMMatrix: any;
}

// Minimal DOMMatrix polyfill (pdfjs uses it for transforms)
if (typeof (globalThis as any).DOMMatrix === "undefined") {
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

// IMPORTANT: use legacy build in Node
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export type ExtractedPages = {
  numPages: number;
  pages: { pageNumber: number; text: string }[];
};

export async function extractPagesFromPdfBuffer(pdfBuffer: Buffer): Promise<ExtractedPages> {
  const data = new Uint8Array(pdfBuffer);

  const loadingTask = (pdfjsLib as any).getDocument({
    data,
    // These options reduce Node/browser coupling
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