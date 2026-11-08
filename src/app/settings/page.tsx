import Link from "next/link";
import { Card, Glyph, Icon, PageHeader } from "@/components/ds";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { SETTINGS_SECTIONS } from "@/components/settings/sections";

export const dynamic = "force-dynamic";

// The section index. On phones it's the way in (each sub-page links back here); on desktop the
// sub-pages carry their own nav card, so this is just the landing list.
export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="The lists used across the app, the pay schedule behind your payday countdown, and bank sync."
        actions={<SignOutButton />}
      />
      <Card padded={false} style={{ padding: "4px 16px" }}>
        {/* The whole row is the link (a ListRow's own button mode can't navigate). */}
        {SETTINGS_SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="mp-listrow mp-listrow--button">
            <Glyph icon={s.icon} />
            <span className="mp-listrow__main">
              <span className="mp-listrow__title">{s.label}</span>
              <span className="mp-listrow__sub">{s.desc}</span>
            </span>
            <Icon name="chevron-right" size={18} className="shrink-0 text-fg-3" />
          </Link>
        ))}
      </Card>
    </div>
  );
}
