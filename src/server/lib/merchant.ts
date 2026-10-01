// Reduce a bank transaction description to a stable "merchant key" for grouping
// recurring charges. Uppercase, strip punctuation, and drop any token containing
// a digit (store numbers, dates, reference codes) — so "NETFLIX.COM 8663" and
// "NETFLIX.COM 4941" both key to "NETFLIX COM". The result contains only
// [A-Z0-9] tokens separated by single spaces, which also makes it safe to embed
// in a LIKE clause. Returns "" when the description is all noise.
export function normalizeMerchant(desc: string): string {
  return desc
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ") // punctuation → space
    .split(/\s+/)
    .filter((tok) => tok.length > 0 && !/\d/.test(tok)) // drop tokens with any digit
    .join(" ")
    .trim();
}
