/**
 * Plate maths: what to actually put on each side of the bar.
 *
 * Every lifter does this arithmetic between sets, usually wrong when tired.
 * The app already knows the weight, so it can do it.
 *
 * Colours follow the IPF/IWF competition standard, which is the notation
 * lifters already read without thinking: 25 red, 20 blue, 15 yellow,
 * 10 green, 5 white, 2.5 red, 1.25 chrome.
 */

/** A plate denomination, heaviest first — that is the order they get loaded. */
export interface Plate {
  /** Kilos of a single plate. */
  kg: number;
  /** Token name; the UI maps it to a colour. */
  colour: 'red' | 'blue' | 'yellow' | 'green' | 'white' | 'small-red' | 'chrome';
}

export const COMPETITION_PLATES: readonly Plate[] = [
  { kg: 25, colour: 'red' },
  { kg: 20, colour: 'blue' },
  { kg: 15, colour: 'yellow' },
  { kg: 10, colour: 'green' },
  { kg: 5, colour: 'white' },
  { kg: 2.5, colour: 'small-red' },
  { kg: 1.25, colour: 'chrome' },
];

/** Standard olympic bar. */
export const DEFAULT_BAR_KG = 20;

export interface PlateLoad {
  /** Plates for ONE side, heaviest first. */
  perSide: Plate[];
  /** Kilos that could not be made up from the available plates. */
  remainderKg: number;
  barKg: number;
}

/**
 * Works out the plates for one side of the bar.
 *
 * Returns `null` when the target is below the bar itself — machines, cables
 * and dumbbells all record a weight that has nothing to do with a barbell,
 * and guessing would be worse than staying quiet.
 */
export function calculatePlates(
  totalKg: number,
  barKg: number = DEFAULT_BAR_KG,
  available: readonly Plate[] = COMPETITION_PLATES,
): PlateLoad | null {
  if (!Number.isFinite(totalKg) || totalKg < barKg) return null;

  // Work in grams to keep 1.25 and 2.5 exact under binary floating point.
  let remainingPerSideG = Math.round(((totalKg - barKg) / 2) * 1000);
  const perSide: Plate[] = [];

  for (const plate of available) {
    const plateG = Math.round(plate.kg * 1000);
    while (remainingPerSideG >= plateG) {
      perSide.push(plate);
      remainingPerSideG -= plateG;
    }
  }

  return {
    perSide,
    remainderKg: Math.round(remainingPerSideG * 2) / 1000,
    barKg,
  };
}

/** Compact label: `20 + 20 + 1.25` per side, or a dash when there are none. */
export function formatPerSide(load: PlateLoad): string {
  if (load.perSide.length === 0) return '—';
  return load.perSide.map((plate) => String(plate.kg)).join(' + ');
}
