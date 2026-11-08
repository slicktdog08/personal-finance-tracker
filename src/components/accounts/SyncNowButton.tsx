"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncNow } from "@/server/actions/sync";
import { Button } from "@/components/ds";

// The kit's "Sync now" on Accounts: one run across every active bank link (the same action as
// Settings → Bank sync), then a refresh so the balances and "synced Xh ago" lines update.
export function SyncNowButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      icon="refresh-cw"
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await syncNow();
          if (!res.ok) {
            alert(res.error);
            router.refresh();
          }
        })
      }
    >
      {pending ? "Syncing…" : "Sync now"}
    </Button>
  );
}
