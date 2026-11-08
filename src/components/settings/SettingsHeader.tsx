import { Icon, PageHeader } from "@/components/ds";
import Link from "next/link";

/**
 * Back link to the settings index. Phones only — at lg+ the settings nav card sits beside the
 * page, so a back link there would just repeat it.
 */
export function SettingsBackLink() {
  return (
    <Link href="/settings" className="inline-flex items-center gap-1 hover:text-accent-text lg:hidden">
      <Icon name="arrow-left" size={14} /> Settings
    </Link>
  );
}

// Shared header for an inner settings page: back link + title + short description, plus the
// reorder hint for the list pages (reorder: false for pages with nothing to drag).
export function SettingsHeader({
  title,
  description,
  actions,
  reorder = true,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  reorder?: boolean;
}) {
  return (
    <div className="space-y-2">
      <PageHeader showTitleOnMobile eyebrow={<SettingsBackLink />} title={title} description={description} actions={actions} />
      {reorder && (
        <p className="flex items-center gap-1.5 text-xs text-fg-3">
          <Icon name="grip-vertical" size={14} />
          Drag the handle, or use the arrows on a phone, to reorder. This order is the order in every dropdown.
        </p>
      )}
    </div>
  );
}
