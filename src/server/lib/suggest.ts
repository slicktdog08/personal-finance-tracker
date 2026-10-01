// Suggest categorization rules from transaction descriptions (pure, no DB).
// Generates multi-word phrases (n-grams) and prefers the LONGEST specific phrase that
// still covers most of a cluster — longer patterns are less likely to catch unrelated
// transactions. Patterns are matched as case-insensitive substrings (same as the LIKE
// rule that gets saved), so a phrase is only kept if it actually appears in descriptions.

export interface Suggestion {
  pattern: string;
  matchCount: number; // # uncategorized transactions whose description contains the phrase
  suggestedCategory: string | null;
  samples: string[];
}

const MAX_NGRAM = 4;
const MIN_PATTERN_LEN = 4;

// Words that carry no merchant meaning in bank descriptions.
// Generic banking boilerplate only — NOT merchant words like "trip" (Uber Trip) or
// "help", which form useful multi-word merchant phrases.
const NOISE = new Set([
  "purchase", "card", "debit", "credit", "digital", "payment", "pos", "the", "from",
  "to", "of", "and", "for", "llc", "inc", "co", "com", "http", "https", "www",
  "ach", "online", "bill", "pmt", "des", "indn", "ppd", "web", "mobile", "thank",
  "you", "recurring", "autopay", "transaction", "withdrawal", "deposit", "transfer",
  "checkcard", "sale", "fee", "charge", "ref", "auth", "date", "number", "acct",
  "via", "sent", "received", "money", "app", "payout", "dir", "dep", "withdraw",
]);

export function tokens(desc: string): string[] {
  return desc
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(
      (t) =>
        t.length >= 3 &&
        !/^\d+$/.test(t) &&
        !/^x+\d*$/i.test(t) &&
        !NOISE.has(t.toLowerCase()),
    );
}

// Contiguous 1..maxN word phrases from a cleaned token list.
function ngrams(toks: string[], maxN: number): string[] {
  const out: string[] = [];
  for (let n = 1; n <= maxN; n++) {
    for (let i = 0; i + n <= toks.length; i++) {
      out.push(toks.slice(i, i + n).join(" "));
    }
  }
  return out;
}

const wordCount = (p: string) => p.split(" ").length;

export function computeSuggestions(
  uncategorized: string[],
  categorized: { description: string; category: string }[],
  limit = 20,
  minCount = 3,
): Suggestion[] {
  const upper = uncategorized.map((d) => d.toUpperCase());

  // Candidate phrases (deduped) from cleaned tokens.
  const candidates = new Set<string>();
  for (const d of uncategorized) {
    for (const g of ngrams(tokens(d), MAX_NGRAM)) {
      if (g.length >= MIN_PATTERN_LEN) candidates.add(g);
    }
  }

  // Count real (substring) matches across uncategorized descriptions.
  const info = new Map<string, { count: number; samples: string[] }>();
  for (const g of candidates) {
    let count = 0;
    const samples: string[] = [];
    for (let i = 0; i < upper.length; i++) {
      if (upper[i].includes(g)) {
        count++;
        if (samples.length < 3) samples.push(uncategorized[i]);
      }
    }
    if (count >= minCount) info.set(g, { count, samples });
  }

  // Domination: drop a phrase if a LONGER superstring covers ~the same set (>=80%).
  // This keeps "UBER TRIP" over the broader "UBER" when coverage is similar.
  const phrases = [...info.keys()];
  const dropped = new Set<string>();
  for (const g of phrases) {
    const gc = info.get(g)!.count;
    for (const h of phrases) {
      if (h === g || h.length <= g.length) continue;
      if (h.includes(g) && info.get(h)!.count >= gc * 0.8) {
        dropped.add(g);
        break;
      }
    }
  }
  const survivors = phrases.filter((p) => !dropped.has(p));

  // Category inference from already-categorized descriptions containing the phrase.
  const catUpper = categorized.map((c) => ({ u: c.description.toUpperCase(), category: c.category }));
  const inferCategory = (phrase: string): string | null => {
    const tally = new Map<string, number>();
    let total = 0;
    for (const c of catUpper) {
      if (c.u.includes(phrase)) {
        total++;
        tally.set(c.category, (tally.get(c.category) ?? 0) + 1);
      }
    }
    if (!total) return null;
    let best = "";
    let bestN = 0;
    for (const [cat, n] of tally) if (n > bestN) ((bestN = n), (best = cat));
    return bestN / total >= 0.6 && bestN >= 2 ? best : null;
  };

  // Rank: coverage first, then prefer more words / longer (specificity).
  survivors.sort(
    (a, b) =>
      info.get(b)!.count - info.get(a)!.count ||
      wordCount(b) - wordCount(a) ||
      b.length - a.length,
  );

  return survivors.slice(0, limit).map((p) => ({
    pattern: p,
    matchCount: info.get(p)!.count,
    suggestedCategory: inferCategory(p),
    samples: info.get(p)!.samples,
  }));
}

// Best single phrase derived from ONE description: the longest phrase that still matches
// most of the uncategorized set it could (so it's specific but still useful in bulk).
export function bestPhraseForDescription(
  description: string,
  uncategorized: string[],
): { pattern: string; matchCount: number } | null {
  const cands = [...new Set(ngrams(tokens(description), MAX_NGRAM).filter((g) => g.length >= MIN_PATTERN_LEN))];
  if (!cands.length) return null;
  const upper = uncategorized.map((d) => d.toUpperCase());

  const counted = cands
    .map((g) => ({ g, count: upper.reduce((n, u) => n + (u.includes(g) ? 1 : 0), 0) }))
    .filter((x) => x.count >= 1);
  if (!counted.length) return null;

  // Keep phrases whose coverage is within 80% of the best, then prefer the most words
  // (multi-word > single), then higher coverage, then longer text.
  const maxCount = Math.max(...counted.map((x) => x.count));
  const threshold = Math.max(1, maxCount * 0.8);
  const eligible = counted.filter((x) => x.count >= threshold);
  eligible.sort(
    (a, b) => wordCount(b.g) - wordCount(a.g) || b.count - a.count || b.g.length - a.g.length,
  );
  const pick = eligible[0];
  return { pattern: pick.g, matchCount: pick.count };
}
