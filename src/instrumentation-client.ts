import { NAV_START_EVENT, type NavStartDetail } from "@/lib/nav-events";

// Next calls this when an App Router navigation begins (Link clicks, router.push/replace,
// back/forward). It has no matching "finished" hook — <NavProgress> treats the rendered
// URL changing as the end.
export function onRouterTransitionStart(url: string, navigationType: NavStartDetail["navigationType"]) {
  window.dispatchEvent(new CustomEvent<NavStartDetail>(NAV_START_EVENT, { detail: { url, navigationType } }));
}
