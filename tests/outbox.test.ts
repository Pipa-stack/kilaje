import { beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_PENDING,
  clearOutbox,
  enqueue,
  operationKey,
  readOutbox,
  removeEntry,
  type PendingOperation,
} from '../src/storage/outbox';

const setOn = (setIndex: number, weight: number | null): PendingOperation => ({
  kind: 'set',
  dayId: '1',
  exerciseId: 7,
  setIndex,
  weight,
  reps: 8,
  rir: 1,
});

beforeEach(() => {
  localStorage.clear();
  clearOutbox();
});

describe('queueing', () => {
  it('keeps a failed write so it can be sent later', () => {
    enqueue(setOn(0, 80));
    expect(readOutbox()).toHaveLength(1);
    expect(readOutbox()[0]?.operation).toMatchObject({ kind: 'set', weight: 80 });
  });

  it('collapses repeated edits to the same set', () => {
    // Typing "8" then "80" must send one write, not two.
    enqueue(setOn(0, 8));
    enqueue(setOn(0, 80));

    const entries = readOutbox();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.operation).toMatchObject({ weight: 80 });
  });

  it('keeps edits to different sets apart', () => {
    enqueue(setOn(0, 80));
    enqueue(setOn(1, 90));
    expect(readOutbox()).toHaveLength(2);
  });

  it('treats notes and completion as separate fields of the session', () => {
    enqueue({ kind: 'session', dayId: '1', notes: 'hola' });
    enqueue({ kind: 'session', dayId: '1', completed: true });
    expect(readOutbox()).toHaveLength(2);

    enqueue({ kind: 'session', dayId: '1', notes: 'adiós' });
    expect(readOutbox()).toHaveLength(2);
    expect(readOutbox().find((entry) => entry.key.startsWith('notes'))?.operation).toMatchObject({
      notes: 'adiós',
    });
  });

  it('lets a delete supersede a save of the same set', () => {
    enqueue(setOn(4, 60));
    enqueue({ kind: 'deleteSet', dayId: '1', exerciseId: 7, setIndex: 4 });

    const entries = readOutbox();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.operation.kind).toBe('deleteSet');
  });

  it('drops everything queued for a day when that day is reset', () => {
    // Replaying an old set write after a reset would resurrect cleared data.
    enqueue(setOn(0, 80));
    enqueue({ kind: 'session', dayId: '1', notes: 'x' });
    enqueue({ kind: 'set', dayId: '2', exerciseId: 9, setIndex: 0, weight: 50, reps: 5, rir: 0 });

    enqueue({ kind: 'resetSession', dayId: '1' });

    const entries = readOutbox();
    expect(entries.map((entry) => entry.operation.kind)).toEqual(['set', 'resetSession']);
    expect(entries.find((entry) => entry.operation.kind === 'set')?.operation.dayId).toBe('2');
  });

  it('keeps the newest work when the queue overflows', () => {
    for (let index = 0; index < MAX_PENDING + 20; index += 1) {
      enqueue(setOn(index, index));
    }

    const entries = readOutbox();
    expect(entries).toHaveLength(MAX_PENDING);
    // The oldest were dropped, not the most recent.
    expect(entries.at(-1)?.operation).toMatchObject({ setIndex: MAX_PENDING + 19 });
  });

  it('removes an entry once it has been sent', () => {
    enqueue(setOn(0, 80));
    const key = readOutbox()[0]!.key;
    expect(removeEntry(key)).toHaveLength(0);
    expect(readOutbox()).toHaveLength(0);
  });

  it('preserves order, oldest first', () => {
    enqueue(setOn(0, 10));
    enqueue(setOn(1, 20));
    enqueue(setOn(2, 30));
    expect(readOutbox().map((entry) => entry.operation)).toMatchObject([
      { setIndex: 0 },
      { setIndex: 1 },
      { setIndex: 2 },
    ]);
  });
});

describe('operationKey', () => {
  it('gives a save and a delete of the same set the same key', () => {
    expect(operationKey(setOn(2, 80))).toBe(
      operationKey({ kind: 'deleteSet', dayId: '1', exerciseId: 7, setIndex: 2 }),
    );
  });

  it('separates days', () => {
    expect(operationKey({ kind: 'resetSession', dayId: '1' })).not.toBe(
      operationKey({ kind: 'resetSession', dayId: '2' }),
    );
  });
});

describe('surviving bad storage', () => {
  it('ignores unparseable contents', () => {
    localStorage.setItem('gimnasio.outbox.v1', '{no json');
    expect(readOutbox()).toEqual([]);
  });

  it('drops entries of the wrong shape', () => {
    localStorage.setItem(
      'gimnasio.outbox.v1',
      JSON.stringify([
        { key: 'ok', queuedAt: 1, operation: { kind: 'resetSession', dayId: '1' } },
        { key: 'malo', queuedAt: 1, operation: { kind: 'inventado', dayId: '1' } },
        'ni siquiera un objeto',
      ]),
    );
    expect(readOutbox()).toHaveLength(1);
  });

  it('starts empty when there is nothing stored', () => {
    expect(readOutbox()).toEqual([]);
  });
});
