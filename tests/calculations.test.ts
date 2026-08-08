import { describe, expect, it } from 'vitest';

import {
  dayProgress,
  dayPreviousVolume,
  dayVolume,
  epley1RM,
  excelRound,
  exercise1RM,
  exerciseProgression,
  exerciseVolume,
  formatVolume,
  isExerciseStarted,
  loggedSetCount,
  parseProtocolSetCount,
  roundToPlate,
  suggestProgression,
  volumeChangePercent,
  weekVolume,
} from '../src/domain/calculations';
import { emptySets, type Day, type Exercise, type SetEntry, type Week } from '../src/domain/types';

function set(weight: number | null, reps: number | null, rir: number | null = null): SetEntry {
  return { weight, reps, rir };
}

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'w1:d1:e1',
    number: 1,
    name: 'PRESS DE BANCA',
    video: null,
    protocol: null,
    comments: null,
    previousWeek: emptySets(4),
    currentWeek: emptySets(4),
    ...overrides,
  };
}

function day(exercises: Exercise[]): Day {
  return { id: 'w1:d1', number: 1, type: 'PUSH', exercises, notes: '', completed: false };
}

describe('excelRound', () => {
  it('rounds half away from zero, unlike Math.round', () => {
    expect(excelRound(2.5)).toBe(3);
    expect(excelRound(-2.5)).toBe(-3);
    expect(Math.round(-2.5)).toBe(-2); // the bug we are avoiding
  });

  it('respects the requested number of digits', () => {
    expect(excelRound(87.5666, 1)).toBe(87.6);
    expect(excelRound(87.44, 1)).toBe(87.4);
    expect(excelRound(2.345, 2)).toBe(2.35);
  });

  it('survives binary floating point representation', () => {
    // 1.005 is stored as 1.00499999...; a naive scale-and-round gives 1.
    expect(excelRound(1.005, 2)).toBe(1.01);
    expect(excelRound(8.575, 2)).toBe(8.58);
  });

  it('passes non-finite values through unchanged', () => {
    expect(excelRound(Number.NaN)).toBeNaN();
    expect(excelRound(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('roundToPlate', () => {
  it('snaps to the nearest 2.5 kg increment', () => {
    expect(roundToPlate(82.5)).toBe(82.5);
    expect(roundToPlate(83)).toBe(82.5);
    expect(roundToPlate(84)).toBe(85);
    expect(roundToPlate(81.25)).toBe(82.5); // half rounds away from zero
  });
});

describe('epley1RM', () => {
  it('matches the template formula ROUND(w*(1+r/30),1)', () => {
    // The value actually seeded in the reference workbook: 82.5 kg x 4 reps.
    expect(epley1RM(set(82.5, 4))).toBe(93.5);
    expect(epley1RM(set(100, 1))).toBe(103.3);
    expect(epley1RM(set(100, 30))).toBe(200);
  });

  it('is blank unless both weight and reps are present', () => {
    expect(epley1RM(set(82.5, null))).toBeNull();
    expect(epley1RM(set(null, 4))).toBeNull();
    expect(epley1RM(undefined)).toBeNull();
  });

  it('treats zero as a value, not as blank, like Excel does', () => {
    expect(epley1RM(set(0, 5))).toBe(0);
  });

  it('reads set 1 of the current week for an exercise', () => {
    const ex = exercise({ currentWeek: [set(80, 5), set(100, 1), ...emptySets(2)] });
    expect(exercise1RM(ex)).toBe(93.3);
  });
});

describe('exerciseVolume', () => {
  it('sums weight x reps across sets', () => {
    expect(exerciseVolume([set(80, 10), set(80, 8), set(70, 8)])).toBe(80 * 10 + 80 * 8 + 70 * 8);
  });

  it('treats blanks as zero', () => {
    expect(exerciseVolume([set(80, 10), set(null, null), set(90, null)])).toBe(800);
  });

  it('is zero for an untouched exercise', () => {
    expect(exerciseVolume(emptySets(4))).toBe(0);
  });

  it('ignores RIR', () => {
    expect(exerciseVolume([set(50, 10, 0)])).toBe(exerciseVolume([set(50, 10, 3)]));
  });
});

describe('dayVolume / weekVolume', () => {
  const target = day([
    exercise({ currentWeek: [set(80, 10), set(80, 8), ...emptySets(2)] }),
    exercise({ id: 'w1:d1:e2', number: 2, currentWeek: [set(50, 12), ...emptySets(3)] }),
  ]);

  it('sums every exercise in the day', () => {
    expect(dayVolume(target)).toBe(800 + 640 + 600);
  });

  it('sums the previous-week columns separately', () => {
    const withHistory = day([
      exercise({ previousWeek: [set(75, 10), ...emptySets(3)], currentWeek: emptySets(4) }),
    ]);
    expect(dayPreviousVolume(withHistory)).toBe(750);
    expect(dayVolume(withHistory)).toBe(0);
  });

  it('sums every day in the week', () => {
    const week: Week = { number: 1, sheetName: 'Semana 1', days: [target, target] };
    expect(weekVolume(week)).toBe(2 * (800 + 640 + 600));
  });
});

describe('suggestProgression', () => {
  it('holds the weight at RIR 0', () => {
    expect(suggestProgression(set(82.5, 4, 0))).toEqual({
      weight: 82.5,
      delta: 0,
      text: '82.5 kg (=)',
    });
  });

  it('adds 2.5 kg at RIR 1', () => {
    expect(suggestProgression(set(80, 6, 1))).toEqual({
      weight: 82.5,
      delta: 2.5,
      text: '82.5 kg (+2.5)',
    });
  });

  it('adds 5 kg at RIR 2 or more', () => {
    expect(suggestProgression(set(80, 6, 2)).text).toBe('85 kg (+5)');
    expect(suggestProgression(set(80, 6, 4)).text).toBe('85 kg (+5)');
  });

  it('adds 5 kg when RIR is missing, matching Excel comparison semantics', () => {
    // In Excel both ""=0 and ""=1 are FALSE, so a blank RIR falls to the else.
    expect(suggestProgression(set(80, 6, null)).text).toBe('85 kg (+5)');
  });

  it('rounds the result to a 2.5 kg increment', () => {
    expect(suggestProgression(set(81, 6, 0)).text).toBe('80 kg (=)');
    // 83.7 + 2.5 = 86.2 -> nearest 2.5 increment is 85
    expect(suggestProgression(set(83.7, 6, 1)).text).toBe('85 kg (+2.5)');
  });

  it('has nothing to suggest without a previous weight', () => {
    expect(suggestProgression(set(null, null, 0)).text).toBe('—');
    expect(suggestProgression(undefined).text).toBe('—');
  });

  it('reads set 1 of the previous week for an exercise', () => {
    const ex = exercise({ previousWeek: [set(100, 5, 1), ...emptySets(3)] });
    expect(exerciseProgression(ex).text).toBe('102.5 kg (+2.5)');
  });
});

describe('parseProtocolSetCount', () => {
  it('reads the set count out of real protocol strings', () => {
    expect(parseProtocolSetCount('3 SETS X 4-6 / 6-8 / 8-10 REPS (RIR 0)')).toBe(3);
    expect(parseProtocolSetCount('2 SETS X 6-8 REPS (RIR 0)')).toBe(2);
    expect(parseProtocolSetCount('1 SETS X 6-8 REPS (RIR 0)')).toBe(1);
  });

  it('returns null when there is nothing to read', () => {
    expect(parseProtocolSetCount(null)).toBeNull();
    expect(parseProtocolSetCount('al fallo')).toBeNull();
    expect(parseProtocolSetCount('0 SETS')).toBeNull();
  });
});

describe('progress helpers', () => {
  it('counts sets with a weight or reps recorded', () => {
    expect(loggedSetCount([set(80, 10), set(null, 8), set(null, null)])).toBe(2);
  });

  it('reports an exercise as started once any set has data', () => {
    expect(isExerciseStarted(exercise())).toBe(false);
    expect(isExerciseStarted(exercise({ currentWeek: [set(80, null), ...emptySets(3)] }))).toBe(true);
  });

  it('reports day progress', () => {
    const target = day([
      exercise({ currentWeek: [set(80, 10), ...emptySets(3)] }),
      exercise({ id: 'w1:d1:e2', number: 2 }),
    ]);
    expect(dayProgress(target)).toEqual({ totalExercises: 2, startedExercises: 1, ratio: 0.5 });
  });

  it('reports zero progress for a day with no exercises', () => {
    expect(dayProgress(day([])).ratio).toBe(0);
  });
});

describe('volumeChangePercent', () => {
  it('compares this week against last week', () => {
    expect(volumeChangePercent(1100, 1000)).toBe(10);
    expect(volumeChangePercent(900, 1000)).toBe(-10);
  });

  it('has nothing to compare when there was no previous volume', () => {
    expect(volumeChangePercent(1000, 0)).toBeNull();
  });
});

describe('formatVolume', () => {
  it('renders a plain kilogram figure', () => {
    expect(formatVolume(0)).toBe('0 kg');
    expect(formatVolume(12480)).toBe('12480 kg');
    expect(formatVolume(1234.56)).toBe('1234.6 kg');
  });
});
