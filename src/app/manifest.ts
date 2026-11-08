import type { MetadataRoute } from "next";

// MiPlata accent (--mp-emerald-600 in src/styles/miplata/tokens.css). A manifest is plain
// JSON, so it can't read the CSS variable; keep the two in step by hand.
const BRAND_GREEN = "#0b7a56";

// The Home Screen web app. `scope: "/"` is the point of this file: without a manifest, iOS
// derives the scope from whatever page was open when the app was added (say /months/), and
// every page outside that prefix opens with Safari's browser bars. `id` pins the app's
// identity so a later start_url change doesn't make it a different app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "MiPlata",
    short_name: "MiPlata",
    description: "Cuentas claras — bills, accounts, debts and the plan, in one place.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: BRAND_GREEN,
    // PNG renders of public/brand/app-icon.svg (the token on green). No SVG entry: iOS can't
    // use one as a Home Screen icon, and the round tab mark (app/icon.svg) isn't the app icon.
    icons: [
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
