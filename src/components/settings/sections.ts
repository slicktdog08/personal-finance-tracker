import type { IconName } from "@/components/ds";

// Every settings section, in the order the kit lists them. Shared by the phone index list
// (/settings) and the desktop left-hand nav card so the two can't drift apart.
export interface SettingsSection {
  href: string;
  label: string;
  icon: IconName;
  desc: string;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    href: "/settings/bills",
    label: "Recurring bills",
    icon: "calendar-check",
    desc: "Bill definitions across months: history, rename, merge duplicates and recurring-charge suggestions.",
  },
  {
    href: "/settings/categories",
    label: "Categories",
    icon: "tags",
    desc: "Transaction categories with color and emoji. Rename, delete with reassign, and set their order.",
  },
  {
    href: "/settings/statuses",
    label: "Bill statuses",
    icon: "circle-dot",
    desc: "Colors and order for bill statuses. Settled ones count toward paid-off rollups.",
  },
  {
    href: "/settings/payment-types",
    label: "Payment types",
    icon: "credit-card",
    desc: "How a bill gets paid: credit, ACH, Zelle, cash. Recolor and reorder them.",
  },
  {
    href: "/settings/pay-schedule",
    label: "Pay schedule",
    icon: "calendar-heart",
    desc: "When your paycheck lands and roughly how much. Drives the payday countdown.",
  },
  {
    href: "/settings/sync",
    label: "Bank sync",
    icon: "refresh-cw",
    desc: "Link banks, set how often they pull, map bank accounts to yours and review runs.",
  },
];
