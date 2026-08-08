import { describe, expect, it } from 'vitest';

import {
  COMPETITION_PLATES,
  DEFAULT_BAR_KG,
  calculatePlates,
  formatPerSide,
} from '../src/domain/plates';

/** Sum of one side, for checking the maths adds up. */
function totalOf(perSide: { kg: number }[], bar = DEFAULT_BAR_KG): number {
  return bar + perSide.reduce((sum, plate) => sum + plate.kg, 0) * 2;
}

describe('calculatePlates', () => {
  it('loads the bench weight from the reference workbook', () => {
    // 82.5 kg on a 20 kg bar = 31.25 per side = 25 + 5 + 1.25
    const load = calculatePlates(82.5);
    expect(load?.perSide.map((plate) => plate.kg)).toEqual([25, 5, 1.25]);
    expect(load?.remainderKg).toBe(0);
    expect(totalOf(load!.perSide)).toBe(82.5);
  });

  it('loads heaviest plates first', () => {
    const load = calculatePlates(140);
    expect(load?.perSide.map((plate) => plate.kg)).toEqual([25, 25, 10]);
    expect(totalOf(load!.perSide)).toBe(140);
  });

  it('returns an empty side for the bare bar', () => {
    const load = calculatePlates(20);
    expect(load?.perSide).toEqual([]);
    expect(formatPerSide(load!)).toBe('—');
  });

  it('stays exact with repeated 1.25 and 2.5 plates', () => {
    // A naive float subtraction drifts here and leaves a phantom remainder.
    const load = calculatePlates(25);
    expect(load?.perSide.map((plate) => plate.kg)).toEqual([2.5]);
    expect(load?.remainderKg).toBe(0);

    // 23.5 kg leaves 1.75 per side: one 1.25 plate fits, 0.5 per side does not.
    const awkward = calculatePlates(23.5);
    expect(awkward?.perSide.map((plate) => plate.kg)).toEqual([1.25]);
    expect(awkward?.remainderKg).toBe(1);
  });

  it('reports what it cannot make up rather than rounding it away', () => {
    // 21 kg means 0.5 per side, and there is no 0.5 plate.
    const load = calculatePlates(21);
    expect(load?.perSide).toEqual([]);
    expect(load?.remainderKg).toBe(1);
  });

  it('says nothing when the weight is below the bar', () => {
    // Machines, cables and dumbbells record a weight that is not a barbell.
    expect(calculatePlates(15)).toBeNull();
    expect(calculatePlates(0)).toBeNull();
  });

  it('accepts a different bar', () => {
    const load = calculatePlates(35, 15);
    expect(load?.barKg).toBe(15);
    expect(load?.perSide.map((plate) => plate.kg)).toEqual([10]);
    expect(totalOf(load!.perSide, 15)).toBe(35);
  });

  it('handles a gym without the full plate set', () => {
    const limited = COMPETITION_PLATES.filter((plate) => plate.kg <= 20);
    const load = calculatePlates(100, DEFAULT_BAR_KG, limited);
    expect(load?.perSide.map((plate) => plate.kg)).toEqual([20, 20]);
    expect(load?.remainderKg).toBe(0);
  });

  it('rejects values that are not numbers', () => {
    expect(calculatePlates(Number.NaN)).toBeNull();
    expect(calculatePlates(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('carries the competition colour of each plate', () => {
    const load = calculatePlates(82.5);
    expect(load?.perSide.map((plate) => plate.colour)).toEqual(['red', 'white', 'chrome']);
  });
});

describe('formatPerSide', () => {
  it('lists the plates in loading order', () => {
    expect(formatPerSide(calculatePlates(140)!)).toBe('25 + 25 + 10');
    expect(formatPerSide(calculatePlates(82.5)!)).toBe('25 + 5 + 1.25');
  });
});
