/**
 * Typed client for the training API.
 *
 * The server returns the same normalized {@link Program} shape the app already
 * worked with, so switching persistence from `localStorage` to PostgreSQL did
 * not change the domain, the calculations or the components — only where the
 * data comes from.
 */

import type { Program } from '../domain/types';

/** A program as listed in the picker. */
export interface ProgramSummary {
  id: number;
  name: string;
  sourceFileName: string;
  version: number;
  importedAt: string;
  weekCount: number;
  dayCount: number;
  completedDays: number;
}

export interface StoredProgram extends Program {
  id: number;
  name: string;
  version: number;
}

/** An API call that failed, carrying the server's message when it gave one. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }

  /** True when the server could not be reached at all. */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

const BASE = '/api';

async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError('No se ha podido conectar con el servidor.', 0);
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === 'string'
        ? payload.error
        : `Error ${response.status} del servidor.`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function fetchPrograms(): Promise<ProgramSummary[]> {
  const { programs } = await callApi<{ programs: ProgramSummary[] }>('/programs');
  return programs;
}

/** The most recently imported program, or `null` when there is none yet. */
export async function fetchLatestProgram(): Promise<StoredProgram | null> {
  try {
    const { program } = await callApi<{ program: StoredProgram }>('/programs/latest');
    return program;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function fetchProgram(programId: number): Promise<StoredProgram> {
  const { program } = await callApi<{ program: StoredProgram }>(`/programs/${programId}`);
  return program;
}

/**
 * Uploads a workbook as raw bytes.
 *
 * Parsing happens on the server, so the database is never handed a program
 * object assembled by the browser.
 */
export async function importProgram(file: File): Promise<StoredProgram> {
  const bytes = await file.arrayBuffer();
  const { program } = await callApi<{ program: StoredProgram; created: boolean }>(
    `/programs?filename=${encodeURIComponent(file.name)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    },
  );
  return program;
}

/** Deletes a program and every session logged against it. */
export async function deleteProgram(programId: number): Promise<void> {
  await callApi<void>(`/programs/${programId}`, { method: 'DELETE' });
}

export interface SetPayload {
  exerciseId: number;
  setIndex: number;
  weight: number | null;
  reps: number | null;
  rir: number | null;
}

export async function saveSet(dayId: string, payload: SetPayload): Promise<void> {
  await callApi<void>(`/days/${dayId}/sets`, { ...json(payload), method: 'PUT' });
}

export async function deleteSet(
  dayId: string,
  payload: { exerciseId: number; setIndex: number },
): Promise<void> {
  await callApi<void>(`/days/${dayId}/sets`, { ...json(payload), method: 'DELETE' });
}

export async function updateSession(
  dayId: string,
  patch: { notes?: string; completed?: boolean },
): Promise<void> {
  await callApi<void>(`/days/${dayId}/session`, { ...json(patch), method: 'PATCH' });
}

export async function resetSession(dayId: string): Promise<void> {
  await callApi<void>(`/days/${dayId}/session`, { method: 'DELETE' });
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export interface Account {
  id: number;
  email: string;
}

/**
 * The signed-in account, or `null` when there is no session.
 *
 * The session lives in an httpOnly cookie, so the browser cannot read it and
 * the only way to know is to ask.
 */
export async function fetchAccount(): Promise<Account | null> {
  try {
    const { user } = await callApi<{ user: Account }>('/auth/me');
    return user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function register(email: string, password: string): Promise<Account> {
  const { user } = await callApi<{ user: Account }>('/auth/register', json({ email, password }));
  return user;
}

export async function login(email: string, password: string): Promise<Account> {
  const { user } = await callApi<{ user: Account }>('/auth/login', json({ email, password }));
  return user;
}

export async function logout(): Promise<void> {
  await callApi<void>('/auth/logout', { method: 'POST' });
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export interface HistoryEntry {
  programId: number;
  programName: string;
  weekNumber: number;
  dayNumber: number;
  dayType: string | null;
  performedAt: string;
  sets: { weight: number | null; reps: number | null; rir: number | null }[];
  volume: number;
  topWeight: number | null;
  oneRepMax: number | null;
}

export interface ExerciseHistory {
  name: string;
  sessions: number;
  programs: number;
  totalVolume: number;
  bestOneRepMax: number | null;
  bestWeight: number | null;
  firstTrainedAt: string | null;
  lastTrainedAt: string | null;
  entries: HistoryEntry[];
}

/** Everything ever logged, grouped by exercise name, across all programs. */
export async function fetchHistory(): Promise<ExerciseHistory[]> {
  const { exercises } = await callApi<{ exercises: ExerciseHistory[] }>('/history');
  return exercises;
}

/** Changes the password. Every other session is revoked server-side. */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await callApi<void>('/auth/password', json({ currentPassword, newPassword }));
}

/* ------------------------------------------------------------------ */
/* Password recovery                                                   */
/* ------------------------------------------------------------------ */

/**
 * Asks for a reset link.
 *
 * Always resolves, whether or not the address has an account: the server
 * answers the same either way so this cannot be used as a membership check.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await callApi<void>('/auth/forgot', json({ email }));
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await callApi<void>('/auth/reset', json({ token, newPassword }));
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export type WeightUnit = 'kg' | 'lb';

export interface Profile {
  identity: {
    email: string;
    displayName: string;
    gym: string | null;
    weightUnit: WeightUnit;
    memberSince: string;
  };
  stats: {
    completedSessions: number;
    startedSessions: number;
    totalVolumeKg: number;
    distinctExercises: number;
    totalSets: number;
    programs: number;
  };
  records: { exercise: string; oneRepMax: number; topWeight: number | null; achievedAt: string }[];
  bodyWeights: { weightKg: number; measuredOn: string }[];
}

export async function fetchProfile(): Promise<Profile> {
  const { profile } = await callApi<{ profile: Profile }>('/profile');
  return profile;
}

export async function updateProfile(patch: {
  displayName?: string | null;
  gym?: string | null;
  weightUnit?: WeightUnit;
}): Promise<void> {
  await callApi<void>('/profile', { ...json(patch), method: 'PATCH' });
}

/** Records today's weigh-in, in kilos. One reading per day replaces the last. */
export async function recordBodyWeight(weightKg: number, measuredOn?: string): Promise<void> {
  await callApi<void>('/profile/weight', {
    ...json({ weightKg, ...(measuredOn ? { measuredOn } : {}) }),
    method: 'PUT',
  });
}
