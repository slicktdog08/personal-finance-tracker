"use client";

import { useEffect } from "react";

/**
 * Accounts links to a single card here (/debts#debt-12). The route shows its skeleton first, so
 * the browser's own jump to the anchor happens before the card exists — do it once it does.
 */
export function ScrollToDebt() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id.startsWith("debt-")) return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
