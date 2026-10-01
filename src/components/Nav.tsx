"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useExitTransition } from "@/components/ui/useExitTransition";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/accounts", label: "Accounts" },
  { href: "/debts", label: "Debts" },
  { href: "/goals", label: "Goals" },
  { href: "/budget", label: "Budget" },
  { href: "/transactions", label: "Transactions" },
  { href: "/transfers", label: "Transfers" },
  { href: "/cash", label: "Cash" },
  { href: "/import", label: "Import" },
  { href: "/settings", label: "Settings" },
];

export interface NavProps {
  /** Shown on the right so it's obvious which account the data belongs to. */
  email?: string;
  /** Rendered by the layout; passed through because Nav is a Client Component. */
  signOut: React.ReactNode;
}

export function Nav({ email, signOut }: NavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Navigating from a drawer link must close the drawer. Adjusted during render
  // (React's pattern for prop-derived resets) rather than in an effect.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  // Stay mounted briefly after close so the drawer's exit animation can play.
  const { mounted, closing } = useExitTransition(open, 250);

  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      <div className="max-w-7xl mx-auto px-4 flex items-center gap-1 h-14">
        <Link href="/dashboard" className="font-semibold mr-4 tracking-tight shrink-0">
          💳 Billing
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                isActive(l.href)
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {email && (
            <span className="hidden md:inline text-sm text-neutral-500 dark:text-neutral-400">
              {email}
            </span>
          )}
          <span className="hidden md:inline-flex">{signOut}</span>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label="Menu"
            className="md:hidden h-11 w-11 -mr-2 flex items-center justify-center rounded-md text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {open ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {mounted && (
        <div
          id="mobile-nav"
          className={`md:hidden fixed inset-x-0 top-14 bottom-0 z-40 ${
            closing ? "pointer-events-none" : ""
          }`}
        >
          <div
            className={`absolute inset-0 bg-black/40 ${
              closing
                ? "motion-safe:animate-[overlay-fade-out_.25s_ease-in_forwards]"
                : "motion-safe:animate-[overlay-fade_.2s_ease-out]"
            }`}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          />
          <nav
            className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 shadow-xl overflow-y-auto flex flex-col ${
              closing
                ? "motion-safe:animate-[drawer-out_.25s_ease-in_forwards]"
                : "motion-safe:animate-[drawer-in_.25s_cubic-bezier(0.16,1,0.3,1)]"
            }`}
          >
            <div className="flex-1 py-2">
              {LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`block px-4 py-3 text-sm font-medium ${
                    isActive(l.href)
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                      : "text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  }`}
                >
                  {l.label}
                </Link>
              ))}
            </div>
            <div className="border-t border-neutral-200 dark:border-neutral-800 px-4 py-3 flex items-center justify-between gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {email && (
                <span className="text-xs text-neutral-500 dark:text-neutral-400 min-w-0 truncate">
                  {email}
                </span>
              )}
              {signOut}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
