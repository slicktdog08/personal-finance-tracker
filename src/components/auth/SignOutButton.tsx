import { signOut } from "@/server/actions/auth";
import { Icon } from "@/components/ds/Icon";

/**
 * A real form POST rather than an onClick handler, so signing out works even if the
 * client bundle hasn't hydrated — and so the browser treats it as a navigation.
 *
 * `nav` renders it as a sidebar nav item (icon + label, icon-only when the sidebar is collapsed).
 */
export function SignOutButton({ variant = "button" }: { variant?: "button" | "nav" }) {
  return (
    <form action={signOut}>
      {variant === "nav" ? (
        <button type="submit" className="mp-navitem" title="Sign out">
          <Icon name="log-out" size={18} />
          <span className="mp-navitem__label">Sign out</span>
        </button>
      ) : (
        <button type="submit" className="mp-btn mp-btn--ghost">
          <Icon name="log-out" size={16} />
          Sign out
        </button>
      )}
    </form>
  );
}
