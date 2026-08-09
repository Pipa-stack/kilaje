/**
 * Outbound email, through Resend.
 *
 * Behind an interface for two reasons: the tests must never make a network
 * call, and a missing API key must not take the app down. Without a key the
 * sender still "works" — it logs what it would have sent and reports failure
 * to the caller, which is enough for the caller to decide what to do.
 */

export interface Email {
  to: string;
  subject: string;
  /** Plain text. Always sent: some clients show nothing else. */
  text: string;
  html: string;
}

export interface EmailSender {
  /** Returns false when the message could not be handed over. */
  send(email: Email): Promise<boolean>;
  /** False when no provider is configured, so callers can warn once. */
  readonly configured: boolean;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * @param apiKey Resend key, from the environment. Absent in tests and in a
 *   local checkout that has not configured mail.
 * @param from Verified sender address.
 */
export function createEmailSender(apiKey: string | undefined, from: string): EmailSender {
  if (!apiKey) {
    return {
      configured: false,
      async send(email) {
        // Loud on purpose: a silent no-op here looks exactly like a delivered
        // message, and password resets would appear to work while nobody
        // ever receives one.
        console.warn(
          `[email] sin RESEND_API_KEY: no se ha enviado "${email.subject}" a ${email.to}`,
        );
        return false;
      },
    };
  }

  return {
    configured: true,
    async send(email) {
      try {
        const response = await fetch(RESEND_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: [email.to],
            subject: email.subject,
            text: email.text,
            html: email.html,
          }),
          // A hung provider must not hang the request behind it.
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          // The body can quote the recipient; log the status only.
          console.error(`[email] Resend ha respondido ${response.status}`);
          return false;
        }
        return true;
      } catch (error) {
        console.error('[email] no se ha podido enviar:', error instanceof Error ? error.message : error);
        return false;
      }
    },
  };
}
