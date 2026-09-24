/**
 * Typed client for the training API.
 *
 * The server returns the same normalized {@link Program} shape the app already
 * worked with, so switching persistence from `localStorage` to PostgreSQL did
 * not change the domain, the calculations or the components — only where the
 * data comes from.
 */

import type { BestSet } from '../domain/calculations';
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
  /** Quién lo subió, si no fue uno mismo. */
  assignedBy: string | null;
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

/**
 * Starts the next week of a program.
 *
 * The server clones the last week's plan and leaves the sets empty, so the
 * plan can carry on past the weeks the workbook contained without re-importing
 * anything. Returns the program with the new week already in it.
 */
export async function addWeek(
  programId: number,
  options: { copyWeights?: boolean } = {},
): Promise<StoredProgram> {
  const { program } = await callApi<{ program: StoredProgram }>(`/programs/${programId}/weeks`, {
    ...json(options),
    method: 'POST',
  });
  return program;
}

/**
 * Starts an empty plan with `days` sessions in its first week.
 *
 * For anybody who does not have a coach's spreadsheet — which, until this
 * existed, meant they could not use the app at all.
 */
export async function createBlankProgram(days: number): Promise<StoredProgram> {
  const { program } = await callApi<{ program: StoredProgram }>(
    '/programs/blank',
    json({ days }),
  );
  return program;
}

/** Adds a session to the end of a week. */
export async function addDay(programId: number, weekNumber: number): Promise<StoredProgram> {
  const { program } = await callApi<{ program: StoredProgram }>(
    `/programs/${programId}/weeks/${weekNumber}/days`,
    { method: 'POST' },
  );
  return program;
}

/** Deletes a day. The server refuses if anything was logged against it. */
export async function removeDay(dayId: string): Promise<StoredProgram> {
  const { program } = await callApi<{ program: StoredProgram }>(`/days/${dayId}`, {
    method: 'DELETE',
  });
  return program;
}

/** Deletes a week. The server refuses if anything was logged against it. */
export async function removeWeek(programId: number, weekNumber: number): Promise<StoredProgram> {
  const { program } = await callApi<{ program: StoredProgram }>(
    `/programs/${programId}/weeks/${weekNumber}`,
    { method: 'DELETE' },
  );
  return program;
}

/* ------------------------------------------------------------------ */
/* Editing the plan                                                    */
/* ------------------------------------------------------------------ */

export interface ExerciseFields {
  name: string;
  protocol: string | null;
  comments: string | null;
  video: string | null;
}

export async function addExercise(
  dayId: string,
  input: { name: string; protocol?: string | null },
): Promise<StoredProgram> {
  const { program } = await callApi<{ program: StoredProgram }>(
    `/days/${dayId}/exercises`,
    json(input),
  );
  return program;
}

/**
 * Renames an exercise or changes its protocol, note or video.
 *
 * Answers 204: the client already holds the values it just sent, so there is
 * nothing to apply from the response.
 */
export async function updateExercise(exerciseId: string, fields: ExerciseFields): Promise<void> {
  await callApi<void>(`/exercises/${exerciseId}`, { ...json(fields), method: 'PUT' });
}

export async function moveExercise(exerciseId: string, offset: -1 | 1): Promise<StoredProgram> {
  const { program } = await callApi<{ program: StoredProgram }>(
    `/exercises/${exerciseId}/move`,
    json({ offset }),
  );
  return program;
}

export async function removeExercise(exerciseId: string): Promise<StoredProgram> {
  const { program } = await callApi<{ program: StoredProgram }>(`/exercises/${exerciseId}`, {
    method: 'DELETE',
  });
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
  patch: {
    notes?: string;
    completed?: boolean;
    elapsedSeconds?: number;
    timerRunning?: boolean;
  },
): Promise<void> {
  await callApi<void>(`/days/${dayId}/session`, { ...json(patch), method: 'PATCH' });
}

/** What happened today on one exercise. */
export async function saveExerciseNote(
  dayId: string,
  exerciseId: number,
  note: string,
): Promise<void> {
  await callApi<void>(`/days/${dayId}/exercises/${exerciseId}/note`, {
    ...json({ note }),
    method: 'PUT',
  });
}

/** The permanent setup note. Lands on every week of the program. */
export async function saveExerciseSetup(exerciseId: number, note: string): Promise<void> {
  await callApi<void>(`/exercises/${exerciseId}/setup`, { ...json({ note }), method: 'PUT' });
}

export async function resetSession(dayId: string): Promise<void> {
  await callApi<void>(`/days/${dayId}/session`, { method: 'DELETE' });
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export type Role = 'member' | 'admin';

export interface Account {
  id: number;
  email: string;
  role: Role;
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
  best: BestSet | null;
}

export interface ExerciseHistory {
  name: string;
  sessions: number;
  programs: number;
  totalVolume: number;
  best: BestSet | null;
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

export interface Profile {
  identity: {
    email: string;
    displayName: string;
    memberSince: string;
  };
  stats: {
    completedSessions: number;
    startedSessions: number;
    totalVolumeKg: number;
    distinctExercises: number;
    totalSets: number;
    programs: number;
    averageSessionSeconds: number | null;
  };
  records: {
    exercise: string;
    best: BestSet;
    achievedAt: string;
    weeksSince: number;
  }[];
  /** Twelve entries, oldest first, gaps filled with zeroes. */
  weeklyActivity: { weekStart: string; sessions: number; volumeKg: number }[];
  streakWeeks: number;
  volumeByType: { type: string; volumeKg: number; sessions: number }[];
  lastSessionAt: string | null;
}

export interface Lift {
  exercise: string;
  best: BestSet;
  /** Kilos between the first session's best set and the last one's. */
  gainKg: number | null;
  sessions: number;
  lastTrainedAt: string;
  weeksSince: number;
}

/** Every movement ever trained, across every program. */
export async function fetchLifts(): Promise<Lift[]> {
  const { lifts } = await callApi<{ lifts: Lift[] }>('/profile/lifts');
  return lifts;
}

export async function fetchProfile(): Promise<Profile> {
  const { profile } = await callApi<{ profile: Profile }>('/profile');
  return profile;
}

export async function updateProfile(patch: { displayName: string | null }): Promise<void> {
  await callApi<void>('/profile', { ...json(patch), method: 'PATCH' });
}

/* ------------------------------------------------------------------ */
/* Clases                                                              */
/* ------------------------------------------------------------------ */

/** Una clase del horario semanal. */
export interface GymClass {
  id: number;
  name: string;
  coach: string | null;
  /** 1 = lunes … 7 = domingo. */
  weekday: number;
  /** `HH:MM`, hora del gimnasio. */
  startsAt: string;
  durationMinutes: number;
  capacity: number;
}

export type GymClassInput = Omit<GymClass, 'id'>;

/** Una clase en una fecha, con lo que le toca a quien la mira. */
export interface ClassOccurrence extends GymClass {
  date: string;
  startsAtIso: string;
  booked: number;
  waiting: number;
  cancelled: boolean;
  started: boolean;
  mine: 'booked' | 'waiting' | null;
  waitPosition: number | null;
  canCancel: boolean;
  /** Solo llega a quien administra. */
  attendees?: {
    bookingId: number;
    userId: number;
    name: string;
    waiting: boolean;
    /** Si vino; `null` sin marcar. */
    attended: boolean | null;
  }[];
}

export interface ClassesWeek {
  days: { date: string; classes: ClassOccurrence[] }[];
  isAdmin: boolean;
  bookingDays: number;
  cancelDeadlineMinutes: number;
  /** Hasta cuántos días adelante mira quien administra. */
  adminDaysAhead: number;
  /** Hasta qué día tiene pagada la cuota quien mira; `null` sin control. */
  paidUntil: string | null;
  /** Solo llega a quien administra. */
  schedule?: GymClass[];
}

/** La semana que empieza hoy o, para quien administra, en `from`. */
export async function fetchClasses(from?: string): Promise<ClassesWeek> {
  return callApi<ClassesWeek>(from ? `/classes?from=${from}` : '/classes');
}

/** Quien administra apunta a un socio. */
export async function addClassAttendee(
  classId: number,
  date: string,
  userId: number,
): Promise<{ status: 'booked' | 'waiting'; waitPosition: number | null }> {
  return callApi(`/classes/${classId}/attendees`, json({ date, userId }));
}

/** Anula (o recupera) todas las clases de una fecha. */
export async function setDayCancelled(
  date: string,
  cancelled: boolean,
): Promise<{ cancelled?: number; notified?: number; restored?: number }> {
  return callApi(`/classes/days/${date}/cancellation`, { method: cancelled ? 'PUT' : 'DELETE' });
}

export async function bookClass(
  classId: number,
  date: string,
): Promise<{ status: 'booked' | 'waiting'; waitPosition: number | null }> {
  return callApi(`/classes/${classId}/bookings`, json({ date }));
}

export async function cancelClassBooking(classId: number, date: string): Promise<void> {
  await callApi<void>(`/classes/${classId}/bookings/${date}`, { method: 'DELETE' });
}

export async function createGymClass(input: GymClassInput): Promise<void> {
  await callApi('/classes/schedule', json(input));
}

export async function updateGymClass(classId: number, input: GymClassInput): Promise<void> {
  await callApi(`/classes/schedule/${classId}`, { ...json(input), method: 'PUT' });
}

export async function deleteGymClass(classId: number): Promise<void> {
  await callApi<void>(`/classes/schedule/${classId}`, { method: 'DELETE' });
}

/** Anula (o, con `cancelled: false`, recupera) la clase de una fecha. */
export async function setClassCancelled(
  classId: number,
  date: string,
  cancelled: boolean,
): Promise<void> {
  await callApi<void>(`/classes/${classId}/cancellations/${date}`, {
    method: cancelled ? 'PUT' : 'DELETE',
  });
}

export async function removeClassBooking(bookingId: number): Promise<void> {
  await callApi<void>(`/classes/bookings/${bookingId}`, { method: 'DELETE' });
}

/* ------------------------------------------------------------------ */
/* Socios (solo administración)                                        */
/* ------------------------------------------------------------------ */

export interface MemberSummary {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  /** Propietario: administrador siempre. */
  owner: boolean;
  memberSince: string;
  lastTrainedAt: string | null;
  programCount: number;
  currentProgram: string | null;
  paidUntil: string | null;
  attended30: number;
  missed30: number;
}

export async function fetchMembers(): Promise<MemberSummary[]> {
  const { members } = await callApi<{ members: MemberSummary[] }>('/admin/members');
  return members;
}

export async function fetchMember(
  userId: number,
): Promise<{ member: MemberSummary; programs: ProgramSummary[] }> {
  return callApi(`/admin/members/${userId}`);
}

export async function setMemberRole(userId: number, role: Role): Promise<MemberSummary> {
  const { member } = await callApi<{ member: MemberSummary }>(`/admin/members/${userId}`, {
    ...json({ role }),
    method: 'PATCH',
  });
  return member;
}

/** Sube un Excel como plan de otro socio. */
export async function uploadMemberProgram(
  userId: number,
  file: File,
): Promise<{ programId: number; name: string; created: boolean }> {
  const bytes = await file.arrayBuffer();
  return callApi(`/admin/members/${userId}/programs?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
  });
}

export async function deleteMemberProgram(userId: number, programId: number): Promise<void> {
  await callApi<void>(`/admin/members/${userId}/programs/${programId}`, { method: 'DELETE' });
}

/** Enlace de descarga: lo abre el navegador, como la exportación propia. */
export function memberProgramExportUrl(userId: number, programId: number): string {
  return `${BASE}/admin/members/${userId}/programs/${programId}/export`;
}

export async function setMemberPaidUntil(userId: number, paidUntil: string | null): Promise<MemberSummary> {
  const { member } = await callApi<{ member: MemberSummary }>(`/admin/members/${userId}/paid-until`, {
    ...json({ paidUntil }),
    method: 'PUT',
  });
  return member;
}

/** Pasar lista: vino (`true`), no vino (`false`) o sin marcar (`null`). */
export async function setAttendance(bookingId: number, attended: boolean | null): Promise<void> {
  await callApi<void>(`/classes/bookings/${bookingId}/attendance`, {
    ...json({ attended }),
    method: 'PUT',
  });
}

export interface ClassHistoryItem {
  date: string;
  startsAt: string;
  name: string;
  attended: boolean | null;
}

export async function fetchClassHistory(): Promise<ClassHistoryItem[]> {
  const { history } = await callApi<{ history: ClassHistoryItem[] }>('/classes/history');
  return history;
}

/* ------------------------------------------------------------------ */
/* Avisos                                                              */
/* ------------------------------------------------------------------ */

export interface Announcement {
  id: number;
  message: string;
  createdAt: string;
}

export async function fetchAnnouncements(): Promise<Announcement[]> {
  const { announcements } = await callApi<{ announcements: Announcement[] }>('/announcements');
  return announcements;
}

export async function createAnnouncement(message: string): Promise<void> {
  await callApi('/announcements', json({ message }));
}

export async function deleteAnnouncement(id: number): Promise<void> {
  await callApi<void>(`/announcements/${id}`, { method: 'DELETE' });
}

/** Darse de baja. Borra la cuenta y todo lo suyo. */
export async function deleteAccount(password: string): Promise<void> {
  await callApi<void>('/auth/account', { ...json({ password }), method: 'DELETE' });
}
