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

const STORAGE_KEY = 'kilaje.outbox.v1';

/**
 * The key this queue used while the app was called Barra.
 *
 * The cached program was renamed without ceremony because it is a copy of what
 * the server already has. This queue is not: it holds writes that exist
 * nowhere else. A phone that was offline across the rename would silently lose
 * the sets logged on it, so the old key is adopted once and then removed.
 */
const LEGACY_STORAGE_KEY = 'barra.outbox.v1';

/** Stops a long offline session from filling the browser's quota. */
export const MAX_PENDING = 500;

/**
 * How long a queued write is still worth sending.
 *
 * A phone left in a bag for a fortnight still holds what was typed into it,
 * and replaying that on reopening would write a stale weight over whatever was
 * logged from another device since. Two days is longer than any gym session
 * and far shorter than the window in which the value stops being current.
 */
export const MAX_PENDING_AGE_MS = 2 * 24 * 60 * 60 * 1000;

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
    const raw = store.getItem(STORAGE_KEY) ?? adoptLegacy(store);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const oldest = Date.now() - MAX_PENDING_AGE_MS;
    // A write nobody has managed to send in two days is not a pending write,
    // it is an old opinion about a number somebody may have corrected since.
    return parsed.filter(isPendingEntry).filter((entry) => entry.queuedAt >= oldest);
  } catch {
    return [];
  }
}

/** Moves a pre-rename queue onto the current key, once. */
function adoptLegacy(store: Storage): string | null {
  const raw = store.getItem(LEGACY_STORAGE_KEY);
  if (raw === null) return null;
  store.setItem(STORAGE_KEY, raw);
  store.removeItem(LEGACY_STORAGE_KEY);
  return raw;
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
  const existing = readOutbox();

  // Strictly increasing, never merely "now": two writes in the same
  // millisecond — or any backwards jump of the device clock — would otherwise
  // produce two entries that removeSent cannot tell apart.
  const queuedAt = Math.max(Date.now(), ...existing.map((entry) => entry.queuedAt + 1), 0);

  let entries = existing.filter((entry) => entry.key !== key);

  if (operation.kind === 'resetSession') {
    entries = entries.filter((entry) => entry.operation.dayId !== operation.dayId);
  }

  entries.push({ key, operation, queuedAt });

  // Oldest first, so a runaway queue drops history rather than recent work.
  if (entries.length > MAX_PENDING) entries = entries.slice(-MAX_PENDING);

  writeOutbox(entries);
  return entries;
}

/**
 * Drops the entry that was just sent, and only that one.
 *
 * Removing by key alone loses data: a send takes time, and if the user
 * corrects the same field while it is in flight, {@link enqueue} replaces the
 * entry. Deleting by key would then throw away the correction that was never
 * sent — the queue ends up empty, the server holds the old value, and the
 * screen shows the new one with nothing left to reconcile them.
 */
export function removeSent(sent: PendingEntry): PendingEntry[] {
  const entries = readOutbox().filter(
    (entry) => entry.key !== sent.key || entry.queuedAt > sent.queuedAt,
  );
  writeOutbox(entries);
  return entries;
}

export function clearOutbox(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
    // Signing out must not leave a queue behind for the next person on this
    // phone, and that includes one written under the old name.
    store.removeItem(LEGACY_STORAGE_KEY);
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
