// Bridge between src/instrumentation-client.ts (which Next calls outside React when a
// client navigation starts) and the <NavProgress> component that draws the indicator.
export const NAV_START_EVENT = "app:navstart";

export interface NavStartDetail {
  url: string;
  navigationType: "push" | "replace" | "traverse";
}
