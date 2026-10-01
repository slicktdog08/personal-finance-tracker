// Client-safe color helpers (no DB / server imports).

// Pick readable text color (black/white) for a given hex background via luminance.
export function textColorFor(hex: string | null | undefined): string {
  if (!hex) return "#111111";
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#111111";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // Relative luminance (sRGB approximation)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#111111" : "#ffffff";
}

export function badgeStyle(hex: string | null | undefined): React.CSSProperties {
  const bg = hex || "#9ca3af";
  return { backgroundColor: bg, color: textColorFor(bg) };
}

// Coerce any stored color into a valid value for <input type="color"> (#rrggbb).
export function toHexInput(hex: string | null | undefined): string {
  if (!hex) return "#000000";
  const s = hex.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    const m = s.slice(1);
    return "#" + [...m].map((ch) => ch + ch).join("");
  }
  return "#000000";
}
