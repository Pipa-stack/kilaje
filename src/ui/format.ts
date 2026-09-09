/**
 * How a figure or a date is written for a Spanish reader.
 *
 * Separate from `domain/calculations`, which reproduces the spreadsheet's own
 * arithmetic and is shared with the server: nothing there should know about a
 * locale. These three lines were instead copied into every screen that shows a
 * volume, which is one chance per screen for one card to group its thousands
 * differently from the card beside it.
 */

/** `1234.6` → `"1.235"`. Whole kilos: nobody trains to the gram. */
export function grouped(value: number): string {
  return Math.round(value).toLocaleString('es-ES');
}

/** `1234.6` → `"1.235 kg"`. */
export function kilos(value: number): string {
  return `${grouped(value)} kg`;
}

/** `"2025-03-04"` → `"4 mar"`. Empty for a date that will not parse. */
export function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}
