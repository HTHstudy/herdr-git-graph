// Pure color math on theme hex colors: relative luminance and the more readable ink on a fill.

/** "#rgb", "#rrggbb" or "#rrggbbaa" (alpha ignored) → [r, g, b] in 0..255, or null. */
export function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(hex ?? "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** WCAG relative luminance (0 black .. 1 white) of a hex color, or null when it can't be read. */
export function luminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two luminances (1..21). */
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Text color for a filled chip: whichever of `dark` / `light` (e.g. the theme's background and
 * foreground) contrasts more with `fill`; black or white stands in for one that can't be read.
 * An unreadable fill keeps `dark` (the old behavior: background-colored text).
 */
export function inkOn(fill, dark, light) {
  const f = luminance(fill);
  if (f == null) return dark;
  const ld = luminance(dark) ?? 0, ll = luminance(light) ?? 1;
  return ratio(f, ld) >= ratio(f, ll) ? dark : light;
}
