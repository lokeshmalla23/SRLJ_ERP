// Stable decorative motif picker for list rows (category lists, barcode table).
//
// Presentation only: the variant is derived from the row's label text so the
// same row always draws the same thumbnail. It never participates in filtering,
// sorting, totals or any other behaviour.

const SWATCH_VARIANTS = ["chain", "bangle", "bracelet", "ring", "coin", "pendant"];

/** Pick a stable decorative motif for a named row. */
export function swatchVariantFor(name = "") {
  const n = String(name).toLowerCase();
  if (/chain/.test(n)) return "chain";
  if (/bangle/.test(n)) return "bangle";
  if (/bracelet|tennis|cuff/.test(n)) return "bracelet";
  if (/ring/.test(n)) return "ring";
  if (/coin|bar|ingot|bullion/.test(n)) return "coin";
  if (/pendant|earring|stud|mangalsutra/.test(n)) return "pendant";
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 9973;
  return SWATCH_VARIANTS[h % SWATCH_VARIANTS.length];
}
