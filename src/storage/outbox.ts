/**
 * Writes that could not reach the server yet.
 *
 * A gym basement has no signal. Before this, an edit made offline stayed on
 * screen and in the cache but never reached PostgreSQL unless the user went
 * back and touched the field again. Now every failed write is queued and
 * replayed when the connection returns.
 *
 * The queue is keyed, not append-only: typing "8" then "80" in the same box
 * should send one write, not two. Later entries with the same key replace
 * earlier ones, so replay never applies a stale value on top of a fresh one.
 */

export type PendingOperation =
  | { kind: 'set'; dayId: string; exerciseId: number; setIndex: number; weight: number | null; reps: number | null; rir: number | null }
  | { kind: 'deleteSet'; dayId: string; exerciseId: number; setIndex: number }
  | { kind: 'session'; dayId: string; notes?: string; completed?: boolean }
  | { kind: 'resetSession'; dayId: string };

export interface PendingEntry {
  /** Identifies the thing being written, so repeats collapse. */
  key: string;
  operation: PendingOperation;
  queuedAt: number;
}

const STORAGE_KEY = 'gimnasio.outbox.v1';

/** Stops a long offline session from filling the browser's quota. */
export const MAX_PENDING = 500;

/** What makes two writes "the same write". */
export function operationKey(operation: PendingOperation): string {
  switch (operation.kind) {
    case 'set':
    case 'deleteSet':
      return `set:${operation.dayId}:${operation.exerciseId}:${operation.setIndex}`;
    case 'session':
      // Notes and completion are independent fields of the same row.
      return operation.notes !== undefined
        ? `notes:${operation.dayId}`
        : `completed:${operation.dayId}`;
    case 'resetSession':
      return `reset:${operation.dayId}`;
  }
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readOutbox(): PendingEntry[] {
  const store = storage();
  if (!store) return [];

  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingEntry);
  } catch {
    return [];
  }
}

function writeOutbox(entries: PendingEntry[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* quota: the edit is still in memory and on screen */
  }
}

/**
 * Queues a write, replacing any earlier one for the same target.
 *
 * A reset supersedes everything already queued for that day: replaying an
 * old set write after a reset would resurrect data the user cleared.
 */
export function enqueue(operation: PendingOperation): PendingEntry[] {
  const key = operationKey(operation);
  let entries = readOutbox().filter((entry) => entry.key !== key);

  if (operation.kind === 'resetSession') {
    entries = entries.filter((entry) => entry.operation.dayId !== operation.dayId);
  }

  entries.push({ key, operation, queuedAt: Date.now() });

  // Oldest first, so a runaway queue drops history rather than recent work.
  if (entries.length > MAX_PENDING) entries = entries.slice(-MAX_PENDING);

  writeOutbox(entries);
  return entries;
}

export function removeEntry(key: string): PendingEntry[] {
  const entries = readOutbox().filter((entry) => entry.key !== key);
  writeOutbox(entries);
  return entries;
}

export function clearOutbox(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    /* nothing sensible to do */
  }
}

function isPendingEntry(value: unknown): value is PendingEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<PendingEntry>;
  if (typeof entry.key !== 'string' || typeof entry.queuedAt !== 'number') return false;

  const operation = entry.operation as Partial<PendingOperation> | undefined;
  if (!operation || typeof operation.dayId !== 'string') return false;

  return (
    operation.kind === 'set' ||
    operation.kind === 'deleteSet' ||
    operation.kind === 'session' ||
    operation.kind === 'resetSession'
  );
}
