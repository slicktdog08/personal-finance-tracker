// Suggest categorization rules from transaction descriptions (pure, no DB).
//
// A bank description is, almost always, `[boilerplate] [processor*] MERCHANT [store #] [CITY ST]`.
// The part worth matching on is MERCHANT — so instead of scoring every phrase by how often it
// occurs (which crowns the city and the state: the words shared by the most transactions), this reads
// the description's structure, takes the merchant name, and leaves the rest out:
//
//   "TST* DEMO CANTINA ANYTOWN CA"            → "DEMO CANTINA"
//   "Debit Card Purchase - KROGER #331 ..."   → "KROGER"
//   "SQ *JOES GRILL 8842"                     → "JOES GRILL"
//
// Patterns are always a verbatim slice of the description, because the saved rule is a
// case-insensitive "contains" — a phrase that doesn't appear as written would match nothing.

export interface Suggestion {
  pattern: string;
  matchCount: number; // # uncategorized transactions whose description contains the phrase
  suggestedCategory: string | null;
  samples: string[];
}

/** One description with the category it has now (null = uncategorized). `n` = how many rows. */
export interface CorpusRow {
  description: string;
  category: string | null;
  n?: number;
}

export interface SuggestContext {
  /** City words learned from the ledger (upper-cased) — see `learnPlaces`. */
  places?: ReadonlySet<string>;
}

export type WordKind = "name" | "code" | "place" | "filler";

/** A whitespace-separated piece of a description, with where it sits in the original text. */
export interface DescWord {
  text: string;
  start: number;
  end: number;
  /** name = part of a merchant name; code = store / reference number; place = city or state;
   *  filler = bank boilerplate or a card-processor prefix. */
  kind: WordKind;
  /** Part of the suggested merchant phrase. */
  merchant: boolean;
}

const MAX_WORDS = 4;
const MIN_PATTERN_LEN = 3;

const STATES = new Set(
  ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ " +
    "NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split(" "),
);
const STATE_NAMES = new Set(
  ("ALABAMA ALASKA ARIZONA ARKANSAS CALIFORNIA COLORADO CONNECTICUT DELAWARE FLORIDA GEORGIA HAWAII " +
    "IDAHO ILLINOIS INDIANA IOWA KANSAS KENTUCKY LOUISIANA MAINE MARYLAND MASSACHUSETTS MICHIGAN " +
    "MINNESOTA MISSISSIPPI MISSOURI MONTANA NEBRASKA NEVADA OHIO OKLAHOMA OREGON PENNSYLVANIA " +
    "TENNESSEE TEXAS UTAH VERMONT VIRGINIA WASHINGTON WISCONSIN WYOMING").split(" "),
);
const COUNTRY = new Set(["US", "USA"]);
// First words of two-word city names, so "FORT SAMPLE CA" loses both.
const CITY_LEADS = new Set(
  "SAN SANTA NEW LOS LAS FORT FT EL ST SAINT PORT MOUNT MT NORTH SOUTH EAST WEST LAKE GRAND".split(" "),
);
// Card processors that sit in front of the real merchant: "SQ *JOES GRILL", "TST* DEMO CANTINA".
// Any other 1–3 letter tag in front of a `*` is treated the same way.
const PROCESSORS = new Set(["PAYPAL", "GOOGLE", "CTLP", "TOAST", "SQUARE", "SHOPIFY", "CLOVER", "VENMO", "ZSK"]);
// ACH field labels — everything from here on is ids and names of the paying bank.
const HARD_STOPS = new Set(["PPD", "CCD", "WEB", "TEL", "INDN", "DES", "ID", "REF", "TRACE", "CONF", "DIR"]);

// What banks wrap around the merchant. Matched (repeatedly) at the start of the description.
const BOILERPLATE = new RegExp(
  "^(?:" +
    [
      "(?:DEBIT|CREDIT|DIGITAL|CHECK)\\s*CARD(?:\\s+(?:PURCHASE|PAYMENT|WITHDRAWAL|REFUND))?",
      "POS(?:\\s+(?:DEBIT|PURCHASE|WITHDRAWAL|REFUND))?",
      "POINT\\s+OF\\s+SALE(?:\\s+(?:DEBIT|PURCHASE|WITHDRAWAL))?",
      "(?:RECURRING\\s+)?(?:PURCHASE|PAYMENT)\\s+AUTHORIZED\\s+ON",
      "RECURRING(?:\\s+(?:PAYMENT|PURCHASE|DEBIT))?",
      "ACH(?:\\s+(?:DEBIT|CREDIT|WITHDRAWAL|DEPOSIT|PAYMENT|TRANSACTION))?",
      "(?:WITHDRAWAL|DEPOSIT)\\s+(?:FROM|TO)",
      "PRE-?AUTHORIZED\\s+(?:DEBIT|CREDIT|PAYMENT)",
      "ELECTRONIC\\s+(?:PAYMENT|WITHDRAWAL|DEPOSIT)",
      "EXTERNAL\\s+(?:WITHDRAWAL|DEPOSIT)",
      "DIRECT\\s+(?:DEP(?:OSIT)?|DEBIT)",
      "ONLINE\\s+(?:PAYMENT|PURCHASE)(?:\\s+TO)?",
      "BILL\\s*PAY(?:MENT)?(?:\\s+TO)?",
      "PURCHASE",
      "CHECKCARD",
      "VISA",
    ].join("|") +
    ")(?![A-Z0-9])[\\s\\-–—:]*",
  "i",
);

const core = (text: string) => text.replace(/^[^A-Za-z0-9#]+|[^A-Za-z0-9]+$/g, "");

function isCode(c: string, afterName: boolean): boolean {
  if (c.startsWith("#")) return true;
  if ((c.match(/\d/g)?.length ?? 0) >= 3) return true;
  if (/^\d+(?:[\/\-.:]\d+)+$/.test(c)) return true; // dates, times, phone pieces
  if (/^x{2,}\d*$/i.test(c)) return true; // masked account numbers
  // A bare one- or two-digit number is a store number after a name ("SAMPLE GROCER 12") but part
  // of the name in front of it ("24 HOUR GYM").
  return afterName && /^\d{1,2}$/.test(c);
}

interface Tok {
  text: string;
  start: number;
  end: number;
  core: string;
  upper: string;
  /** A `*` follows this token (possibly after spaces): "SQ *", "TST*". */
  star: boolean;
}

function scan(description: string): Tok[] {
  const out: Tok[] = [];
  const re = /[^\s*]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(description))) {
    const c = core(m[0]);
    out.push({
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
      core: c,
      upper: c.toUpperCase(),
      star: /^\s*\*/.test(description.slice(m.index + m[0].length)),
    });
  }
  return out;
}

// Index of the trailing state ("… ANYTOWN CA", "… Anytown, California"), or -1. Needs something in front of it to be a location rather than a word.
function stateIndex(toks: Tok[]): number {
  let i = toks.length - 1;
  // Card statements append a zip, a country, a reference or "CARD 1234" after the state.
  while (i > 1 && (COUNTRY.has(toks[i].core) || toks[i].upper === "CARD" || isCode(toks[i].core, true))) i--;
  if (i < 1) return -1;
  const t = toks[i];
  if (/^[A-Z]{2}$/.test(t.core) && STATES.has(t.core)) return i;
  if (STATE_NAMES.has(t.upper) && /,$/.test(toks[i - 1].text)) return i;
  return -1;
}

interface Parsed {
  toks: Tok[];
  kinds: WordKind[];
  /** Token indexes of the merchant phrase, in order (contiguous). */
  run: number[];
}

function parse(description: string, ctx: SuggestContext, stripLead: boolean): Parsed {
  const toks = scan(description);
  const kinds: WordKind[] = toks.map(() => "name");
  const places = ctx.places;

  // ---- leading boilerplate and processor prefix ----
  let first = 0;
  if (stripLead) {
    let cut = 0;
    for (let pass = 0; pass < 3; pass++) {
      const m = BOILERPLATE.exec(description.slice(cut));
      if (!m || !m[0].length) break;
      cut += m[0].length;
    }
    while (first < toks.length && toks[first].start < cut) kinds[first++] = "filler";
  }
  // Dates and reference numbers ahead of the name ("CHECKCARD 0102 STARBUCKS").
  while (first < toks.length && (!toks[first].core || isCode(toks[first].core, false))) {
    kinds[first] = toks[first].core ? "code" : "filler";
    first++;
  }
  if (
    first < toks.length - 1 &&
    toks[first].star &&
    (PROCESSORS.has(toks[first].upper) || /^[A-Z]{1,3}$/.test(toks[first].upper))
  ) {
    kinds[first++] = "filler";
  }

  // ---- trailing location (never eats the first word of the name) ----
  const s = stateIndex(toks);
  if (s >= 0) {
    for (let i = s; i < toks.length; i++) kinds[i] = "place";
    let i = s - 1;
    let learned = 0;
    while (i > first && learned < 3 && places?.has(toks[i].upper)) {
      kinds[i--] = "place";
      learned++;
    }
    if (!learned && i > first && toks[i].core && !isCode(toks[i].core, true)) {
      // No evidence about this city: assume the usual one word, two for "SAN …", "NEW …".
      kinds[i] = "place";
      if (i - 1 > first && CITY_LEADS.has(toks[i - 1].upper)) kinds[i - 1] = "place";
    }
  }

  // ---- the merchant: the run of name words from there ----
  const run: number[] = [];
  for (let i = first; i < toks.length; i++) {
    const t = toks[i];
    if (kinds[i] === "place") break;
    if (!t.core) {
      kinds[i] = "filler";
      if (run.length) break;
      continue;
    }
    if (isCode(t.core, run.length > 0)) {
      kinds[i] = "code";
      if (run.length) break;
      continue;
    }
    if (run.length && (HARD_STOPS.has(t.upper) || t.text.includes(":") || places?.has(t.upper))) break;
    run.push(i);
    if (run.length === MAX_WORDS) break;
  }
  // Classify what's left after the run, for the editor's word chips.
  const last = run.length ? run[run.length - 1] : first - 1;
  for (let i = last + 1; i < toks.length; i++) {
    if (kinds[i] !== "name") continue;
    if (!toks[i].core) kinds[i] = "filler";
    else if (isCode(toks[i].core, true)) kinds[i] = "code";
    else if (places?.has(toks[i].upper)) kinds[i] = "place";
  }
  return { toks, kinds, run };
}

const slice = (description: string, p: Parsed, from: number, to: number) =>
  description.slice(p.toks[from].start, p.toks[to].start + trimmedLength(p.toks[to].text));

// "CANTINA," → keep "CANTINA"; "NETFLIX.COM" and "JOE'S" are left whole.
function trimmedLength(text: string): number {
  return text.replace(/[^A-Za-z0-9)\]'’]+$/, "").length || text.length;
}

function parseBest(description: string, ctx: SuggestContext): Parsed {
  const p = parse(description, ctx, true);
  // "PAYMENT THANK YOU", "POS DEBIT": nothing but boilerplate — then the boilerplate is the name.
  return p.run.length ? p : parse(description, ctx, false);
}

/**
 * The merchant part of one description — the default pattern for a rule made from it.
 * Falls back to the whole (trimmed) description when there's no usable name in it.
 */
export function merchantPhrase(description: string, ctx: SuggestContext = {}): string {
  const whole = description.trim().slice(0, 255);
  const p = parseBest(description, ctx);
  if (!p.run.length) return whole;
  const phrase = slice(description, p, p.run[0], p.run[p.run.length - 1]);
  return phrase.length >= MIN_PATTERN_LEN ? phrase.slice(0, 255) : whole;
}

/** The description's words, classified — the rule editor shows them as tap-to-pick chips. */
export function describeWords(description: string, ctx: SuggestContext = {}): DescWord[] {
  const p = parseBest(description, ctx);
  const inRun = new Set(p.run);
  return p.toks.map((t, i) => ({ text: t.text, start: t.start, end: t.end, kind: p.kinds[i], merchant: inRun.has(i) }));
}

/** The text a contiguous pick of words stands for: a verbatim slice, minus trailing punctuation. */
export function phraseFromWords(description: string, words: DescWord[], from: number, to: number): string {
  if (!words.length) return "";
  const a = words[Math.max(0, Math.min(from, to))];
  const b = words[Math.min(words.length - 1, Math.max(from, to))];
  return description.slice(a.start, b.start + trimmedLength(b.text));
}

/** Which words a pattern covers in this description (first occurrence), or null if it isn't there. */
export function wordsCovered(description: string, words: DescWord[], pattern: string): [number, number] | null {
  const p = pattern.trim();
  if (!p) return null;
  const at = description.toUpperCase().indexOf(p.toUpperCase());
  if (at < 0) return null;
  const end = at + p.length;
  let from = -1;
  let to = -1;
  words.forEach((w, i) => {
    if (w.end > at && w.start < end) {
      if (from < 0) from = i;
      to = i;
    }
  });
  return from < 0 ? null : [from, to];
}

/**
 * City words, learned from the ledger itself: a word that sits right before a trailing state on
 * descriptions from two or more different merchants is a place, not part of anyone's name. This
 * is what lets "STARBUCKS ANYTOWN" (no state) still come out as "STARBUCKS".
 */
export function learnPlaces(descriptions: Iterable<string>): Set<string> {
  const leads = new Map<string, Set<string>>();
  for (const d of descriptions) {
    const toks = scan(d);
    const s = stateIndex(toks);
    if (s < 2) continue;
    const city = toks[s - 1];
    if (!city.core || isCode(city.core, true) || city.upper.length < 3) continue;
    const p = parse(d, {}, true);
    const lead = p.run.length ? toks[p.run[0]].upper : toks[0].upper;
    if (lead === city.upper) continue;
    let set = leads.get(city.upper);
    if (!set) leads.set(city.upper, (set = new Set()));
    set.add(lead);
  }
  const out = new Set<string>();
  for (const [city, set] of leads) if (set.size >= 2) out.add(city);
  return out;
}

export interface RuleOption {
  pattern: string;
  /** Uncategorized transactions it would categorize right now. */
  matchCount: number;
  /** Already-categorized transactions it also matches that sit in a DIFFERENT category —
   *  a sign the pattern is too broad. Left alone by the rule, but future ones wouldn't be. */
  conflicts: number;
}

export interface RuleSuggestion extends RuleOption {
  /** Shorter and longer versions of the same merchant phrase, broadest first. */
  alternatives: RuleOption[];
}

/**
 * The rule to offer after someone categorizes `description` as `category`.
 *
 * Default: the full merchant phrase — specific, and it always keeps the brand name. It is only
 * shortened ("AMAZON MKTPL" → "AMAZON") when the ledger already shows the shorter phrase means
 * the same category: other descriptions under it were put there, and none anywhere else.
 */
export function suggestRule(
  description: string,
  corpus: CorpusRow[],
  category: string | null = null,
  ctx?: SuggestContext,
): RuleSuggestion {
  const context = ctx ?? { places: learnPlaces(corpus.map((c) => c.description)) };
  const p = parseBest(description, context);
  const upper = corpus.map((c) => c.description.toUpperCase());
  const stats = (pattern: string): RuleOption => {
    const needle = pattern.toUpperCase();
    let matchCount = 0;
    let conflicts = 0;
    for (let i = 0; i < corpus.length; i++) {
      if (!upper[i].includes(needle)) continue;
      const c = corpus[i];
      if (!c.category) matchCount += c.n ?? 1;
      else if (category && c.category !== category) conflicts += c.n ?? 1;
    }
    return { pattern, matchCount, conflicts };
  };
  const agreeing = (pattern: string) => {
    const needle = pattern.toUpperCase();
    let n = 0;
    for (let i = 0; i < corpus.length; i++) {
      if (corpus[i].category && corpus[i].category === category && upper[i].includes(needle)) n += corpus[i].n ?? 1;
    }
    return n;
  };

  const full = merchantPhrase(description, context);
  const prefixes: string[] = [];
  for (let k = 0; k < p.run.length; k++) {
    const phrase = slice(description, p, p.run[0], p.run[k]);
    if (phrase.length >= MIN_PATTERN_LEN && phrase !== prefixes[prefixes.length - 1]) prefixes.push(phrase);
  }
  if (!prefixes.includes(full)) prefixes.push(full);

  const options = prefixes.map(stats);
  let pick = options[options.length - 1];
  if (category) {
    const base = agreeing(pick.pattern);
    for (const o of options.slice(0, -1)) {
      if (o.pattern.length >= 4 && o.conflicts === 0 && agreeing(o.pattern) > base) {
        pick = o;
        break;
      }
    }
  }
  return { ...pick, alternatives: options.filter((o) => o !== pick) };
}

/**
 * Bulk suggestions for the categorize screen: uncategorized transactions grouped by merchant,
 * biggest groups first, each with the category its already-categorized look-alikes agree on.
 */
export function computeSuggestions(
  uncategorized: string[],
  categorized: { description: string; category: string }[],
  limit = 20,
  minCount = 2,
): Suggestion[] {
  const places = learnPlaces([...uncategorized, ...categorized.map((c) => c.description)]);
  const upper = uncategorized.map((d) => d.toUpperCase());

  // One candidate per distinct merchant phrase.
  const patterns = new Map<string, string>();
  for (const d of uncategorized) {
    const phrase = merchantPhrase(d, { places });
    if (phrase.length < MIN_PATTERN_LEN) continue;
    const key = phrase.toUpperCase();
    if (!patterns.has(key)) patterns.set(key, phrase);
  }

  // Count what the saved rule would really catch (substring matches), with distinct samples.
  const found: { key: string; pattern: string; count: number; samples: string[] }[] = [];
  for (const [key, pattern] of patterns) {
    let count = 0;
    const samples: string[] = [];
    for (let i = 0; i < upper.length; i++) {
      if (!upper[i].includes(key)) continue;
      count++;
      if (samples.length < 3 && !samples.includes(uncategorized[i])) samples.push(uncategorized[i]);
    }
    if (count >= minCount) found.push({ key, pattern, count, samples });
  }

  const catUpper = categorized.map((c) => ({ u: c.description.toUpperCase(), category: c.category }));
  const inferCategory = (key: string): string | null => {
    const tally = new Map<string, number>();
    let total = 0;
    for (const c of catUpper) {
      if (c.u.includes(key)) {
        total++;
        tally.set(c.category, (tally.get(c.category) ?? 0) + 1);
      }
    }
    if (!total) return null;
    let best = "";
    let bestN = 0;
    for (const [cat, n] of tally) {
      if (n > bestN) {
        bestN = n;
        best = cat;
      }
    }
    return bestN / total >= 0.6 && bestN >= 2 ? best : null;
  };

  found.sort((a, b) => b.count - a.count || b.pattern.length - a.pattern.length || a.key.localeCompare(b.key));
  return found.slice(0, limit).map((f) => ({
    pattern: f.pattern,
    matchCount: f.count,
    suggestedCategory: inferCategory(f.key),
    samples: f.samples,
  }));
}
