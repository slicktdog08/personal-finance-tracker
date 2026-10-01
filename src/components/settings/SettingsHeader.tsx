import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";

// Shared header for an inner settings page: back link + title + short description.
export function SettingsHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="space-y-2">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-blue-600"
      >
        <ArrowLeftIcon /> Settings
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {description && <p className="text-sm text-neutral-500">{description}</p>}
      <p className="text-xs text-neutral-400">
        Tip: drag the ⠿ handle (or tap the ▲▼ arrows) to reorder — the order here drives how
        items appear in dropdowns across the app.
      </p>
    </div>
  );
}
