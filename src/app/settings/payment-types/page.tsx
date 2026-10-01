import { SetupNotice } from "@/components/SetupNotice";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { PaymentTypeList } from "@/components/settings/PaymentTypeList";
import { getPaymentTypeRows } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function PaymentTypesPage() {
  let payments;
  try {
    payments = await getPaymentTypeRows();
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }

  return (
    <div className="space-y-5">
      <SettingsHeader
        title="Payment Types 💳"
        description="How each bill gets paid. Customize the color, emoji, and order shown in dropdowns."
      />
      <PaymentTypeList
        payments={payments.map((p) => ({ id: p.id, name: p.name, color: p.color, emoji: p.emoji }))}
      />
    </div>
  );
}
