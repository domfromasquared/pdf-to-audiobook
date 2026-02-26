export type LayoutLine = {
  text: string;
  fontSize: number;
  fontName?: string;
  indent: number;
};

export type ExtractedPages = {
  numPages: number;
  pages: { pageNumber: number; text: string; lines: LayoutLine[]; maxFontSize: number }[];
};

function ensureDomMatrixPolyfill() {
  if (typeof (globalThis as any).DOMMatrix !== "undefined") return;
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    constructor(_init?: any) {}
    multiplySelf() {
      return this;
    }
    translateSelf() {
      return this;
    }
    scaleSelf() {
      return this;
    }
    rotateSelf() {
      return this;
    }
    skewXSelf() {
      return this;
    }
    skewYSelf() {
      return this;
    }
    inverse() {
      return this;
    }
    toFloat64Array() {
      return new Float64Array([this.a, this.b, this.c, this.d, this.e, this.f]);
    }
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
  const pages: ExtractedPages["pages"] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    const rows = new Map<number, LayoutLine[]>();
    let pageMaxFont = 0;

    for (const item of content.items) {
      const raw = (item as any).str;
      if (!raw || typeof raw !== "string") continue;
      const text = raw.replace(/\s+/g, " ").trim();
      if (!text) continue;

      const transform = (item as any).transform as number[] | undefined;
      const y = transform && typeof transform[5] === "number" ? transform[5] : 0;
      const x = transform && typeof transform[4] === "number" ? transform[4] : 0;
      const fontSize = Math.abs(
        (transform && transform[3] ? transform[3] : 0) || (item as any).height || (item as any).fontSize || 0
      );
      const fontName = (item as any).fontName;

      pageMaxFont = Math.max(pageMaxFont, fontSize);
      const bucket = Math.round(y * 100);
      const list = rows.get(bucket) || [];
      list.push({ text, fontSize, indent: x, fontName });
      rows.set(bucket, list);
    }

    const sortedRows = Array.from(rows.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, parts]) =>
        parts
          .sort((a, b) => a.indent - b.indent)
          .reduce(
            (acc, part) => {
              acc.text = acc.text ? `${acc.text} ${part.text}` : part.text;
              acc.fontSize = Math.max(acc.fontSize, part.fontSize);
              acc.indent = Math.min(acc.indent, part.indent);
              acc.fontName = acc.fontName || part.fontName;
              return acc;
            },
            { text: "", fontSize: 0, indent: parts[0]?.indent ?? 0, fontName: parts[0]?.fontName }
          )
      )
      .filter((row) => row.text.trim())
      .map((row) => ({ text: row.text.trim(), fontSize: row.fontSize, indent: Math.max(0, row.indent), fontName: row.fontName }));

    const strings = content.items
      .map((it: any) => (typeof it.str === "string" ? it.str : ""))
      .filter(Boolean);

    const text = strings.join(" ").replace(/\s+/g, " ").trim();
    pages.push({ pageNumber: i, text, lines: sortedRows, maxFontSize: pageMaxFont });
  }

  return { numPages: pdf.numPages, pages };
}
