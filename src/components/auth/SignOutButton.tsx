import { signOut } from "@/server/actions/auth";

/**
 * A real form POST rather than an onClick handler, so signing out works even if the
 * client bundle hasn't hydrated — and so the browser treats it as a navigation.
 */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="px-3 py-1.5 rounded-md text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        Sign out
      </button>
    </form>
  );
}
