import Link from "next/link";
import { ListIcon, TagIcon, FolderIcon, ChevronRightIcon, BoltIcon, PencilIcon, BankIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

const TILES = [
  {
    href: "/settings/statuses",
    title: "Bill Statuses",
    desc: "Colors, emojis & order for the statuses you assign to bills. “Settled” statuses count toward paid-off rollups.",
    icon: ListIcon,
    accent: "bg-blue-500",
  },
  {
    href: "/settings/payment-types",
    title: "Payment Types",
    desc: "How a bill gets paid — credit, ACH, Zelle, cash. Customize the look and reorder them.",
    icon: TagIcon,
    accent: "bg-violet-500",
  },
  {
    href: "/settings/categories",
    title: "Categories",
    desc: "Transaction categories with color & emoji. Rename, delete-with-reassign, and set the order they appear everywhere.",
    icon: FolderIcon,
    accent: "bg-emerald-500",
  },
  {
    href: "/settings/bills",
    title: "Bills",
    desc: "Recurring bill definitions across months — history, rename, merge duplicates, and recurring-charge suggestions. Each month's sheet is auto-created from the last one.",
    icon: PencilIcon,
    accent: "bg-rose-500",
  },
  {
    href: "/settings/sync",
    title: "Bank Sync",
    desc: "Link banks, choose how often transactions and balances pull, map bank accounts to yours, and review sync history.",
    icon: BankIcon,
    accent: "bg-teal-500",
  },
  {
    href: "/settings/pay-schedule",
    title: "Pay Schedule",
    desc: "When your paycheck lands and your estimated take-home. Drives the payday countdown on the dashboard.",
    icon: BoltIcon,
    accent: "bg-amber-500",
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings ⚙️</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Customize the lists used across the app — recolor, add an emoji, and drag to reorder — plus
          the pay schedule that drives your payday countdown.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((t) => {
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className="group rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 hover:border-blue-400 hover:shadow-md transition-all"
            >
              <div className="flex items-start gap-3">
                <span
                  className={`shrink-0 grid place-items-center h-10 w-10 rounded-lg text-white ${t.accent}`}
                >
                  <Icon />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <h2 className="font-semibold">{t.title}</h2>
                    <ChevronRightIcon className="text-neutral-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <p className="text-sm text-neutral-500 mt-1">{t.desc}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
