import { afterEach } from 'vitest';

// Server-side suites run in the `node` environment, where there is no DOM to
// set up or tear down. Only load the browser helpers when one exists.
const hasDom = typeof document !== 'undefined';

if (hasDom) {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });
}
