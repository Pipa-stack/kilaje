import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './ui/App';
import './index.css';

/**
 * Registers the service worker, which is what lets the app open at all in a
 * gym with no signal. Everything else about being offline — the cached
 * program, the outbox — was already here and unreachable without it.
 *
 * Production only: in development it would sit in front of Vite's HMR, and in
 * jsdom there is no `serviceWorker` to register with.
 */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  // After load: registering during startup competes with the very requests
  // that put the first screen on the phone.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      // Not fatal. The app works online exactly as before; it just will not
      // open without a connection, which is what it did until now anyway.
      console.warn('[kilaje] no se ha podido registrar el service worker', error);
    });
  });
}

registerServiceWorker();

const container = document.getElementById('root');
if (!container) throw new Error('No se ha encontrado el contenedor #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
