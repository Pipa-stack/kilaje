/**
 * End-to-end through the React app, driven by the REAL workbook.
 *
 * This is the acceptance test for the whole product claim: import an Excel,
 * train, reload, keep everything, import another one.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '../src/ui/App';
import { loadProgram } from '../src/storage/storage';

const REFERENCE_FILE = resolve(process.cwd(), 'Ejemplo/ejemplo.xlsx');

function referenceFile(name = 'ejemplo.xlsx'): File {
  const bytes = readFileSync(REFERENCE_FILE);
  return new File([bytes], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** jsdom has no File.arrayBuffer in some versions; make sure it is there. */
function ensureArrayBuffer(file: File): File {
  if (typeof file.arrayBuffer !== 'function') {
    const bytes = readFileSync(REFERENCE_FILE);
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
  }
  return file;
}

async function importReference(user: ReturnType<typeof userEvent.setup>, name?: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  await user.upload(input!, ensureArrayBuffer(referenceFile(name)));
}

describe('the full training flow', () => {
  it('imports, trains, persists, reloads and re-imports', async () => {
    const user = userEvent.setup();
    const app = render(<App />);

    // --- Import ---------------------------------------------------------
    expect(screen.getByRole('heading', { name: 'Gimnasio' })).toBeInTheDocument();
    await importReference(user);

    await screen.findByRole('heading', { name: /Día 1/ });
    expect(screen.getByRole('heading', { name: /Día 1\s*PUSH/ })).toBeInTheDocument();

    // Exercise names come from the file, not from any hardcoded list.
    expect(
      screen.getByRole('heading', { name: 'PRESS DE BANCA PLANO CON BARRA LIBRE' }),
    ).toBeInTheDocument();
    expect(screen.getByText('3 SETS X 4-6 / 6-8 / 8-10 REPS (RIR 0)')).toBeInTheDocument();

    // --- The value seeded in the workbook is already there ---------------
    const seededWeight = screen.getByLabelText(
      /Peso de la serie 1 de PRESS DE BANCA PLANO CON BARRA LIBRE/,
    );
    expect(seededWeight).toHaveValue('82.5');

    // --- Train ----------------------------------------------------------
    const secondWeight = screen.getByLabelText(
      /Peso de la serie 2 de PRESS DE BANCA PLANO CON BARRA LIBRE/,
    );
    const secondReps = screen.getByLabelText(
      /Repeticiones de la serie 2 de PRESS DE BANCA PLANO CON BARRA LIBRE/,
    );
    const secondRir = screen.getByLabelText(
      /RIR de la serie 2 de PRESS DE BANCA PLANO CON BARRA LIBRE/,
    );

    await user.type(secondWeight, '80');
    await user.type(secondReps, '8');
    await user.type(secondRir, '1');

    // --- Calculations update live ---------------------------------------
    const card = seededWeight.closest('article');
    expect(card).not.toBeNull();
    // 82.5 x 4 = 330, plus 80 x 8 = 640 -> 970
    expect(within(card!).getByText('970 kg')).toBeInTheDocument();
    // Epley on set 1: 82.5 x (1 + 4/30) = 93.5
    expect(within(card!).getByText('93.5 kg')).toBeInTheDocument();

    // --- Notes and completion -------------------------------------------
    await user.type(screen.getByLabelText('Notas de la sesión'), 'buenas sensaciones');
    await user.click(screen.getByRole('button', { name: 'Completar sesión' }));
    expect(screen.getByText('Completada')).toBeInTheDocument();

    // --- Persisted -------------------------------------------------------
    await waitFor(() => {
      const stored = loadProgram();
      expect(stored?.weeks[0]?.days[0]?.exercises[0]?.currentWeek[1]).toEqual({
        weight: 80,
        reps: 8,
        rir: 1,
      });
    });

    // --- Reload ----------------------------------------------------------
    app.unmount();
    render(<App />);

    await screen.findByRole('heading', { name: /Día 1/ });
    expect(
      screen.getByLabelText(/Peso de la serie 2 de PRESS DE BANCA PLANO CON BARRA LIBRE/),
    ).toHaveValue('80');
    expect(screen.getByLabelText('Notas de la sesión')).toHaveValue('buenas sensaciones');
    expect(screen.getByText('Completada')).toBeInTheDocument();

    // --- Re-import the same template -------------------------------------
    await user.click(screen.getByRole('button', { name: 'Importar' }));
    await importReference(user, 'otro-mesociclo.xlsx');

    await screen.findByText('otro-mesociclo.xlsx');
    // Structure regenerated, logged data preserved.
    expect(
      screen.getByLabelText(/Peso de la serie 2 de PRESS DE BANCA PLANO CON BARRA LIBRE/),
    ).toHaveValue('80');
    expect(screen.getByLabelText('Notas de la sesión')).toHaveValue('buenas sensaciones');
  }, 30_000);

  it('navigates between days', async () => {
    const user = userEvent.setup();
    render(<App />);
    await importReference(user);
    await screen.findByRole('heading', { name: /Día 1/ });

    await user.click(screen.getByRole('button', { name: 'Día siguiente →' }));
    expect(await screen.findByRole('heading', { name: /Día 2\s*PULL/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '← Día anterior' }));
    expect(await screen.findByRole('heading', { name: /Día 1\s*PUSH/ })).toBeInTheDocument();

    // Jump straight to a day from the day list.
    await user.click(screen.getByRole('button', { name: /^Día 4$/ }));
    expect(await screen.findByRole('heading', { name: /Día 4\s*UPPER/ })).toBeInTheDocument();
  }, 30_000);

  it('adds and clears sets beyond the template', async () => {
    const user = userEvent.setup();
    render(<App />);
    await importReference(user);
    await screen.findByRole('heading', { name: /Día 1/ });

    const weightLabel = /Peso de la serie 5 de PRESS DE BANCA PLANO CON BARRA LIBRE/;
    expect(screen.queryByLabelText(weightLabel)).toBeNull();

    const card = screen
      .getByRole('heading', { name: 'PRESS DE BANCA PLANO CON BARRA LIBRE' })
      .closest('article');
    await user.click(within(card!).getByRole('button', { name: '+ Añadir serie' }));

    // The new set inherits the weight of the last logged one.
    expect(screen.getByLabelText(weightLabel)).toHaveValue('82.5');

    await user.click(within(card!).getByRole('button', { name: /Eliminar serie 5/ }));
    expect(screen.queryByLabelText(weightLabel)).toBeNull();
  }, 30_000);

  it('rejects a dropped file that is not a workbook', async () => {
    render(<App />);

    // The file picker filters by `accept`, but a drag-and-drop does not — this
    // is the path a wrong file actually arrives through.
    const dropzone = document.querySelector<HTMLLabelElement>('label[for]')!;
    const bogus = new File(['no soy un excel'], 'notas.txt', { type: 'text/plain' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [bogus] } });

    expect(await screen.findByText(/Sube un archivo \.xlsx/)).toBeInTheDocument();
    // And the app stays on the import screen.
    expect(screen.getByRole('heading', { name: 'Gimnasio' })).toBeInTheDocument();
  });

  it('rejects a dropped .xlsx that is not the training template', async () => {
    render(<App />);

    const dropzone = document.querySelector<HTMLLabelElement>('label[for]')!;
    const notATemplate = new File(['contenido cualquiera'], 'presupuesto.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    Object.defineProperty(notATemplate, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('contenido cualquiera').buffer,
    });
    fireEvent.drop(dropzone, { dataTransfer: { files: [notATemplate] } });

    // SheetJS is lenient about what it will open, so the rejection may come
    // from the read itself or from finding no "Semana N" sheet inside.
    expect(
      await screen.findByText(/No se ha podido leer el archivo|Semana N/),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Gimnasio' })).toBeInTheDocument();
  });
});
