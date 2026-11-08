// Shared by the root layout (server) and AppShell (client). Kept out of AppShell.tsx because
// a server component importing a value from a "use client" module gets a client reference,
// not the string.
/** Cookie holding the desktop sidebar state ("collapsed" | "expanded"). */
export const SIDEBAR_COOKIE = "mp_sidebar";
