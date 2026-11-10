import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { DM_Mono, DM_Sans, Outfit } from "next/font/google";
import "./globals.css";
import { cookies } from "next/headers";
import { AppShell, LaunchSplash, NavProgress } from "@/components/ds";
import { SPLASH_SEEN_KEY } from "@/lib/launch-splash";
import { SIDEBAR_COOKIE } from "@/components/ds/sidebar";
import { SyncNotice } from "@/components/SyncNotice";
import { DemoNotice } from "@/components/DemoNotice";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { getSession } from "@/server/auth/session";
import { getNavCounts } from "@/server/queries";
import { getShellSyncState } from "@/server/shell-queries";
import { syncedAgo } from "@/lib/synced-ago";

// MiPlata type: Outfit (display, wordmark), DM Sans (UI and all numbers — has tabular
// figures), DM Mono (account masks, rule matchers). Exposed as CSS variables that the
// --mp-font-* tokens in src/styles/miplata/tokens.css build on.
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], weight: ["300", "400", "500", "600", "700"] });
const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"] });
const dmMono = DM_Mono({ variable: "--font-dm-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "MiPlata", template: "%s · MiPlata" },
  description: "Cuentas claras — bills, accounts, debts and the plan, in one place.",
  applicationName: "MiPlata",
  // Standalone mode on iOS versions without manifest-driven web apps. "default" keeps the
  // status bar opaque and lets it take themeColor below, so no content sits under it.
  appleWebApp: { capable: true, title: "MiPlata", statusBarStyle: "default" },
};

// viewportFit: "cover" enables env(safe-area-inset-*) for the bottom sheet and tab bar on notched phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // MiPlata green (--mp-emerald-600) in both schemes: it paints the iOS status bar in the
  // Home Screen app and tints Safari's toolbar. Matches theme_color in app/manifest.ts.
  themeColor: "#0b7a56",
};

/**
 * The document itself does no waiting: it returns at once so the first bytes — <head>, the
 * stylesheet and the launch splash — are on their way before any session or database work.
 * Everything that has to wait lives in <Shell>, behind Suspense, and streams in after.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: the pre-paint script below may add data-splash to <html>.
    <html lang="en" className={`${outfit.variable} ${dmSans.variable} ${dmMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Runs before first paint so a reload mid-session never flashes the splash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(sessionStorage.getItem(${JSON.stringify(SPLASH_SEEN_KEY)}))document.documentElement.dataset.splash="off"}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <LaunchSplash />
        {/* useSearchParams inside needs a Suspense boundary for the static-render case. */}
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        {/* No fallback: on a cold launch the splash covers this; on a reload the shell arrives within the same round trip. */}
        <Suspense fallback={null}>
          <Shell>{children}</Shell>
        </Suspense>
      </body>
    </html>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  // The shell links only to protected pages, so it would be dead weight on the login
  // and password-reset screens. Its absence is a UI convenience, not the access
  // control — that lives in the proxy and in requireSession().
  const session = await getSession();
  // Badge counts are a nicety: a DB hiccup must not take every page down with it.
  const [counts, syncState, cookieStore] = session
    ? await Promise.all([getNavCounts().catch(() => null), getShellSyncState().catch(() => null), cookies()])
    : [null, null, null];
  // Rendered per request, so reading the clock here is the point (server time, no hydration drift).
  const sync = syncState ? { enabled: syncState.enabled, label: syncedAgo(syncState.lastSyncedAt) } : null;
  const sidebarCollapsed = cookieStore?.get(SIDEBAR_COOKIE)?.value === "collapsed";

  if (!session) return <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6">{children}</main>;

  return (
    <AppShell
      billsHref="/months"
      email={session.email ?? session.username}
      signOut={<SignOutButton />}
      signOutNav={<SignOutButton variant="nav" />}
      sidebarCollapsed={sidebarCollapsed}
      counts={counts}
      sync={sync}
      banner={
        <>
          <DemoNotice />
          <SyncNotice />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
