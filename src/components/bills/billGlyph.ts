import type { IconName } from "@/components/ds";

// Bills carry no icon of their own, so the glyph is guessed from the name. The goal is a row that
// scans at a glance, not taxonomy — anything unrecognised gets the generic receipt.
const NAME_ICONS: [RegExp, IconName][] = [
  [/rent|apartment|apt\b|mortgage|hoa|park\b|lease|housing/i, "house"],
  [/electric|energy|power|gas & electric|p&e|utility|utilities|reliant|txu/i, "zap"],
  [/water|sewer/i, "umbrella"],
  [/internet|wifi|fiber|att\b|at&t|comcast|xfinity|spectrum/i, "wifi"],
  [/phone|mobile|verizon|t-mobile|tmobile|wireless|cricket|mint/i, "smartphone"],
  [/insur|geico|progressive|state farm|allstate/i, "shield-check"],
  [/car\b|auto|vehicle|toyota|honda|ford/i, "car"],
  [/student|edfinancial|navient|nelnet|sallie|tuition|school/i, "graduation-cap"],
  [/loan|lending|affirm|klarna|afterpay|zable|upstart|sofi/i, "hand-coins"],
  [/card|chase|capital one|amex|discover|citi|credit|united/i, "credit-card"],
  [/bank|checking|savings|boa\b|wells/i, "landmark"],
  [/spotify|music|pandora|tidal/i, "music"],
  [/icloud|cloud|dropbox|drive|storage/i, "cloud"],
  [/aws|amazon web|digital ?ocean|hosting|ionos|server|vercel|heroku/i, "server"],
  [/domain|website|squarespace|godaddy|namecheap/i, "globe"],
  [/microsoft|adobe|software|github|anthropic|openai|claude|chatgpt/i, "monitor"],
  [/outlook|mail|gmail/i, "mail"],
  [/gym|fitness|eos|planet|yoga/i, "dumbbell"],
  [/netflix|hulu|disney|hbo|max\b|youtube|prime/i, "monitor"],
  [/health|medical|doctor|dental|pharmacy/i, "heart-pulse"],
  [/fuel|gas station|shell|exxon/i, "fuel"],
  [/cashapp|cash app|zelle|venmo/i, "smartphone"],
];

export function billIcon(name: string, isDebt = false): IconName {
  for (const [re, icon] of NAME_ICONS) if (re.test(name)) return icon;
  return isDebt ? "credit-card" : "receipt";
}

// Payment types are user-defined too; these cover the seeded ones and common variants.
export function paymentIcon(name: string): IconName {
  if (/ach|bank|transfer/i.test(name)) return "landmark";
  if (/cash ?only|^cash$/i.test(name)) return "banknote";
  if (/zelle|cash ?app|venmo|paypal/i.test(name)) return "smartphone";
  if (/credit|card/i.test(name)) return "credit-card";
  return "wallet";
}
