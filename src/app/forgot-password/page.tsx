import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reset password · Billing Tracker" };

export default function ForgotPasswordPage() {
  return (
    <div className="flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
