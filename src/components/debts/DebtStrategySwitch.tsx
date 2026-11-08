"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Segmented } from "@/components/ds";
import type { DebtStrategy } from "@/constants/enums";

/**
 * Payoff order for the Debts list. Lives in the URL (?order=) so the server can sort the cards
 * and run the payoff projection in that order; it doesn't touch any month's budget — Budget has
 * its own strategy control that moves the target.
 */
export function DebtStrategySwitch({ value }: { value: DebtStrategy }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className={pending ? "opacity-70" : undefined}>
      <Segmented<DebtStrategy>
        label="Payoff strategy"
        value={value}
        onChange={(v) => start(() => router.replace(`/debts?order=${v}`, { scroll: false }))}
        options={[
          { value: "avalanche", label: "Avalanche" },
          { value: "snowball", label: "Snowball" },
        ]}
      />
    </div>
  );
}
