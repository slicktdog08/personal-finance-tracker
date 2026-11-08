import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import { PlaidOAuthResume } from "@/components/settings/sync/PlaidLink";

// Plaid OAuth return page ($APP_URL + this path, or PLAID_REDIRECT_URI). Banks such as Chase and Capital One log the
// user in on their own site and send the browser back here with an oauth_state_id; Link is
// re-opened to finish. Must match an "Allowed redirect URI" in the Plaid dashboard exactly.
export const dynamic = "force-dynamic";

export default function PlaidOAuthPage() {
  return (
    <div className="space-y-4">
      <Link href="/settings/sync" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-blue-600">
        <ArrowLeftIcon /> Bank Sync
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Connecting your bank</h1>
      <PlaidOAuthResume />
    </div>
  );
}
