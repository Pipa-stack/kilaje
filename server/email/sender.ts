/**
 * Outbound email, through Resend or plain SMTP.
 *
 * Behind an interface for two reasons: the tests must never make a network
 * call, and a missing configuration must not take the app down. Unconfigured,
 * the sender still "works" — it logs what it would have sent and reports
 * failure to the caller, which is enough for the caller to decide what to do.
 *
 * Two providers because they fail in opposite places. Resend needs a domain
 * you have verified by DNS; until you own one, it will only deliver to the
 * address that owns the Resend account, which is useless for password
 * recovery. Gmail's SMTP needs no domain at all: the message leaves Google's
 * own servers authenticated as the account, so SPF and DKIM align and it
 * reaches anyone. The trade is that the From address is visibly a Gmail one.
 */

import { resolve4 } from 'node:dns/promises';

import { createTransport } from 'nodemailer';

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

/** A hung provider must not hang the request waiting behind it. */
const SEND_TIMEOUT_MS = 10_000;

/** Reports failure and says so in the log, rather than pretending to send. */
function unconfiguredSender(): EmailSender {
  return {
    configured: false,
    async send(email) {
      // Loud on purpose: a silent no-op here looks exactly like a delivered
      // message, and password resets would appear to work while nobody
      // ever receives one.
      console.warn(`[email] sin proveedor configurado: no se ha enviado "${email.subject}"`);
      return false;
    },
  };
}

/**
 * @param apiKey Resend key, from the environment. Absent in tests and in a
 *   local checkout that has not configured mail.
 * @param from Verified sender address.
 */
export function createEmailSender(apiKey: string | undefined, from: string): EmailSender {
  if (!apiKey) return unconfiguredSender();

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
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
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

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  /** An app password, never the account password. */
  password: string;
}

/**
 * Resolves a host to a single IPv4 literal, or null if it cannot.
 *
 * Nodemailer resolves both families, concatenates them and then picks one
 * address *at random* (`lib/shared/index.js`). On a host with no IPv6 route —
 * Railway's containers are one — that makes every send a coin flip: half land,
 * half die with ENETUNREACH or hang until the connection timeout. Choosing the
 * A record ourselves removes the randomness.
 *
 * Returning null on failure is deliberate: the caller then hands nodemailer the
 * hostname it would have used anyway, so a resolver hiccup degrades to the old
 * behaviour instead of failing the send outright.
 */
async function resolveIpv4(host: string): Promise<string | null> {
  try {
    const [address] = await resolve4(host);
    return address ?? null;
  } catch {
    return null;
  }
}

/**
 * Sends over SMTP. With Gmail's host this needs no domain of your own.
 *
 * Port 465 is implicit TLS; anything else is upgraded with STARTTLS. Both are
 * encrypted — what must never happen is the password crossing in the clear,
 * so `secure` is derived from the port rather than left to configuration.
 */
export function createSmtpSender(config: SmtpConfig, from: string): EmailSender {
  // Resolved once and reused: the address is stable enough for this, and doing
  // it per send would put a DNS round trip in front of every password reset.
  let pending: Promise<string | null> | undefined;
  const address = () => (pending ??= resolveIpv4(config.host));

  const transportFor = (host: string) =>
    createTransport({
      host,
      port: config.port,
      secure: config.port === 465,
      requireTLS: config.port !== 465,
      // Certificates are issued for the name, not the literal we dialled, so
      // TLS has to keep validating against the configured host.
      tls: { servername: config.host },
      auth: { user: config.user, pass: config.password },
      connectionTimeout: SEND_TIMEOUT_MS,
      greetingTimeout: SEND_TIMEOUT_MS,
      socketTimeout: SEND_TIMEOUT_MS,
    });

  return {
    configured: true,
    async send(email) {
      try {
        const transport = transportFor((await address()) ?? config.host);
        await transport.sendMail({
          from,
          to: email.to,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
        return true;
      } catch (error) {
        // The message can quote the recipient and the credentials; keep it short.
        console.error(
          '[email] SMTP no ha podido enviar:',
          error instanceof Error ? error.message : error,
        );
        return false;
      }
    },
  };
}

/**
 * Picks a provider from the environment.
 *
 * SMTP wins when it is configured because it is the one that works without a
 * verified domain — if both are set, the deliberate act was setting SMTP.
 */
export function createSenderFromEnv(env: NodeJS.ProcessEnv, from: string): EmailSender {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, RESEND_API_KEY } = env;

  if (SMTP_HOST && SMTP_USER && SMTP_PASSWORD) {
    const port = Number.parseInt(SMTP_PORT ?? '465', 10);
    return createSmtpSender(
      {
        host: SMTP_HOST,
        // A bad port would fail every send at connection time, silently.
        port: Number.isFinite(port) && port > 0 ? port : 465,
        user: SMTP_USER,
        password: SMTP_PASSWORD,
      },
      from,
    );
  }

  if (SMTP_HOST || SMTP_USER || SMTP_PASSWORD) {
    // Half a configuration is a mistake, not a choice: say which part is missing
    // instead of quietly falling through to no email at all.
    const missing = [
      SMTP_HOST ? null : 'SMTP_HOST',
      SMTP_USER ? null : 'SMTP_USER',
      SMTP_PASSWORD ? null : 'SMTP_PASSWORD',
    ].filter(Boolean);
    console.warn(`[email] configuración SMTP incompleta, falta: ${missing.join(', ')}`);
  }

  return createEmailSender(RESEND_API_KEY, from);
}
