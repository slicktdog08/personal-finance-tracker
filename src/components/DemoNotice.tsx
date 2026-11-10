import { Notice } from "@/components/ds";
import { isDemoMode } from "@/server/auth/provider";
import { demoResetMinutes } from "@/server/demo/reset";

/** Shown above every page of the public demo so nobody mistakes it for real money. */
export function DemoNotice() {
  if (!isDemoMode()) return null;
  const minutes = demoResetMinutes();
  const every = minutes === 0 ? null : minutes % 60 === 0 ? (minutes === 60 ? "every hour" : `every ${minutes / 60} hours`) : `every ${minutes} minutes`;
  return (
    <Notice tone="info" title="You're in the demo.">
      Every name and number here is made up. Change anything you like{every ? ` — it all resets ${every}` : ""}.
    </Notice>
  );
}
