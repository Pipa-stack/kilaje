// @vitest-environment node
/**
 * The alarm on a 500.
 *
 * What matters here is not that a message goes out — it is that the channel
 * survives being used: a crash loop must not send four hundred emails, a dead
 * mail provider must not take the request down with it, and nothing about the
 * person training may travel to a third party.
 */

import { describe, expect, it, vi } from 'vitest';

import { ALERT_WINDOW_MS, createAlerter } from '../server/email/alerts';
import type { Email, EmailSender } from '../server/email/sender';

function recorder(): EmailSender & { sent: Email[] } {
  const sent: Email[] = [];
  return {
    sent,
    configured: true,
    async send(email) {
      sent.push(email);
      return true;
    },
  };
}

describe('the alerter', () => {
  it('sends the first failure', () => {
    const email = recorder();
    createAlerter(email, 'yo@ejemplo.com', () => 1_000).report({
      method: 'POST',
      path: '/api/days/1/sets',
      error: new Error('boom'),
    });

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.to).toBe('yo@ejemplo.com');
    expect(email.sent[0]?.subject).toContain('POST /api/days/1/sets');
    expect(email.sent[0]?.text).toContain('boom');
  });

  it('sends one message for a crash loop, not one per crash', () => {
    const email = recorder();
    let now = 0;
    const alerter = createAlerter(email, 'yo@ejemplo.com', () => now);

    for (let i = 0; i < 400; i += 1) {
      now += 100;
      alerter.report({ method: 'GET', path: '/api/programs', error: new Error('boom') });
    }

    expect(email.sent).toHaveLength(1);
  });

  it('carries the count of what it swallowed into the next message', () => {
    const email = recorder();
    let now = 0;
    const alerter = createAlerter(email, 'yo@ejemplo.com', () => now);

    alerter.report({ method: 'GET', path: '/api/x', error: new Error('uno') });
    alerter.report({ method: 'GET', path: '/api/x', error: new Error('dos') });
    alerter.report({ method: 'GET', path: '/api/x', error: new Error('tres') });

    now += ALERT_WINDOW_MS + 1;
    alerter.report({ method: 'GET', path: '/api/x', error: new Error('cuatro') });

    expect(email.sent).toHaveLength(2);
    // A burst stays visible even though it did not ring four times.
    expect(email.sent[1]?.text).toContain('2 errores más');
  });

  it('speaks again once the window has passed', () => {
    const email = recorder();
    let now = 0;
    const alerter = createAlerter(email, 'yo@ejemplo.com', () => now);

    alerter.report({ method: 'GET', path: '/api/x', error: new Error('uno') });
    now += ALERT_WINDOW_MS + 1;
    alerter.report({ method: 'GET', path: '/api/x', error: new Error('dos') });

    expect(email.sent).toHaveLength(2);
  });

  it('does not throw when the mail provider is broken', () => {
    const broken: EmailSender = {
      configured: true,
      send: () => Promise.reject(new Error('proveedor caído')),
    };

    expect(() =>
      createAlerter(broken, 'yo@ejemplo.com').report({
        method: 'GET',
        path: '/api/x',
        error: new Error('boom'),
      }),
    ).not.toThrow();
  });

  it('truncates a stack instead of mailing the whole thing', () => {
    const email = recorder();
    const huge = new Error('boom');
    huge.stack = `Error: boom\n${'    at algo (fichero.ts:1:1)\n'.repeat(500)}`;

    createAlerter(email, 'yo@ejemplo.com').report({
      method: 'GET',
      path: '/api/x',
      error: huge,
    });

    expect(email.sent[0]?.text.length).toBeLessThan(2_500);
  });

  it('escapes the error into the HTML part', () => {
    const email = recorder();
    createAlerter(email, 'yo@ejemplo.com').report({
      method: 'GET',
      path: '/api/x',
      error: new Error('<script>alert(1)</script>'),
    });

    expect(email.sent[0]?.html).not.toContain('<script>');
    expect(email.sent[0]?.html).toContain('&lt;script&gt;');
  });

  it('reports something that is not an Error at all', () => {
    const email = recorder();
    createAlerter(email, 'yo@ejemplo.com').report({
      method: 'GET',
      path: '/api/x',
      error: 'un string suelto',
    });

    expect(email.sent[0]?.text).toContain('un string suelto');
  });
});

describe('a server with nothing configured', () => {
  it('stays silent rather than pretending to watch', async () => {
    const { SILENT_ALERTER } = await import('../server/email/alerts');
    const spy = vi.fn();
    expect(() => SILENT_ALERTER.report({ method: 'GET', path: '/', error: new Error('x') })).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
