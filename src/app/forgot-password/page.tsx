import { BrandMark, Wordmark } from "@/components/ds";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <div className="flex items-center justify-center px-4 py-12 sm:py-20">
      <div className="grid w-full max-w-sm gap-6">
        <div className="grid justify-items-center gap-3">
          <BrandMark size={52} />
          <Wordmark size={30} />
          <div className="text-sm text-fg-3">Cuentas claras.</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-6 shadow-hairline">
          <ForgotPasswordForm />
        </div>
        <p className="text-center text-xs text-fg-3">Private, single-user. Your data stays on your server.</p>
      </div>
    </div>
  );
}
