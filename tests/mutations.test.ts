import { describe, expect, it } from 'vitest';

import {
  MAX_SETS,
  addSet,
  parseNumericInput,
  removeSet,
  resetDay,
  setDayCompleted,
  setDayNotes,
  updateSet,
} from '../src/domain/mutations';
import { emptySets, type Program } from '../src/domain/types';

function makeProgram(): Program {
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
  };
}

const DAY = 'w1:d1';
const EXERCISE = 'w1:d1:e1';

function setsOf(program: Program) {
  return program.weeks[0]!.days[0]!.exercises[0]!.currentWeek;
}

describe('updateSet', () => {
  it('writes one field without touching the others', () => {
    let program = updateSet(makeProgram(), DAY, EXERCISE, 0, { weight: 82.5 });
    program = updateSet(program, DAY, EXERCISE, 0, { reps: 4 });
    expect(setsOf(program)[0]).toEqual({ weight: 82.5, reps: 4, rir: null });
  });

  it('does not mutate the input program', () => {
    const original = makeProgram();
    const snapshot = structuredClone(original);
    updateSet(original, DAY, EXERCISE, 0, { weight: 100 });
    expect(original).toEqual(snapshot);
  });

  it('ignores unknown ids and out-of-range indexes', () => {
    const original = makeProgram();
    expect(updateSet(original, 'nope', EXERCISE, 0, { weight: 1 })).toEqual(original);
    expect(updateSet(original, DAY, 'nope', 0, { weight: 1 })).toEqual(original);
    expect(updateSet(original, DAY, EXERCISE, 99, { weight: 1 })).toEqual(original);
    expect(updateSet(original, DAY, EXERCISE, -1, { weight: 1 })).toEqual(original);
  });

  it('accepts null to clear a value', () => {
    let program = updateSet(makeProgram(), DAY, EXERCISE, 0, { weight: 80 });
    program = updateSet(program, DAY, EXERCISE, 0, { weight: null });
    expect(setsOf(program)[0]?.weight).toBeNull();
  });
});

describe('addSet', () => {
  it('appends a set carrying the last weight forward', () => {
    let program = updateSet(makeProgram(), DAY, EXERCISE, 1, { weight: 80, reps: 8 });
    program = addSet(program, DAY, EXERCISE);
    expect(setsOf(program)).toHaveLength(5);
    expect(setsOf(program)[4]).toEqual({ weight: 80, reps: null, rir: null });
  });

  it('appends an empty set when nothing is logged yet', () => {
    const program = addSet(makeProgram(), DAY, EXERCISE);
    expect(setsOf(program)[4]).toEqual({ weight: null, reps: null, rir: null });
  });

  it('stops at the maximum set count', () => {
    let program = makeProgram();
    for (let index = 0; index < MAX_SETS + 5; index += 1) program = addSet(program, DAY, EXERCISE);
    expect(setsOf(program)).toHaveLength(MAX_SETS);
  });
});

describe('removeSet', () => {
  it('clears one of the template\'s four slots instead of removing it', () => {
    let program = updateSet(makeProgram(), DAY, EXERCISE, 1, { weight: 80, reps: 8 });
    program = removeSet(program, DAY, EXERCISE, 1);
    expect(setsOf(program)).toHaveLength(4);
    expect(setsOf(program)[1]).toEqual({ weight: null, reps: null, rir: null });
  });

  it('removes sets added beyond the template', () => {
    let program = addSet(makeProgram(), DAY, EXERCISE);
    program = removeSet(program, DAY, EXERCISE, 4);
    expect(setsOf(program)).toHaveLength(4);
  });

  it('ignores out-of-range indexes', () => {
    const original = makeProgram();
    expect(removeSet(original, DAY, EXERCISE, 42)).toEqual(original);
  });
});

describe('day-level edits', () => {
  it('stores notes', () => {
    const program = setDayNotes(makeProgram(), DAY, 'hombro derecho molesta');
    expect(program.weeks[0]?.days[0]?.notes).toBe('hombro derecho molesta');
  });

  it('marks completion both ways', () => {
    let program = setDayCompleted(makeProgram(), DAY, true);
    expect(program.weeks[0]?.days[0]?.completed).toBe(true);
    program = setDayCompleted(program, DAY, false);
    expect(program.weeks[0]?.days[0]?.completed).toBe(false);
  });

  it('resets a day back to empty', () => {
    let program = updateSet(makeProgram(), DAY, EXERCISE, 0, { weight: 80, reps: 8, rir: 1 });
    program = addSet(program, DAY, EXERCISE);
    program = setDayNotes(program, DAY, 'notas');
    program = setDayCompleted(program, DAY, true);

    program = resetDay(program, DAY);
    const day = program.weeks[0]!.days[0]!;
    expect(day.notes).toBe('');
    expect(day.completed).toBe(false);
    expect(setsOf(program)).toHaveLength(4);
    expect(setsOf(program).every((set) => set.weight === null)).toBe(true);
  });

  it('keeps the previous week untouched when resetting', () => {
    const original = makeProgram();
    original.weeks[0]!.days[0]!.exercises[0]!.previousWeek[0] = { weight: 75, reps: 10, rir: 2 };
    const program = resetDay(original, DAY);
    expect(program.weeks[0]?.days[0]?.exercises[0]?.previousWeek[0]).toEqual({
      weight: 75,
      reps: 10,
      rir: 2,
    });
  });
});

describe('parseNumericInput', () => {
  it('accepts plain and comma decimals', () => {
    expect(parseNumericInput('82.5')).toBe(82.5);
    expect(parseNumericInput('82,5')).toBe(82.5);
    expect(parseNumericInput(' 100 ')).toBe(100);
    expect(parseNumericInput('0')).toBe(0);
  });

  it('reads an empty field as a cleared value', () => {
    expect(parseNumericInput('')).toBeNull();
    expect(parseNumericInput('   ')).toBeNull();
  });

  it('refuses half-typed input rather than destroying the stored value', () => {
    expect(parseNumericInput('82.')).toBeUndefined();
    expect(parseNumericInput('-')).toBeUndefined();
    expect(parseNumericInput('abc')).toBeUndefined();
    expect(parseNumericInput('8e3')).toBeUndefined();
  });

  it('refuses negatives and values outside the allowed range', () => {
    expect(parseNumericInput('-5')).toBeUndefined();
    expect(parseNumericInput('11', { max: 10 })).toBeUndefined();
    expect(parseNumericInput('10', { max: 10 })).toBe(10);
  });
});
