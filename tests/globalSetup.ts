/**
 * Starts a real API server for the browser-side integration tests.
 *
 * Vitest runs global setup in Node, which is where PGlite (PostgreSQL in
 * WASM) can load; the test files themselves run in jsdom, which cannot. The
 * jsdom suite therefore talks to this server over real HTTP, exercising the
 * whole stack instead of a mocked `fetch`.
 */

import type { AddressInfo } from 'node:net';

import express from 'express';
import type { TestProject } from 'vitest/node';

import { createApp } from '../server/app';
import { createTestDatabase } from './helpers/testDatabase';

declare module 'vitest' {
  interface ProvidedContext {
    apiOrigin: string;
  }
}

export default async function setup(project: TestProject) {
  const db = await createTestDatabase();
  const app = createApp({ db });

  // Test-only hook so each test can start from an empty database. It is added
  // here, in the harness, and never exists in the production application.
  app.post('/__test__/reset', express.json(), (_req, res) => {
    db.truncate()
      .then(() => res.status(204).end())
      .catch((error: unknown) => res.status(500).json({ error: String(error) }));
  });

  const server = app.listen(0);
  await new Promise((done) => server.once('listening', done));
  const { port } = server.address() as AddressInfo;

  project.provide('apiOrigin', `http://127.0.0.1:${port}`);

  return async () => {
    await new Promise((done) => server.close(done));
    await db.close();
  };
}
