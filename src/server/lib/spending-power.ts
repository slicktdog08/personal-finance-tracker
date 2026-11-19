// Spending power: everything that could be spent right now — the cash in every cash account plus
// the unused credit on every open card. Pure, so the dashboard and tests share one definition.

export interface SpendingPowerCard {
  id: number;
  name: string;
  active: boolean;
  /** Owed on the card (a liability balance); null when no balance has been recorded. */
  balance: number | null;
  creditLimit: number | null;
}

export interface SpendingPower {
  cash: number;
  creditAvailable: number;
  total: number;
  /** Cards that contribute available credit, most room first. */
  cards: { id: number; name: string; available: number; limit: number }[];
  /** Open cards with no limit on record — they can't be counted, so the widget says so. */
  missingLimit: number;
}

/**
 * Each card counts as limit − balance, floored at zero: a card over its limit has no room left,
 * and must not eat into the cash or the other cards' room. Closed cards and cards without a
 * recorded limit contribute nothing. A card with a limit but no recorded balance counts as unused.
 */
export function spendingPower(cash: number, cards: SpendingPowerCard[]): SpendingPower {
  let missingLimit = 0;
  const counted: SpendingPower["cards"] = [];
  for (const c of cards) {
    if (!c.active) continue;
    if (c.creditLimit == null || c.creditLimit <= 0) {
      missingLimit++;
      continue;
    }
    const available = Math.max(0, c.creditLimit - Math.max(0, c.balance ?? 0));
    counted.push({ id: c.id, name: c.name, available, limit: c.creditLimit });
  }
  counted.sort((a, b) => b.available - a.available);
  const creditAvailable = counted.reduce((s, c) => s + c.available, 0);
  return { cash, creditAvailable, total: cash + creditAvailable, cards: counted, missingLimit };
}
