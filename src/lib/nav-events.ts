// Bridges between the pieces that know a navigation is happening and <NavProgress>, which
// draws it. Next calls src/instrumentation-client.ts outside React when a client navigation
// starts; every route's loading skeleton announces itself while the page streams.
export const NAV_START_EVENT = "app:navstart";

export interface NavStartDetail {
  url: string;
  navigationType: "push" | "replace" | "traverse";
}

export const SKELETON_EVENT = "app:skeleton";

export interface SkeletonDetail {
  /** +1 when a loading skeleton mounts, -1 when the real page replaces it. */
  delta: 1 | -1;
}
