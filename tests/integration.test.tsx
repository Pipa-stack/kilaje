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
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' && input.startsWith('/') ? `${API_ORIGIN}${input}` : input;
    return realFetch(url as RequestInfo, init);
  }) as typeof fetch;
}
installFetch();

beforeEach(async () => {
  await realFetch(`${API_ORIGIN}/__test__/reset`, { method: 'POST' });
  installFetch();
  localStorage.clear();
});

/** Reads the stored program straight from the API. */
async function latestProgram(): Promise<Program | null> {
  const response = await realFetch(`${API_ORIGIN}/api/programs/latest`);
  if (!response.ok) return null;
  const { program } = (await response.json()) as { program: Program };
  return program;
}

async function allPrograms(): Promise<{ id: number; name: string }[]> {
  const response = await realFetch(`${API_ORIGIN}/api/programs`);
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

    // --- Import ---------------------------------------------------------
    expect(await screen.findByRole('heading', { name: 'Gimnasio' }, WAIT)).toBeInTheDocument();
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
        name: /Ajustes/,
      }),
    );
    await importFile(user, referenceFile('mesociclo-2.xlsx', 1));

    await waitFor(async () => {
      expect(await allPrograms()).toHaveLength(2);
    }, WAIT);

    const [newest, previous] = await allPrograms();
    expect(newest?.name).toContain('mesociclo-2');

    // The first program kept everything that was logged against it.
    const oldResponse = await realFetch(`${API_ORIGIN}/api/programs/${previous!.id}`);
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
    await importFile(user, referenceFile());
    await openDay(user, 1);

    await user.click(screen.getByRole('button', { name: /Día siguiente/ }));
    expect(await screen.findByRole('heading', { name: /Día 2\s*PULL/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Día anterior/ }));
    expect(await screen.findByRole('heading', { name: /Día 1\s*PUSH/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Día 4$/ }));
    expect(await screen.findByRole('heading', { name: /Día 4\s*UPPER/ })).toBeInTheDocument();
  }, 90_000);

  it('adds a set beyond the template and persists it', async () => {
    const user = userEvent.setup();
    render(<App />);
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
    render(<App />);
    await screen.findByRole('heading', { name: 'Gimnasio' }, WAIT);

    const dropzone = document.querySelector<HTMLLabelElement>('label[for]')!;
    const bogus = new File(['no soy un excel'], 'notas.txt', { type: 'text/plain' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [bogus] } });

    expect(await screen.findByText(/Sube un archivo \.xlsx/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Gimnasio' })).toBeInTheDocument();
  }, 30_000);

  it("surfaces the server's rejection of a non-template .xlsx", async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Gimnasio' }, WAIT);

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
  it('moves between Inicio, Entrenar, Progreso y Ajustes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await importFile(user, referenceFile());
    await screen.findByRole('heading', { name: /Semana 1/ }, WAIT);

    const tabs = within(screen.getByRole('navigation', { name: 'Secciones' }));

    // The workbook already carried one logged set, so progress has content.
    await user.click(tabs.getByRole('button', { name: /Progreso/ }));
    expect(await screen.findByRole('heading', { name: 'Volumen por sesión' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ejercicios entrenados' })).toBeInTheDocument();

    await user.click(tabs.getByRole('button', { name: /Ajustes/ }));
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
    await importFile(user, referenceFile());
    await openDay(user, 1);

    expect(screen.getByRole('heading', { name: 'Descanso' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '1:30' }));
    expect(await screen.findByRole('timer')).toHaveTextContent(/1:2\d|1:30/);

    await user.click(screen.getByRole('button', { name: 'Parar' }));
    expect(screen.queryByRole('timer')).toBeNull();
  }, 90_000);

  it('deletes a program and its history from Ajustes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await importFile(user, referenceFile());
    await screen.findByRole('heading', { name: /Semana 1/ }, WAIT);

    // A second program, so deletion is allowed.
    const tabs = within(screen.getByRole('navigation', { name: 'Secciones' }));
    await user.click(tabs.getByRole('button', { name: /Ajustes/ }));
    await importFile(user, referenceFile('mesociclo-2.xlsx', 1));

    await waitFor(async () => expect(await allPrograms()).toHaveLength(2), WAIT);

    await user.click(tabs.getByRole('button', { name: /Ajustes/ }));
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

describe('offline behaviour', () => {
  it('falls back to the cached program when the API is unreachable', async () => {
    const user = userEvent.setup();
    const app = render(<App />);
    await importFile(user, referenceFile());
    await screen.findByRole('heading', { name: /Semana 1/ }, WAIT);

    await waitFor(() => expect(localStorage.getItem('gimnasio.program.v1')).not.toBeNull(), WAIT);
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
});
