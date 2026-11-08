"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ds";
import { SETTINGS_SECTIONS } from "./sections";

/**
 * The kit's two-pane settings: a nav card on the left, the section on the right. Only at lg+ —
 * phones keep the index list → sub-page → back-link flow. The index itself (/settings) is the
 * section list, so it renders full width rather than beside a copy of itself.
 */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/settings";
  if (pathname === "/settings") return <>{children}</>;
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:items-start lg:gap-5">
      <nav aria-label="Settings sections" className="mp-card hidden p-1.5 lg:sticky lg:top-6 lg:block">
        {SETTINGS_SECTIONS.map((s) => {
          const on = pathname === s.href || pathname.startsWith(s.href + "/");
          return (
            <Link key={s.href} href={s.href} className="mp-navitem" aria-current={on ? "page" : undefined}>
              <Icon name={s.icon} size={18} />
              <span className="mp-navitem__label">{s.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
