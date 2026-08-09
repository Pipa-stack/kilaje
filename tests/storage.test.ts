import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SELECTION_KEY,
  STORAGE_KEY,
  cacheProgram,
  clearProgram,
  loadCachedProgram,
  loadSelection,
  mergeProgram,
  normalizeProgram,
  saveSelection,
} from '../src/storage/storage';
import { emptySets, type Program, type SetEntry } from '../src/domain/types';

function set(weight: number | null, reps: number | null, rir: number | null = null): SetEntry {
  return { weight, reps, rir };
}

function makeProgram(overrides: Partial<Program> = {}): Program {
  return {
    schemaVersion: 1,
    sourceFileName: 'ejemplo.xlsx',
    importedAt: '2026-01-01T00:00:00.000Z',
    weeks: [
      {
        number: 1,
        sheetName: 'Semana 1',
        days: [
          {
            id: 'w1:d1',
            number: 1,
            type: 'PUSH',
            notes: '',
            completed: false,
            exercises: [
              {
                id: 'w1:d1:e1',
                number: 1,
                name: 'PRESS DE BANCA',
                video: null,
                protocol: '3 SETS X 4-6 REPS',
                comments: null,
                previousWeek: emptySets(4),
                currentWeek: emptySets(4),
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

/** The cache always carries the database identity; that is what makes it usable. */
function makeCached(overrides: Partial<Program> = {}) {
  return { ...makeProgram(overrides), id: 1, name: 'ejemplo', version: 1 };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('save and load', () => {
  it('round-trips a program unchanged', () => {
    const program = makeCached();
    expect(cacheProgram(program)).toBe(true);
    expect(loadCachedProgram()).toEqual(program);
  });

  it('returns null when nothing has been saved', () => {
    expect(loadCachedProgram()).toBeNull();
  });

  it('preserves logged sets across a reload', () => {
    const program = makeCached();
    program.weeks[0]!.days[0]!.exercises[0]!.currentWeek[0] = set(82.5, 4, 1);
    program.weeks[0]!.days[0]!.notes = 'buen día';
    program.weeks[0]!.days[0]!.completed = true;
    cacheProgram(program);

    const reloaded = loadCachedProgram();
    expect(reloaded?.weeks[0]?.days[0]?.exercises[0]?.currentWeek[0]).toEqual(set(82.5, 4, 1));
    expect(reloaded?.weeks[0]?.days[0]?.notes).toBe('buen día');
    expect(reloaded?.weeks[0]?.days[0]?.completed).toBe(true);
  });

  it('clears everything on request, which is what sign-out relies on', () => {
    cacheProgram(makeCached());
    saveSelection({ weekNumber: 1, dayNumber: 1 });
    clearProgram();
    expect(loadCachedProgram()).toBeNull();
    expect(loadSelection()).toBeNull();
  });
});

describe('offline cache', () => {
  const stored = { ...makeProgram(), id: 7, name: 'Ejemplo (v2)', version: 2 };

  it('round-trips a program together with its database identity', () => {
    expect(cacheProgram(stored)).toBe(true);
    const cached = loadCachedProgram();
    expect(cached?.id).toBe(7);
    expect(cached?.name).toBe('Ejemplo (v2)');
    expect(cached?.version).toBe(2);
    expect(cached?.weeks[0]?.days[0]?.exercises[0]?.name).toBe('PRESS DE BANCA');
  });

  it('keeps logged sets available while offline', () => {
    const withWork = structuredClone(stored);
    withWork.weeks[0]!.days[0]!.exercises[0]!.currentWeek[0] = set(82.5, 4, 1);
    cacheProgram(withWork);
    expect(loadCachedProgram()?.weeks[0]?.days[0]?.exercises[0]?.currentWeek[0]).toEqual(
      set(82.5, 4, 1),
    );
  });

  it('returns nothing when there is no cache', () => {
    expect(loadCachedProgram()).toBeNull();
  });

  it('rejects a cache without database identity', () => {
    // Written by the older localStorage-only build: it cannot be reconciled
    // with the API, so showing it as if it could would be a lie.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(makeProgram()));
    expect(loadCachedProgram()).toBeNull();
  });

  it('rejects a corrupted cache', () => {
    localStorage.setItem(STORAGE_KEY, '{oops');
    expect(loadCachedProgram()).toBeNull();
  });
});

describe('tolerating bad stored data', () => {
  it('ignores unparseable JSON instead of throwing', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadCachedProgram()).toBeNull();
  });

  it('ignores JSON of the wrong shape', () => {
    localStorage.setItem(STORAGE_KEY, '"just a string"');
    expect(loadCachedProgram()).toBeNull();
    localStorage.setItem(STORAGE_KEY, '{"weeks":"nope"}');
    expect(loadCachedProgram()).toBeNull();
    localStorage.setItem(STORAGE_KEY, '{"weeks":[]}');
    expect(loadCachedProgram()).toBeNull();
  });

  it('drops malformed weeks, days and exercises but keeps the rest', () => {
    const program = makeCached();
    const raw = JSON.parse(JSON.stringify({ ...program, id: 1, name: 'x', version: 1 }));
    raw.weeks.push({ number: 'two' }, null);
    raw.weeks[0].days.push({ number: null });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));

    const loaded = loadCachedProgram();
    expect(loaded?.weeks).toHaveLength(1);
    expect(loaded?.weeks[0]?.days).toHaveLength(1);
  });

  it('repairs missing and non-numeric set values', () => {
    const raw = JSON.parse(JSON.stringify(makeCached()));
    raw.weeks[0].days[0].exercises[0].currentWeek = [
      { weight: '82.5', reps: 4, rir: null },
      { weight: Number.NaN, reps: 8, rir: 2 },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));

    const sets = loadCachedProgram()?.weeks[0]?.days[0]?.exercises[0]?.currentWeek;
    expect(sets).toHaveLength(4); // padded back to the template's four slots
    expect(sets?.[0]).toEqual(set(null, 4, null)); // the string weight is dropped
    expect(sets?.[1]).toEqual(set(null, 8, 2)); // NaN is not a value
  });

  it('rejects prototype-pollution attempts in stored JSON', () => {
    localStorage.setItem(
      STORAGE_KEY,
      '{"weeks":[{"number":1,"days":[{"number":1,"exercises":[{"number":1}]}]}],"__proto__":{"polluted":true}}',
    );
    loadCachedProgram();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('normalizeProgram rejects non-objects outright', () => {
    expect(normalizeProgram(null)).toBeNull();
    expect(normalizeProgram([])).toBeNull();
    expect(normalizeProgram(42)).toBeNull();
  });
});

describe('when storage is unavailable', () => {
  it('reports unavailability and degrades quietly', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    expect(cacheProgram(makeCached())).toBe(false);
    expect(loadCachedProgram()).toBeNull();
    expect(() => clearProgram()).not.toThrow();
    expect(() => saveSelection({ weekNumber: 1, dayNumber: 1 })).not.toThrow();
  });
});

describe('selection', () => {
  it('round-trips the current week and day', () => {
    saveSelection({ weekNumber: 2, dayNumber: 3 });
    expect(loadSelection()).toEqual({ weekNumber: 2, dayNumber: 3 });
  });

  it('ignores a corrupted selection', () => {
    localStorage.setItem(SELECTION_KEY, '{"weekNumber":"x"}');
    expect(loadSelection()).toBeNull();
    localStorage.setItem(SELECTION_KEY, 'nonsense');
    expect(loadSelection()).toBeNull();
  });
});

describe('mergeProgram on re-import', () => {
  it('returns the incoming program when nothing was stored', () => {
    const incoming = makeProgram();
    expect(mergeProgram(incoming, null)).toEqual(incoming);
  });

  it('keeps sets the user logged in the app', () => {
    const existing = makeProgram();
    existing.weeks[0]!.days[0]!.exercises[0]!.currentWeek[0] = set(82.5, 4, 1);

    const merged = mergeProgram(makeProgram(), existing);
    expect(merged.weeks[0]?.days[0]?.exercises[0]?.currentWeek[0]).toEqual(set(82.5, 4, 1));
  });

  it('lets the incoming file win where it has a value', () => {
    const existing = makeProgram();
    existing.weeks[0]!.days[0]!.exercises[0]!.currentWeek[0] = set(80, 10, 3);

    const incoming = makeProgram();
    incoming.weeks[0]!.days[0]!.exercises[0]!.currentWeek[0] = set(100, null, null);

    const merged = mergeProgram(incoming, existing);
    // Weight comes from the file; the untouched fields survive from storage.
    expect(merged.weeks[0]?.days[0]?.exercises[0]?.currentWeek[0]).toEqual(set(100, 10, 3));
  });

  it('takes structure from the incoming file', () => {
    const existing = makeProgram();
    const incoming = makeProgram();
    incoming.weeks[0]!.days[0]!.exercises[0]!.protocol = '4 SETS X 8 REPS';
    incoming.weeks[0]!.days[0]!.exercises[0]!.video = 'https://youtu.be/x';

    const merged = mergeProgram(incoming, existing);
    expect(merged.weeks[0]?.days[0]?.exercises[0]?.protocol).toBe('4 SETS X 8 REPS');
    expect(merged.weeks[0]?.days[0]?.exercises[0]?.video).toBe('https://youtu.be/x');
  });

  it('does not carry data over when the exercise at that slot changed', () => {
    const existing = makeProgram();
    existing.weeks[0]!.days[0]!.exercises[0]!.currentWeek[0] = set(82.5, 4, 1);

    const incoming = makeProgram();
    incoming.weeks[0]!.days[0]!.exercises[0]!.name = 'SENTADILLA';

    const merged = mergeProgram(incoming, existing);
    expect(merged.weeks[0]?.days[0]?.exercises[0]?.currentWeek[0]).toEqual(set(null, null, null));
  });

  it('keeps notes and completion recorded in the app', () => {
    const existing = makeProgram();
    existing.weeks[0]!.days[0]!.notes = 'sensaciones buenas';
    existing.weeks[0]!.days[0]!.completed = true;

    const merged = mergeProgram(makeProgram(), existing);
    expect(merged.weeks[0]?.days[0]?.notes).toBe('sensaciones buenas');
    expect(merged.weeks[0]?.days[0]?.completed).toBe(true);
  });

  it('keeps extra sets the user added beyond the template', () => {
    const existing = makeProgram();
    existing.weeks[0]!.days[0]!.exercises[0]!.currentWeek.push(set(60, 12, 0));

    const merged = mergeProgram(makeProgram(), existing);
    const sets = merged.weeks[0]?.days[0]?.exercises[0]?.currentWeek;
    expect(sets).toHaveLength(5);
    expect(sets?.[4]).toEqual(set(60, 12, 0));
  });

  it('ignores stored days that no longer exist in the file', () => {
    const existing = makeProgram();
    existing.weeks[0]!.days.push({ ...existing.weeks[0]!.days[0]!, id: 'w1:d9', number: 9 });

    const merged = mergeProgram(makeProgram(), existing);
    expect(merged.weeks[0]?.days.map((day) => day.number)).toEqual([1]);
  });
});
