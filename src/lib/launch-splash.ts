// Shared by <LaunchSplash> (writes it after the first launch) and the root layout's inline
// pre-paint script (reads it to hide the splash on later loads in the same session).
export const SPLASH_SEEN_KEY = "mp-launched";
