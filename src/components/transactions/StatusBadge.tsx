"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LOCAL_SOURCES, sourceLabel } from "@/constants/sync";
import { setTransactionPending } from "@/server/actions/transactions";

// Provenance and one-click settling for the transactions tables. The "Pending" pill itself is
// NOT here — each table renders its own from `t.pending`, which is the flag the database
// actually keeps (see schema.ts). The bank-sync branch carried a parallel `status` string and a
// third PendingBadge; both were folded into the flag rather than kept alongside it.

// Tiny glyph naming where a row came from; only shown for synced rows so the table stays
// quiet for the historical CSV/PDF majority.
export function SourceGlyph({ source }: { source?: string | null }) {
  if (!source || LOCAL_SOURCES.includes(source)) return null;
  return (
    <span title={sourceLabel(source)} className="shrink-0 text-[11px] text-neutral-400" aria-label={sourceLabel(source)}>
      ⇄
    </span>
  );
}

// One click to settle a hand-entered pending row when you already know it posted and no
// import is coming (cash, a card you don't export). Hidden for bank-synced rows, whose
// pending flag belongs to the provider until the next run.
export function MarkPostedButton({
  id,
  pending,
  source,
  path,
}: {
  id: number;
  pending?: boolean | null;
  source?: string | null;
  path: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  if (!pending || (source && !LOCAL_SOURCES.includes(source))) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() =>
        start(async () => {
          const res = await setTransactionPending(id, false, path);
          if (!res.ok) alert(res.error);
          router.refresh();
        })
      }
      title="Mark as posted"
      className="shrink-0 text-[10px] font-medium text-amber-700 dark:text-amber-400 hover:underline disabled:opacity-50"
    >
      mark posted
    </button>
  );
}
