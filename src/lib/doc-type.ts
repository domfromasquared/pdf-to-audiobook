export type DocType = "book" | "report" | "paper" | "slides" | "manual" | "unknown";

type PageText = { pageNumber: number; text: string };

function countMatches(text: string, re: RegExp) {
  const m = text.match(re);
  return m ? m.length : 0;
}

export function inferDocType(
  pages: PageText[],
  options?: { tocPageNumber?: number | null }
): { docType: DocType; scores: Record<Exclude<DocType, "unknown">, number> } {
  const tocPageNumber = options?.tocPageNumber ?? null;
  const headPages = pages.slice(0, 5);
  const tocPage = tocPageNumber
    ? pages.find((p) => p.pageNumber === tocPageNumber) || null
    : null;

  const sample = [...headPages.map((p) => p.text), tocPage?.text || ""].join("\n\n");
  const text = sample.toLowerCase();

  const wordsPerPage =
    headPages.length > 0
      ? headPages.reduce((acc, p) => acc + (p.text.match(/\S+/g)?.length || 0), 0) /
        headPages.length
      : 0;
  const shortLineRatio = (() => {
    const lines = sample
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return 0;
    const shortLines = lines.filter((l) => l.split(/\s+/).length <= 6).length;
    return shortLines / lines.length;
  })();
  const bulletCount = countMatches(sample, /^[ \t]*[-*•●▪◦]/gm);

  const scores: Record<Exclude<DocType, "unknown">, number> = {
    book: 0,
    report: 0,
    paper: 0,
    slides: 0,
    manual: 0,
  };

  scores.book += countMatches(text, /\btable of contents\b/g) * 3;
  scores.book += countMatches(text, /\bcontents\b/g);
  scores.book += countMatches(text, /\bchapter\b/g) * 2;
  scores.book += countMatches(text, /\bprologue\b|\bepilogue\b/g) * 2;

  scores.paper += countMatches(text, /\babstract\b/g) * 3;
  scores.paper += countMatches(text, /\breferences\b|\bbibliography\b/g) * 2;
  scores.paper += countMatches(text, /\bintroduction\b|\bmethodology\b|\bresults\b|\bdiscussion\b/g);

  scores.report += countMatches(text, /\bexecutive summary\b/g) * 3;
  scores.report += countMatches(text, /\bfindings\b|\brecommendations\b|\bconclusion\b/g) * 2;

  scores.manual += countMatches(text, /\binstallation\b|\bsetup\b|\btroubleshooting\b|\bwarning\b/g) * 2;
  scores.manual += countMatches(text, /\bstep\s+\d+\b/g) * 2;

  if (wordsPerPage > 0 && wordsPerPage < 90) scores.slides += 3;
  if (shortLineRatio > 0.45) scores.slides += 2;
  if (bulletCount >= 8) scores.slides += 2;

  const ordered = (Object.entries(scores) as Array<[Exclude<DocType, "unknown">, number]>).sort(
    (a, b) => b[1] - a[1]
  );
  const [bestType, bestScore] = ordered[0];

  if (bestScore < 2) {
    return { docType: "unknown", scores };
  }

  return { docType: bestType, scores };
}

