/**
 * Folds text so keyword matching ignores case, accents, curly quotes and runs of whitespace.
 * Both keywords and scanned text go through this, so they always agree.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
