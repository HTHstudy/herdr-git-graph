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

const hex2 = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");

/**
 * The same hue and lightness with more saturation: S moves `amount` of the way to full (0 keeps it,
 * 1 makes it fully saturated). Grays stay gray; an unreadable color comes back unchanged.
 * Returns "#rrggbb" (any alpha is dropped).
 */
export function saturate(hex, amount) {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d < 0.02) return "#" + rgb.map(hex2).join("");
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const s2 = Math.min(1, s + (1 - s) * amount);
  const c = (1 - Math.abs(2 * l - 1)) * s2, x = c * (1 - Math.abs((h % 2) - 1)), m = l - c / 2;
  const [r1, g1, b1] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return "#" + [r1, g1, b1].map((v) => hex2((v + m) * 255)).join("");
}
