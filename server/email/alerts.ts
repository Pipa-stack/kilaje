/**
 * Telling somebody when the server breaks.
 *
 * Until now a 500 was written to the Railway log and that was the end of it:
 * nobody reads a log they have no reason to open, so a failure in the middle
 * of a session was discovered by the person training, if at all.
 *
 * Email, through the sender that already exists for password resets. No new
 * service, no new account, nothing to pay for — which is the constraint this
 * project runs under, and the reason an error-tracking SaaS is not here.
 *
 * Three rules, because an alert channel that hurts is an alert channel that
 * gets muted:
 *
 *   - **Throttled.** One message per window, whatever happens. A crash loop
 *     produces one email and a count, not four hundred.
 *   - **Silent on failure.** Sending happens after the response, off the
 *     request path, and a broken mail provider must never turn a handled 500
 *     into a hung request.
 *   - **No user data.** The route, the method, the error and its stack. Never
 *     a body, a query string or an email address: this is a message about the
 *     server, and it travels through a third party.
 */

import type { EmailSender } from './sender';

/** One alert per window. Long enough that a crash loop cannot flood a phone. */
export const ALERT_WINDOW_MS = 15 * 60 * 1000;

export interface Alerter {
  /** Records a failure. Best-effort: never throws, never blocks the caller. */
  report(context: { method: string; path: string; error: unknown }): void;
}

/** An alerter that does nothing, for tests and for an unconfigured server. */
export const SILENT_ALERTER: Alerter = { report: () => undefined };

export function createAlerter(
  email: EmailSender,
  to: string,
  now: () => number = Date.now,
): Alerter {
  // Not zero: that reads as "a window opened at the epoch", and any clock
  // smaller than the window itself then falls inside it. On a real server
  // Date.now() is far past that and it would have worked by luck; a test with
  // a fake clock is where it showed up, which is the point of the fake clock.
  let windowStartedAt = Number.NEGATIVE_INFINITY;
  /** Failures seen since the last message went out. */
  let suppressed = 0;

  return {
    report({ method, path, error }) {
      const at = now();

      // Inside the window: count it and say nothing. The count travels with
      // the next message, so a burst is still visible — just not once per
      // occurrence.
      if (at - windowStartedAt < ALERT_WINDOW_MS) {
        suppressed += 1;
        return;
      }

      const alsoSuppressed = suppressed;
      windowStartedAt = at;
      suppressed = 0;

      const summary = describe(error);
      const extra =
        alsoSuppressed > 0
          ? `\n\nY ${alsoSuppressed} ${
              alsoSuppressed === 1 ? 'error más' : 'errores más'
            } en los ${Math.round(ALERT_WINDOW_MS / 60000)} minutos anteriores.`
          : '';

      const text =
        `Kilaje ha respondido con un error del servidor.\n\n` +
        `Cuándo: ${new Date(at).toISOString()}\n` +
        `Dónde:  ${method} ${path}\n\n` +
        `${summary}${extra}\n`;

      void email
        .send({
          to,
          subject: `Kilaje: error en ${method} ${path}`,
          text,
          html: `<pre style="font:13px ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(
            text,
          )}</pre>`,
        })
        .catch(() => {
          // Nothing sensible to do: the thing that reports failures has
          // failed. The log line from the error handler is still there.
        });
    },
  };
}

/** The error, flattened to text. Truncated: an alert is a nudge, not a dump. */
function describe(error: unknown): string {
  if (error instanceof Error) {
    const stack = error.stack ?? `${error.name}: ${error.message}`;
    return stack.length > 2000 ? `${stack.slice(0, 2000)}\n…` : stack;
  }
  return String(error).slice(0, 500);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
