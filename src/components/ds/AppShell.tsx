"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sheet } from "@/components/ui/Sheet";
import { Icon, type IconName } from "./Icon";
import { BrandMark, Wordmark } from "./brand";
import { LinkTabs } from "./navigation";
import { LinkPending } from "./LinkPending";
import { SyncButton } from "./SyncButton";
import { SIDEBAR_COOKIE } from "./sidebar";
import { TXN_SEEN_EVENT } from "@/lib/transactions-seen";

// Grouped by how often and why you visit: Today (daily check-in), Money (what happened),
// Plan (where you're going), and the rare/heavy pages pinned to the bottom. Static, so nothing
// here is rebuilt per render; the Bills href and the badge counts are resolved by id below.
type NavItemDef = { id: string; label: string; icon: IconName; href: string; match: string[]; tone?: "alert" | "new" };

const SECTIONS = {
  home: { title: "MiPlata", match: ["/dashboard"] },
  bills: { title: "Bills", match: ["/months"] },
  activity: { title: "Activity", match: ["/transactions", "/transfers", "/cash"] },
  accounts: { title: "Accounts", match: ["/accounts"] },
  plan: { title: "Plan", match: ["/budget", "/debts", "/goals", "/trends"] },
  advisor: { title: "Advisor", match: ["/insights", "/advisor"] },
  import: { title: "Import", match: ["/import"] },
  settings: { title: "Settings", match: ["/settings"] },
} as const;
type SectionId = keyof typeof SECTIONS;

const NAV_GROUPS: { label: string; items: NavItemDef[] }[] = [
  {
    label: "Today",
    items: [
      { id: "home", label: "Home", icon: "house", href: "/dashboard", match: ["/dashboard"] },
      { id: "bills", label: "Bills", icon: "calendar-check", href: "/months", match: ["/months"], tone: "alert" },
    ],
  },
  {
    label: "Money",
    items: [
      { id: "activity", label: "Activity", icon: "arrow-left-right", href: "/transactions", match: [...SECTIONS.activity.match], tone: "new" },
      { id: "accounts", label: "Accounts", icon: "landmark", href: "/accounts", match: ["/accounts"] },
    ],
  },
  {
    label: "Plan",
    items: [
      { id: "budget", label: "Budget", icon: "chart-pie", href: "/budget", match: ["/budget"] },
      { id: "debts", label: "Debts", icon: "trending-down", href: "/debts", match: ["/debts"] },
      { id: "goals", label: "Goals", icon: "target", href: "/goals", match: ["/goals"] },
      { id: "trends", label: "Trends", icon: "chart-line", href: "/trends", match: ["/trends"] },
    ],
  },
  {
    label: "Advisor",
    items: [
      { id: "insights", label: "Insights", icon: "sparkles", href: "/insights", match: ["/insights"] },
      { id: "advisor", label: "Ask Claude", icon: "message-circle", href: "/advisor", match: ["/advisor"] },
    ],
  },
];
const NAV_FOOT: NavItemDef[] = [
  { id: "import", label: "Import", icon: "upload", href: "/import", match: ["/import"] },
  { id: "settings", label: "Settings", icon: "settings", href: "/settings", match: ["/settings"] },
];
// The More sheet: Accounts, the advisor pages, then the footer pages.
const MORE_ITEMS: NavItemDef[] = [NAV_GROUPS[1].items[1], ...NAV_GROUPS[3].items, ...NAV_FOOT];

// Activity merges four views of the same ledger; Plan's three pages share one mobile tab.
const ACTIVITY_TABS = [
  { href: "/transactions", label: "Transactions" },
  { href: "/transactions/categorize", label: "Categorize" },
  { href: "/transfers", label: "Transfers" },
  { href: "/cash", label: "Cash" },
];
const PLAN_TABS = [
  { href: "/budget", label: "Budget" },
  { href: "/debts", label: "Debts" },
  { href: "/goals", label: "Goals" },
  { href: "/trends", label: "Trends" },
];

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");
const isOn = (pathname: string, it: NavItemDef) => it.match.some((m) => under(pathname, m));

function sectionOf(pathname: string): SectionId | null {
  for (const [id, s] of Object.entries(SECTIONS) as [SectionId, (typeof SECTIONS)[SectionId]][]) {
    if (s.match.some((m) => under(pathname, m))) return id;
  }
  return null;
}

/** The tab whose href is the longest prefix of the path (so /transactions/categorize beats /transactions). */
function currentTab(pathname: string, tabs: { href: string }[]): string | null {
  let best: string | null = null;
  for (const t of tabs) if (under(pathname, t.href) && (!best || t.href.length > best.length)) best = t.href;
  return best;
}

export interface AppShellProps {
  /** Where the Bills entry goes — the current month's page. */
  billsHref: string;
  /** Shown in the sidebar footer / More sheet so it's obvious whose data this is. */
  email?: string;
  /** Rendered by the layout (a server-action form); passed through because this is a Client Component. */
  signOut: React.ReactNode;
  /** The same form styled as a sidebar nav item (SignOutButton variant="nav"). */
  signOutNav?: React.ReactNode;
  /** Desktop sidebar starts as an icon rail (from the mp_sidebar cookie, so it never flashes wide). */
  sidebarCollapsed?: boolean;
  /** Nav counts; omitted (e.g. the query failed) means no badges, never a wrong zero. */
  counts?: { pastDueBills: number; newTransactions: number } | null;
  /** Bank sync: whether any account syncs, and the server-rendered "Synced 4h ago" label. */
  sync?: { enabled: boolean; label: string } | null;
  /** Server-rendered banner (e.g. SyncNotice) shown above the page content. */
  banner?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The app frame. ≥1024px: 244px grouped sidebar. Below: a top bar with the section title and
 * a 5-tab, icon-only bottom bar (Home · Bills · Activity · Plan · More). No hamburger drawer.
 *
 * Re-render budget: this component re-renders on every navigation (usePathname) and on its own
 * UI state. Each region below is memoised on primitive props, so a navigation only re-renders the
 * nav items whose active state flipped, and opening the More sheet or collapsing the sidebar
 * touches nothing else. A server refresh (every server action causes one) re-renders this
 * function with new props, but the regions compare primitives, so it stops here.
 */
export function AppShell({ billsHref, email, signOut, signOutNav, sidebarCollapsed = false, counts, sync, banner, children }: AppShellProps) {
  const pathname = usePathname();
  const section = sectionOf(pathname);
  const [moreOpen, setMoreOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(sidebarCollapsed);

  // The layout (and its counts) doesn't re-render on client navigation, so the Transactions page
  // announces when it has marked rows seen and the badge clears here. A fresh server count
  // (new rows on a later load) shows again because the cleared flag resets with it.
  const [seenCleared, setSeenCleared] = useState(false);
  const [lastNew, setLastNew] = useState(counts?.newTransactions);
  if (lastNew !== counts?.newTransactions) {
    setLastNew(counts?.newTransactions);
    setSeenCleared(false);
  }
  useEffect(() => {
    const onSeen = () => setSeenCleared(true);
    window.addEventListener(TXN_SEEN_EVENT, onSeen);
    return () => window.removeEventListener(TXN_SEEN_EVENT, onSeen);
  }, []);
  const pastDue = counts?.pastDueBills ?? 0;
  const newTransactions = seenCleared ? 0 : (counts?.newTransactions ?? 0);

  // A cookie rather than localStorage so the server renders the right width on the next load.
  // Written when the choice changes, not on mount — the server already knows the initial value.
  const toggleSidebar = useCallback(() => setCollapsed((c) => !c), []);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  }, [collapsed]);

  // Navigating from the More sheet must close it. Adjusted during render (React's pattern for
  // prop-derived resets) rather than in an effect — the project lint bans setState-in-effect.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMoreOpen(false);
  }
  const openMore = useCallback(() => setMoreOpen(true), []);
  const closeMore = useCallback(() => setMoreOpen(false), []);

  return (
    <div className="mp-root">
      <div className="mp-shell" data-sidebar={collapsed ? "collapsed" : "expanded"}>
        <aside className="mp-sidebar">
          {/* The mark sits in the icon column so it stays put while the wordmark fades with the width. */}
          <SidebarBrand />
          {NAV_GROUPS.map((g) => (
            <nav key={g.label} className="mp-navgroup" aria-label={g.label}>
              <div className="mp-navgroup__label">{g.label}</div>
              {g.items.map((it) => (
                <NavItem
                  key={it.id}
                  href={it.id === "bills" ? billsHref : it.href}
                  label={it.label}
                  icon={it.icon}
                  active={isOn(pathname, it)}
                  badge={it.id === "bills" ? pastDue : it.id === "activity" ? newTransactions : 0}
                  tone={it.tone}
                  collapsed={collapsed}
                />
              ))}
            </nav>
          ))}
          <div className="mp-sidebar__foot">
            {NAV_FOOT.map((it) => (
              <NavItem key={it.id} href={it.href} label={it.label} icon={it.icon} active={isOn(pathname, it)} collapsed={collapsed} />
            ))}
            <SidebarFoot
              email={email}
              syncEnabled={!!sync?.enabled}
              syncLabel={sync?.label}
              signOut={signOut}
              signOutNav={signOutNav}
              collapsed={collapsed}
              onToggle={toggleSidebar}
            />
          </div>
        </aside>

        <div className="mp-main">
          <TopBar section={section} syncEnabled={!!sync?.enabled} />

          <main className="mp-content">
            {section === "activity" && (
              <LinkTabs tabs={ACTIVITY_TABS} current={currentTab(pathname, ACTIVITY_TABS)} label="Activity views" sticky />
            )}
            {section === "plan" && (
              <LinkTabs tabs={PLAN_TABS} current={currentTab(pathname, PLAN_TABS)} label="Plan views" sticky className="lg:hidden" />
            )}
            {banner}
            {/* Whatever mounts here — a route's skeleton, then its content — fades in on its own
                (motion.css, .mp-page). Plain CSS on the new element: nothing is snapshotted and
                nothing outside this box is involved, so saves and refreshes inside a page never
                animate and the bars around it never repaint. */}
            <div className="mp-page min-w-0">{children}</div>
          </main>

          <TabBar section={section} billsHref={billsHref} pastDue={pastDue} newTransactions={newTransactions} moreOpen={moreOpen} onMore={openMore} />
        </div>
      </div>

      <MoreSheet open={moreOpen} onClose={closeMore} pathname={pathname} email={email} signOut={signOut} />
    </div>
  );
}

// ── Memoised regions ─────────────────────────────────────────────────────────────────────────

// The sign-out forms are slots rendered by the root layout. Every server action refreshes that
// layout, which hands the shell new element objects for the very same forms; comparing them by
// reference would re-render the footer and the More sheet after every save anywhere in the app.
// Their content never changes, so the regions that hold them compare everything else.
type Slots = { signOut?: React.ReactNode; signOutNav?: React.ReactNode };
function sameExceptSlots<P extends Slots>(a: P, b: P) {
  for (const k of Object.keys(a) as (keyof P)[]) {
    if (k !== "signOut" && k !== "signOutNav" && a[k] !== b[k]) return false;
  }
  return Object.keys(a).length === Object.keys(b).length;
}

const SidebarBrand = memo(function SidebarBrand() {
  return (
    <div className="mp-sidebar__top">
      <Link href="/dashboard" className="mp-sidebar__brand" aria-label="MiPlata home">
        <BrandMark size={26} />
        <Wordmark size={20} className="mp-sidebar__wordmark" />
      </Link>
    </div>
  );
});

const NavItem = memo(function NavItem({
  href,
  label,
  icon,
  active,
  badge = 0,
  tone,
  collapsed,
}: {
  href: string;
  label: string;
  icon: IconName;
  active: boolean;
  badge?: number;
  tone?: "alert" | "new";
  collapsed: boolean;
}) {
  return (
    <Link href={href} className="mp-navitem" aria-current={active ? "page" : undefined} title={collapsed ? label : undefined}>
      <LinkPending />
      <Icon name={icon} size={18} />
      <span className="mp-navitem__label">{label}</span>
      {badge > 0 && (
        <span className={"mp-navitem__badge mp-navitem__badge--" + tone} title={tone === "alert" ? `${badge} past due` : `${badge} new since you last looked`}>
          {badge > 999 ? "999+" : badge}
        </span>
      )}
    </Link>
  );
});

const SidebarFoot = memo(function SidebarFoot({
  email,
  syncEnabled,
  syncLabel,
  signOut,
  signOutNav,
  collapsed,
  onToggle,
}: Pick<AppShellProps, "email" | "signOut" | "signOutNav"> & { syncEnabled: boolean; syncLabel?: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <>
      {/* Text-only rows sit in folds, so collapsing animates their height to zero instead of popping out. */}
      {signOutNav ?? (
        <div className="mp-sidebar__fold">
          <div className="mp-sidebar__signout px-1">{signOut}</div>
        </div>
      )}
      {(email || syncEnabled) && (
        <div className="mp-sidebar__fold">
          <div className="mp-sidebar__user flex items-center gap-1">
            <div className="min-w-0 flex-1">
              {email && (
                <div className="truncate" title={email}>
                  {email}
                </div>
              )}
              {syncEnabled && <div className="truncate">{syncLabel}</div>}
            </div>
            {syncEnabled && <SyncButton className="mp-btn--sm shrink-0" />}
          </div>
        </div>
      )}
      {/* Last in the bottom-anchored footer, so it sits in the same spot open or closed. */}
      <button
        type="button"
        className="mp-navitem mp-sidebar__toggle"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : undefined}
      >
        <span className="mp-sidebar__toggle-icon">
          <Icon name="panel-left-close" size={18} />
          <Icon name="panel-left-open" size={18} />
        </span>
        <span className="mp-navitem__label">Collapse</span>
      </button>
    </>
  );
}, sameExceptSlots);

const TopBar = memo(function TopBar({ section, syncEnabled }: { section: SectionId | null; syncEnabled: boolean }) {
  return (
    <header className="mp-topbar">
      <div className="flex min-w-0 items-center gap-2.5">
        {section === "home" && <BrandMark size={26} />}
        <span className="mp-topbar__title truncate">{section ? SECTIONS[section].title : "MiPlata"}</span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Link href="/transactions" className="mp-btn mp-iconbtn mp-btn--ghost" aria-label="Search transactions" title="Search transactions">
          <Icon name="search" size={20} />
        </Link>
        {syncEnabled && <SyncButton />}
      </div>
    </header>
  );
});

const TabBar = memo(function TabBar({
  section,
  billsHref,
  pastDue,
  newTransactions,
  moreOpen,
  onMore,
}: {
  section: SectionId | null;
  billsHref: string;
  pastDue: number;
  newTransactions: number;
  moreOpen: boolean;
  onMore: () => void;
}) {
  const tabs: { id: string; label: string; icon: IconName; href?: string; on: boolean; dot?: "alert" | "new" }[] = [
    { id: "home", label: "Home", icon: "house", href: "/dashboard", on: section === "home" },
    { id: "bills", label: pastDue ? `Bills, ${pastDue} past due` : "Bills", icon: "calendar-check", href: billsHref, on: section === "bills", dot: pastDue ? "alert" : undefined },
    { id: "activity", label: newTransactions ? `Activity, ${newTransactions} new` : "Activity", icon: "arrow-left-right", href: "/transactions", on: section === "activity", dot: newTransactions ? "new" : undefined },
    { id: "plan", label: "Plan", icon: "chart-pie", href: "/budget", on: section === "plan" },
    { id: "more", label: "More", icon: "ellipsis", on: section === "accounts" || section === "advisor" || section === "import" || section === "settings" },
  ];
  return (
    <nav className="mp-tabbar" aria-label="Primary">
      {tabs.map((t) => {
        const inner = (
          <>
            <span className="mp-tab__icon">
              <Icon name={t.icon} size={26} strokeWidth={t.on ? 2.6 : 1.8} />
            </span>
            <span className="mp-tab__label">{t.label}</span>
            {t.dot && <span className={"mp-tab__dot mp-tab__dot--" + t.dot} />}
          </>
        );
        return t.href ? (
          <Link key={t.id} href={t.href} className="mp-tab" aria-current={t.on ? "page" : undefined}>
            <LinkPending />
            {inner}
          </Link>
        ) : (
          <button
            key={t.id}
            type="button"
            className="mp-tab"
            aria-current={t.on ? "page" : undefined}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={onMore}
          >
            {inner}
          </button>
        );
      })}
    </nav>
  );
});

const MoreSheet = memo(function MoreSheet({
  open,
  onClose,
  pathname,
  email,
  signOut,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
  email?: string;
  signOut: React.ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="More">
      <div className="flex flex-col">
        {MORE_ITEMS.map((it) => (
          <Link key={it.id} href={it.href} className="mp-menuitem h-12" aria-current={isOn(pathname, it) ? "page" : undefined}>
            <LinkPending />
            <Icon name={it.icon} size={20} className="text-fg-3" />
            {it.label}
          </Link>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
        {email && <span className="min-w-0 truncate text-xs text-fg-3">{email}</span>}
        {signOut}
      </div>
    </Sheet>
  );
}, sameExceptSlots);
