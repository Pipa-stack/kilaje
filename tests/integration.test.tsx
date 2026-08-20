/**
 * End-to-end through the React app against a REAL backend over real HTTP.
 *
 * The server (Express + PGlite, i.e. actual PostgreSQL) is started in
 * `globalSetup.ts`. Nothing is mocked: the component, the API client, HTTP,
 * validation and SQL all run, driven by the real workbook.
 *
 * Assertions go through the public API rather than raw SQL — `api.test.ts`
 * already covers the schema, and asserting through the interface is what
 * proves the app and the database actually agree.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '../src/ui/App';
import type { Program } from '../src/domain/types';

const REFERENCE_FILE = resolve(process.cwd(), 'Ejemplo/ejemplo.xlsx');
const API_ORIGIN = inject('apiOrigin');

// The app calls same-origin paths ("/api/..."); jsdom serves nothing, so
// relative requests are pointed at the test server.
const realFetch = globalThis.fetch;
function installFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' && input.startsWith('/') ? `${API_ORIGIN}${input}` : input;
    const headers = new Headers(init?.headers);
    if (sessionCookie) headers.set('Cookie', sessionCookie);

    const response = await realFetch(url as RequestInfo, { ...init, headers });

    const setCookie = response.headers.get('set-cookie');
    const token = setCookie ? /kilaje_session=([^;]*)/.exec(setCookie)?.[1] : undefined;
    if (token) sessionCookie = token === '' ? '' : `kilaje_session=${token}`;

    return response;
  }) as typeof fetch;
}
installFetch();

/** Cookies are per-origin in jsdom; the session rides along automatically. */
let sessionCookie = '';

beforeEach(async () => {
  await realFetch(`${API_ORIGIN}/__test__/reset`, { method: 'POST' });
  sessionCookie = '';
  installFetch();
  localStorage.clear();
});

/**
 * Creates the account the app needs before anything else is reachable.
 *
 * jsdom does not manage cookies across fetch, so the session cookie is
 * captured here and replayed on every later request by `installFetch`.
 */
async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Kilaje' }, WAIT);
  // The screen opens on "Entrar"; switch it to registration.
  await user.click(screen.getByRole('button', { name: 'Crear una cuenta' }));
  await user.type(screen.getByLabelText('Correo'), 'test@ejemplo.com');
  await user.type(screen.getByLabelText('Contraseña'), 'contrasena-de-prueba');
  await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
  await waitFor(() => expect(sessionCookie).not.toBe(''), WAIT);
}

/** Same-origin call carrying the session cookie. */
function apiFetch(path: string, init?: RequestInit) {
  return realFetch(`${API_ORIGIN}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(sessionCookie ? { Cookie: sessionCookie } : {}) },
  });
}

/** Reads the stored program straight from the API. */
async function latestProgram(): Promise<Program | null> {
  const response = await apiFetch(`/api/programs/latest`);
  if (!response.ok) return null;
  const { program } = (await response.json()) as { program: Program };
  return program;
}

async function allPrograms(): Promise<{ id: number; name: string }[]> {
  const response = await apiFetch(`/api/programs`);
  const { programs } = (await response.json()) as { programs: { id: number; name: string }[] };
  return programs;
}

function referenceFile(name = 'ejemplo.xlsx', extra = 0): File {
  const bytes = readFileSync(REFERENCE_FILE);
  const payload = extra > 0 ? Buffer.concat([bytes, Buffer.alloc(extra)]) : bytes;
  const file = new File([payload], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  // jsdom's File does not always implement arrayBuffer.
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () =>
        payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
    });
  }
  return file;
}

async function importFile(user: ReturnType<typeof userEvent.setup>, file: File) {
  // The app shows a loading state first; the file input only exists after it.
  const input = await waitFor(() => {
    const found = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(found).not.toBeNull();
    return found!;
  }, WAIT);
  await user.upload(input, file);
}

const BENCH = 'PRESS DE BANCA PLANO CON BARRA LIBRE';
const WAIT = { timeout: 20_000 };

/**
 * The app opens on the home screen; a session is one tap away. Tests go
 * through that tap rather than assuming a day is already open.
 */
async function openDay(user: ReturnType<typeof userEvent.setup>, dayNumber = 1) {
  const [cta] = await screen.findAllByRole(
    'button',
    { name: new RegExp(`Día ${dayNumber}\\b`) },
    WAIT,
  );
  await user.click(cta!);
  return screen.findByRole('heading', { name: new RegExp(`Día ${dayNumber}\\b`) }, WAIT);
}

describe('the full training flow, persisted in PostgreSQL', () => {
  it('imports, trains, saves, reloads from the database and re-imports', async () => {
    const user = userEvent.setup();
    const app = render(<App />);

    // --- Account, then import -------------------------------------------
    await signIn(user);
    await importFile(user, referenceFile());

    // Lands on the home screen: the week summary and the sessions.
    await screen.findByRole('heading', { name: /Semana 1/ }, WAIT);
    expect(screen.getByText(/0 de 5 sesiones completadas/)).toBeInTheDocument();

    await openDay(user, 1);
    expect(screen.getByRole('heading', { name: BENCH })).toBeInTheDocument();
    expect(screen.getByText('3 SETS X 4-6 / 6-8 / 8-10 REPS (RIR 0)')).toBeInTheDocument();

    // The value recorded inside the workbook came back through the database.
    const seeded = screen.getByLabelText(new RegExp(`Peso de la serie 1 de ${BENCH}`));
    expect(seeded).toHaveValue('82.5');

    // --- Train ----------------------------------------------------------
    await user.type(screen.getByLabelText(new RegExp(`Peso de la serie 2 de ${BENCH}`)), '80');
    await user.type(
      screen.getByLabelText(new RegExp(`Repeticiones de la serie 2 de ${BENCH}`)),
      '8',
    );
    await user.type(screen.getByLabelText(new RegExp(`RIR de la serie 2 de ${BENCH}`)), '1');

    // --- Calculations update live ---------------------------------------
    const card = seeded.closest('article');
    expect(within(card!).getByText('970 kg')).toBeInTheDocument(); // 82.5x4 + 80x8
    expect(within(card!).getByText('93.5 kg')).toBeInTheDocument(); // Epley on set 1

    // --- Notes and completion -------------------------------------------
    await user.type(screen.getByLabelText('Notas de la sesión'), 'buenas sensaciones');
    await user.click(screen.getByRole('button', { name: 'Completar sesión' }));

    // --- It reached the database ----------------------------------------
    await waitFor(async () => {
      const stored = await latestProgram();
      const day = stored?.weeks[0]?.days[0];
      expect(day?.exercises[0]?.currentWeek[1]).toEqual({ weight: 80, reps: 8, rir: 1 });
      expect(day?.notes).toBe('buenas sensaciones');
      expect(day?.completed).toBe(true);
    }, WAIT);

    // --- Reload with an empty cache: data comes from PostgreSQL ----------
    app.unmount();
    localStorage.clear();
    render(<App />);

    await openDay(user, 1);
    expect(screen.getByLabelText(new RegExp(`Peso de la serie 2 de ${BENCH}`))).toHaveValue('80');
    expect(screen.getByLabelText('Notas de la sesión')).toHaveValue('buenas sensaciones');
    expect(screen.getByText('Completada')).toBeInTheDocument();

    // --- Re-import: a new program, old history preserved -----------------
    await user.click(
      within(screen.getByRole('navigation', { name: 'Secciones' })).getByRole('button', {
        name: /Perfil/,
      }),
    );
    await importFile(user, referenceFile('mesociclo-2.xlsx', 1));

    await waitFor(async () => {
      expect(await allPrograms()).toHaveLength(2);
    }, WAIT);

    const [newest, previous] = await allPrograms();
    expect(newest?.name).toContain('mesociclo-2');

    // The first program kept everything that was logged against it.
    const oldResponse = await apiFetch(`/api/programs/${previous!.id}`);
    const { program: old } = (await oldResponse.json()) as { program: Program };
    expect(old.weeks[0]?.days[0]?.notes).toBe('buenas sensaciones');
    expect(old.weeks[0]?.days[0]?.completed).toBe(true);
    expect(old.weeks[0]?.days[0]?.exercises[0]?.currentWeek[1]).toEqual({
      weight: 80,
      reps: 8,
      rir: 1,
    });

    // And the new one starts clean.
    const fresh = await latestProgram();
    expect(fresh?.weeks[0]?.days[0]?.notes).toBe('');
    expect(fresh?.weeks[0]?.days[0]?.completed).toBe(false);
  }, 90_000);

  it('navigates between days', async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await importFile(user, referenceFile());
    await openDay(user, 1);

    await user.click(screen.getByRole('button', { name: /Día siguiente/ }));
    expect(await screen.findByRole('heading', { name: /Día 2\s*PULL/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Día anterior/ }));
    expect(await screen.findByRole('heading', { name: /Día 1\s*PUSH/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Día 4$/ }));
    expect(await screen.findByRole('heading', { name: /Día 4\s*UPPER/ })).toBeInTheDocument();
  }, 90_000);

  /**
   * Opens the week panel, which is collapsed until asked for.
   *
   * Idempotent: the trigger is a toggle, and a second click on an already open
   * panel would close it again.
   */
  async function openWeekPanel(user: ReturnType<typeof userEvent.setup>) {
    const toggle = await screen.findByRole('button', { name: 'Gestionar semanas' }, WAIT);
    if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle);
  }

  it('starts the next week from inside the app, with the weights to fill in again', async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await importFile(user, referenceFile());

    // The workbook carries a single week; the plan must not end there.
    await screen.findByRole('heading', { name: /Semana 1/ }, WAIT);
    await openWeekPanel(user);
    await user.click(screen.getByRole('button', { name: /Empezar la semana 2 en blanco/ }));

    await screen.findByRole('heading', { name: /Semana 2/ }, WAIT);
    await openDay(user, 1);

    // Same session, blank sheet: the weight the workbook had seeded is gone.
    const weight = screen.getByLabelText(new RegExp(`Peso de la serie 1 de ${BENCH}`));
    expect(weight).toHaveValue('');
    expect(screen.getByRole('heading', { name: BENCH })).toBeInTheDocument();

    // What was done in week 1 is now the reference to beat.
    const card = weight.closest('article');
    await user.click(within(card!).getByRole('button', { name: 'Ver semana anterior' }));
    expect(within(card!).getByText('82.5 kg')).toBeInTheDocument();

    const stored = await latestProgram();
    expect(stored?.weeks.map((week) => week.number)).toEqual([1, 2]);
    expect(stored?.weeks[0]?.days[0]?.exercises[0]?.currentWeek[0]?.weight).toBe(82.5);
  }, 90_000);

  it('can start the week with last week\u2019s weights already in the boxes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await importFile(user, referenceFile());

    await screen.findByRole('heading', { name: /Semana 1/ }, WAIT);
    await openWeekPanel(user);
    await user.click(screen.getByRole('button', { name: /con los pesos de la 1/ }));

    await screen.findByRole('heading', { name: /Semana 2/ }, WAIT);
    await openDay(user, 1);

    // The weight is there to adjust; the reps are not, so nothing counts as
    // trained until the person says what they did.
    expect(screen.getByLabelText(new RegExp(`Peso de la serie 1 de ${BENCH}`))).toHaveValue('82.5');
    expect(screen.getByLabelText(new RegExp(`Repeticiones de la serie 1 de ${BENCH}`))).toHaveValue('');

    const card = screen.getByRole('heading', { name: BENCH }).closest('article');
    expect(within(card!).getByText('Volumen').nextSibling).toHaveTextContent('—');
  }, 90_000);

  it('deletes a week nobody trained, and refuses one that was', async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await importFile(user, referenceFile());

    await screen.findByRole('heading', { name: /Semana 1/ }, WAIT);
    await openWeekPanel(user);
    await user.click(screen.getByRole('button', { name: /Empezar la semana 2 en blanco/ }));
    await screen.findByRole('heading', { name: /Semana 2/ }, WAIT);

    // An empty week goes without argument.
    const confirmed = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openWeekPanel(user);
    await user.click(screen.getByRole('button', { name: 'Borrar la semana 2' }));

    await waitFor(async () => {
      const stored = await latestProgram();
      expect(stored?.weeks).toHaveLength(1);
    }, WAIT);

    // Now train week 2 and try again: the session must survive the tap.
    await openWeekPanel(user);
    await user.click(screen.getByRole('button', { name: /Empezar la semana 2 en blanco/ }));
    await screen.findByRole('heading', { name: /Semana 2/ }, WAIT);
    await openDay(user, 1);
    // Weight *and* reps: a bare weight is what "copiar los pesos" pre-fills,
    // and that must not be what locks a week in place.
    await user.type(screen.getByLabelText(new RegExp(`Peso de la serie 1 de ${BENCH}`)), '70');
    await user.type(screen.getByLabelText(new RegExp(`Repeticiones de la serie 1 de ${BENCH}`)), '6');

    await waitFor(async () => {
      const stored = await latestProgram();
      expect(stored?.weeks[1]?.days[0]?.exercises[0]?.currentWeek[0]).toMatchObject({
        weight: 70,
        reps: 6,
      });
    }, WAIT);

    await openWeekPanel(user);
    await user.click(screen.getByRole('button', { name: 'Borrar la semana 2' }));

    expect(await screen.findByText(/tiene entrenamiento anotado/i, {}, WAIT)).toBeInTheDocument();
    const stored = await latestProgram();
    expect(stored?.weeks).toHaveLength(2);
    confirmed.mockRestore();
  }, 90_000);

  it('edits the plan of a day: rename, reorder, add and remove', async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await importFile(user, referenceFile());
    await openDay(user, 1);

    const before = await latestProgram();
    const second = before?.weeks[0]?.days[0]?.exercises[1]?.name;

    await user.click(screen.getByRole('button', { name: 'Editar el plan de este día' }));

    // Rename the first exercise. The write goes out on blur, not per letter.
    const name = screen.getByLabelText(/Nombre del ejercicio 1$/);
    await user.clear(name);
    await user.type(name, 'PRESS INCLINADO CON MANCUERNAS');
    await user.tab();

    await waitFor(async () => {
      const stored = await latestProgram();
      expect(stored?.weeks[0]?.days[0]?.exercises[0]?.name).toBe('PRESS INCLINADO CON MANCUERNAS');
    }, WAIT);

    // Reorder: the second exercise moves up.
    await user.click(screen.getByRole('button', { name: `Subir ${second}` }));
    await waitFor(async () => {
      const stored = await latestProgram();
      expect(stored?.weeks[0]?.days[0]?.exercises[0]?.name).toBe(second);
    }, WAIT);

    // Add one that was not in the spreadsheet.
    await user.type(screen.getByLabelText('Nombre del ejercicio nuevo'), 'FACE PULL');
    await user.click(screen.getByRole('button', { name: 'Añadir' }));

    await waitFor(async () => {
      const stored = await latestProgram();
      const names = stored?.weeks[0]?.days[0]?.exercises.map((exercise) => exercise.name);
      expect(names).toContain('FACE PULL');
    }, WAIT);

    // And remove it again — the button inside that exercise's row, not any
    // of the six others.
    const confirmed = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const row = screen.getByDisplayValue('FACE PULL').closest('li');
    await user.click(within(row!).getByRole('button', { name: /Quitar del plan/ }));
    await waitFor(async () => {
      const stored = await latestProgram();
      const names = stored?.weeks[0]?.days[0]?.exercises.map((exercise) => exercise.name);
      // Back to the seven the spreadsheet had, minus nothing: the added one
      // is gone and no imported exercise went with it.
      expect(names).toHaveLength(7);
      expect(names).not.toContain('FACE PULL');
    }, WAIT);
    confirmed.mockRestore();

    // Back to training, with the plan as edited.
    await user.click(screen.getByRole('button', { name: 'Hecho' }));
    expect(screen.getByRole('heading', { name: 'PRESS INCLINADO CON MANCUERNAS' })).toBeInTheDocument();
  }, 90_000);

  it('shows how the block is going, week by week', async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await importFile(user, referenceFile());

    await openWeekPanel(user);
    await user.click(screen.getByRole('button', { name: /Empezar la semana 2 en blanco/ }));
    await screen.findByRole('heading', { name: /Semana 2/ }, WAIT);
    await openDay(user, 1);
    await user.type(screen.getByLabelText(new RegExp(`Peso de la serie 1 de ${BENCH}`)), '90');
    await user.type(screen.getByLabelText(new RegExp(`Repeticiones de la serie 1 de ${BENCH}`)), '5');

    await user.click(
      within(screen.getByRole('navigation', { name: 'Secciones' })).getByRole('button', {
        name: /Progreso/,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Semanas' }));

    // Both weeks are listed, and the exercise carries its top weight per week.
    const block = await screen.findByRole('region', { name: /Volumen por semana/i }, WAIT);
    expect(within(block).getByText('Semana 1')).toBeInTheDocument();
    expect(within(block).getByText('Semana 2')).toBeInTheDocument();

    const trends = screen.getByRole('region', { name: /Cada ejercicio/i });
    expect(within(trends).getByText(BENCH)).toBeInTheDocument();
    expect(within(trends).getByText('90 kg')).toBeInTheDocument();
    expect(within(trends).getByText('82.5 kg')).toBeInTheDocument();
  }, 90_000);

  it('adds a set beyond the template and persists it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await importFile(user, referenceFile());
    await openDay(user, 1);

    const label = new RegExp(`Peso de la serie 5 de ${BENCH}`);
    expect(screen.queryByLabelText(label)).toBeNull();

    const card = screen.getByRole('heading', { name: BENCH }).closest('article');
    await user.click(within(card!).getByRole('button', { name: '+ Añadir serie' }));

    // The new set inherits the last logged weight.
    expect(screen.getByLabelText(label)).toHaveValue('82.5');

    await waitFor(async () => {
      const stored = await latestProgram();
      expect(stored?.weeks[0]?.days[0]?.exercises[0]?.currentWeek).toHaveLength(5);
    }, WAIT);
  }, 90_000);

  it('rejects a dropped file that is not a workbook', async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await screen.findByRole('heading', { name: 'Kilaje' }, WAIT);

    const dropzone = document.querySelector<HTMLLabelElement>('label[for]')!;
    const bogus = new File(['no soy un excel'], 'notas.txt', { type: 'text/plain' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [bogus] } });

    expect(await screen.findByText(/Sube un archivo \.xlsx/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kilaje' })).toBeInTheDocument();
  }, 30_000);

  it("surfaces the server's rejection of a non-template .xlsx", async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await screen.findByRole('heading', { name: 'Kilaje' }, WAIT);

    const dropzone = document.querySelector<HTMLLabelElement>('label[for]')!;
    const notATemplate = new File(['contenido cualquiera'], 'presupuesto.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    Object.defineProperty(notATemplate, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('contenido cualquiera').buffer,
    });
    fireEvent.drop(dropzone, { dataTransfer: { files: [notATemplate] } });

    expect(
      await screen.findByText(/No se ha podido leer el archivo|Semana N/, undefined, WAIT),
    ).toBeInTheDocument();
  }, 30_000);
});

describe('the app shell', () => {
  it('moves between Inicio, Entrenar, Progreso y Perfil', async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await importFile(user, referenceFile());
    await screen.findByRole('heading', { name: /Semana 1/ }, WAIT);

    const tabs = within(screen.getByRole('navigation', { name: 'Secciones' }));

    // The workbook already carried one logged set, so progress has content.
    await user.click(tabs.getByRole('button', { name: /Progreso/ }));
    expect(await screen.findByRole('heading', { name: 'Volumen por sesión' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ejercicios entrenados' })).toBeInTheDocument();

    await user.click(tabs.getByRole('button', { name: /Perfil/ }));
    expect(await screen.findByRole('heading', { name: 'Programas guardados' })).toBeInTheDocument();
    expect(screen.getByText('En uso')).toBeInTheDocument();

    await user.click(tabs.getByRole('button', { name: /Día 1/ }));
    expect(await screen.findByRole('heading', { name: BENCH })).toBeInTheDocument();

    await user.click(tabs.getByRole('button', { name: /Inicio/ }));
    expect(await screen.findByRole('heading', { name: /Semana 1/ })).toBeInTheDocument();
  }, 90_000);

  it('shows real progress once something is logged', async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await importFile(user, referenceFile());
    await openDay(user, 1);

    await user.type(screen.getByLabelText(new RegExp(`Peso de la serie 2 de ${BENCH}`)), '80');
    await user.type(
      screen.getByLabelText(new RegExp(`Repeticiones de la serie 2 de ${BENCH}`)),
      '8',
    );

    const tabs = within(screen.getByRole('navigation', { name: 'Secciones' }));
    await user.click(tabs.getByRole('button', { name: /Progreso/ }));

    expect(await screen.findByRole('heading', { name: 'Ejercicios entrenados' })).toBeInTheDocument();
    // 82.5x4 + 80x8 = 970
    expect(screen.getAllByText('970 kg').length).toBeGreaterThan(0);
    // Appears both in the exercise table and as the best lift of the week.
    expect(screen.getAllByText(BENCH).length).toBeGreaterThan(0);
  }, 90_000);

  it('offers a rest timer on the training tab', async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await importFile(user, referenceFile());
    await openDay(user, 1);

    expect(screen.getByRole('heading', { name: 'Descanso' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '1:30' }));
    expect(await screen.findByRole('timer')).toHaveTextContent(/1:2\d|1:30/);

    await user.click(screen.getByRole('button', { name: 'Parar' }));
    expect(screen.queryByRole('timer')).toBeNull();
  }, 90_000);

  it('deletes a program and its history from Perfil', async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await importFile(user, referenceFile());
    await screen.findByRole('heading', { name: /Semana 1/ }, WAIT);

    // A second program, so deletion is allowed.
    const tabs = within(screen.getByRole('navigation', { name: 'Secciones' }));
    await user.click(tabs.getByRole('button', { name: /Perfil/ }));
    await importFile(user, referenceFile('mesociclo-2.xlsx', 1));

    await waitFor(async () => expect(await allPrograms()).toHaveLength(2), WAIT);

    await user.click(tabs.getByRole('button', { name: /Perfil/ }));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      const [firstDelete] = await screen.findAllByRole('button', { name: 'Borrar' }, WAIT);
      await user.click(firstDelete!);
      await waitFor(async () => expect(await allPrograms()).toHaveLength(1), WAIT);
    } finally {
      confirmSpy.mockRestore();
    }
  }, 90_000);
});

describe('signing out', () => {
  it('wipes the cache and the pending queue from the device', async () => {
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await importFile(user, referenceFile());
    await screen.findByRole('heading', { name: /Semana 1/ }, WAIT);

    // The cache is written as soon as a program is on screen.
    await waitFor(() => expect(localStorage.getItem('kilaje.program.v1')).not.toBeNull(), WAIT);
    localStorage.setItem('kilaje.outbox.v1', JSON.stringify([{ key: 'k', queuedAt: Date.now(), operation: { kind: 'resetSession', dayId: '1' } }]));

    const tabs = within(screen.getByRole('navigation', { name: 'Secciones' }));
    await user.click(tabs.getByRole('button', { name: /Perfil/ }));
    await user.click(await screen.findByRole('button', { name: 'Cerrar sesión' }, WAIT));

    // Back at the login screen, with nothing of the previous account left:
    // the next person on this phone must not see their workout, and their
    // queued writes must not replay under a new session.
    await screen.findByRole('button', { name: 'Entrar' }, WAIT);
    expect(localStorage.getItem('kilaje.program.v1')).toBeNull();
    expect(localStorage.getItem('kilaje.outbox.v1')).toBeNull();
    expect(localStorage.getItem('kilaje.selection.v1')).toBeNull();
  }, 90_000);
});

describe('offline behaviour', () => {
  it('falls back to the cached program when the API is unreachable', async () => {
    const user = userEvent.setup();
    const app = render(<App />);
    await signIn(user);
    await importFile(user, referenceFile());
    await screen.findByRole('heading', { name: /Semana 1/ }, WAIT);

    await waitFor(() => expect(localStorage.getItem('kilaje.program.v1')).not.toBeNull(), WAIT);
    app.unmount();

    const working = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError('network down'))) as typeof fetch;

    try {
      render(<App />);
      await screen.findByRole('heading', { name: /Semana 1/ }, WAIT);
      expect(screen.getByRole('alert')).toHaveTextContent(/Sin conexión/);
      // The cached program is fully usable, not just a banner.
      await openDay(user, 1);
      expect(screen.getByRole('heading', { name: BENCH })).toBeInTheDocument();
    } finally {
      globalThis.fetch = working;
    }
  }, 90_000);

  it('says so when a write made offline is rejected instead of losing it quietly', async () => {
    const user = userEvent.setup();
    const app = render(<App />);
    await signIn(user);
    await importFile(user, referenceFile());
    await openDay(user, 1);
    await waitFor(() => expect(localStorage.getItem('kilaje.program.v1')).not.toBeNull(), WAIT);
    app.unmount();

    // Offline: the set is typed, shown, cached and queued.
    const working = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError('network down'))) as typeof fetch;
    try {
      render(<App />);
      await openDay(user, 1);
      await user.type(screen.getByLabelText(new RegExp(`Peso de la serie 2 de ${BENCH}`)), '85');
      await waitFor(() => {
        expect(JSON.parse(localStorage.getItem('kilaje.outbox.v1') ?? '[]')).toHaveLength(1);
      }, WAIT);
    } finally {
      globalThis.fetch = working;
    }

    // The connection comes back, but the server refuses that write on its
    // merits. Before, the entry was dropped in silence and the person kept
    // believing the set was saved.
    const rejecting = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(typeof input === 'string' ? input : (input as Request).url ?? input);
      if (url.includes('/sets') && init?.method === 'PUT') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Datos inválidos.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return working(input as RequestInfo, init);
    }) as typeof fetch;

    const restore = globalThis.fetch;
    globalThis.fetch = rejecting;
    try {
      render(<App />);
      expect(
        await screen.findByText(/se ha rechazado al enviarlo y no se ha guardado/i, {}, WAIT),
      ).toBeInTheDocument();

      // And it is out of the queue rather than retried forever.
      await waitFor(() => {
        expect(JSON.parse(localStorage.getItem('kilaje.outbox.v1') ?? '[]')).toHaveLength(0);
      }, WAIT);
    } finally {
      globalThis.fetch = restore;
    }
  }, 90_000);
});
