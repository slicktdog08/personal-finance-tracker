import { Glyph, Money, ProgressBar } from "@/components/ds";
import { accountGlyph } from "@/components/accounts/account-glyph";
import { ACCOUNT_COLORS, LinkRow } from "./kit";

export interface CashAccountRow {
  id: number;
  name: string;
  type: string | null;
  /** "Checking ··4381" */
  sub: string;
  balance: number;
  /** Part of the balance backing savings goals. */
  reserved: number;
}

/**
 * "Where your cash is": one segmented bar for the split, then a row per account in the same order
 * and colors. Goal-backed money is called out per account so "savings has $4k" doesn't read as
 * $4k free to spend.
 */
export function CashAccounts({ accounts }: { accounts: CashAccountRow[] }) {
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  const colorOf = (i: number) => ACCOUNT_COLORS[i % ACCOUNT_COLORS.length];
  return (
    <div>
      <ProgressBar size="sm" segments={accounts.map((a, i) => ({ value: a.balance, color: colorOf(i) }))} max={total} className="mb-1.5" label="Cash by account" />
      {accounts.map((a, i) => (
        <LinkRow
          key={a.id}
          href="/accounts"
          lead={<Glyph icon={accountGlyph(a.type).icon} color={colorOf(i)} size="sm" />}
          title={a.name}
          sub={
            a.reserved > 0 ? (
              <>
                {a.sub} · <Money value={a.reserved} kind="neutral" /> in goals
              </>
            ) : (
              <>
                {a.sub} · {total > 0 ? Math.round((a.balance / total) * 100) : 0}%
              </>
            )
          }
          end={<Money value={a.balance} kind="neutral" />}
          endSub={
            a.reserved > 0 ? (
              <>
                <Money value={a.balance - a.reserved} kind="neutral" /> free
              </>
            ) : undefined
          }
        />
      ))}
    </div>
  );
}
