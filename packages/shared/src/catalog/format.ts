/** Metres as centimetres with one decimal: `0.925` → `"92.5 cm"`. */
export const formatCm = (metres: number): string => `${(metres * 100).toFixed(1)} cm`;

/**
 * Centimetres typed by a person, in metres rounded to the millimetre: `"92,5"` → `0.925`.
 * Accepts a comma or a point and an optional `cm`; anything else gives `undefined`.
 */
export function parseCm(text: string): number | undefined {
  const match = /^\s*(-?\d+(?:[.,]\d*)?|-?[.,]\d+)\s*(?:cm)?\s*$/i.exec(text);
  if (!match) return undefined;
  const cm = Number(match[1]!.replace(',', '.'));
  return Number.isFinite(cm) ? Math.round(cm * 10) / 1000 : undefined;
}

/** A share from 0 to 1 as a whole percentage: `0.4` → `"40 %"`. */
export const formatPercent = (share: number): string => `${Math.round(share * 100)} %`;
