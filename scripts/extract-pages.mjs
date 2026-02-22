import fs from "fs";

// ESM import (this matches your installed pdfjs-dist files)
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error(JSON.stringify({ error: "Missing inputPath" }));
    process.exit(1);
  }

  const data = new Uint8Array(fs.readFileSync(inputPath));
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    const strings = content.items
      .map((it) => (typeof it.str === "string" ? it.str : ""))
      .filter(Boolean);

    const text = strings.join(" ").replace(/\s+/g, " ").trim();
    pages.push({ pageNumber: i, text });
  }

  process.stdout.write(JSON.stringify({ numPages: pdf.numPages, pages }));
}

main().catch((err) => {
  process.stderr.write(err?.stack || String(err));
  process.exit(1);
});