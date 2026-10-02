/**
 * The order confirmation email, sent through Mailgun.
 *
 * Two things are true of this module and both matter:
 *
 * 1. **It never throws.** A mail server being down is not a reason to tell a
 *    customer their order failed. `send` resolves to `{ sent: false, error }`
 *    and the caller still returns success, because by the time this runs the
 *    order is already committed and durable. SPEC is explicit that email is a
 *    follow-up side effect, not the source of truth for whether a purchase
 *    exists.
 * 2. **The API key never leaves this file.** It goes into an `Authorization`
 *    header and nothing else — not into a log field, not into an error
 *    message, not into the returned `OrderError`.
 */

import { OrderError } from './order-error.js';
import { formatKobo } from './money.js';
import type { CheckoutShipping, CommittedOrder } from './types.js';

export interface MailgunConfig {
  /** Mailgun private API key. Server-side only. */
  apiKey: string;
  /** Bare sending domain, e.g. `mg.kanso.com`. No scheme, no trailing slash. */
  domain: string;
  /** `Kanso <orders@mg.kanso.com>` — Mailgun requires a verified From. */
  from: string;
  /**
   * Mailgun's regional API roots. EU customers are served by
   * `https://api.eu.mailgun.net/v3`; the default is the US root.
   */
  apiBase: string;
}

export type SendResult = { sent: true } | { sent: false; error: OrderError };

/** Everything the confirmation needs, and nothing about the buyer's session. */
export interface ConfirmationMessage {
  order: CommittedOrder;
  shipping: CheckoutShipping;
  /** Absolute origin of the storefront, when configured. */
  appUrl: string | null;
}

export interface Mailer {
  send(message: ConfirmationMessage): Promise<SendResult>;
}

const REQUEST_TIMEOUT_MS = 8_000;
const BRAND = 'Kanso';

export function createMailgunMailer(config: MailgunConfig, fetchImpl = fetch): Mailer {
  const endpoint = `${config.apiBase.replace(/\/+$/, '')}/${config.domain}/messages`;

  return {
    async send(message: ConfirmationMessage): Promise<SendResult> {
      const body = new URLSearchParams({
        from: config.from,
        to: `${message.shipping.fullName} <${message.shipping.email}>`,
        subject: `${BRAND} — order ${message.order.reference}`,
        text: renderConfirmationText(message),
        html: renderConfirmationHtml(message),
      });

      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Basic ${btoa(`api:${config.apiKey}`)}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (cause) {
        // `cause` is the raw fetch/AbortError; the message is all we surface and
        // it is a network fact, not a credential.
        return {
          sent: false,
          error: new OrderError('network', 'The confirmation email could not be sent.', { cause }),
        };
      }

      if (!response.ok) {
        return {
          sent: false,
          error: new OrderError('server', 'The confirmation email could not be sent.', {
            details: { provider: 'mailgun', status: response.status },
          }),
        };
      }
      return { sent: true };
    },
  };
}

/* ===========================================================================
   Templates
   =========================================================================== */

/** The order reference, on its own line, for the email body. */
function orderUrl(message: ConfirmationMessage): string | null {
  if (message.appUrl === null || message.appUrl.length === 0) return null;
  return `${message.appUrl.replace(/\/+$/, '')}/order/${message.order.id}`;
}

function itemRows(message: ConfirmationMessage): string[] {
  return message.order.items.map(
    (item) => `${item.quantity} × ${item.productName} — ${formatKobo(item.unitPriceKobo)} each`,
  );
}

export function renderConfirmationText(message: ConfirmationMessage): string {
  const { order, shipping } = message;
  const lines = [
    `Hi ${shipping.fullName},`,
    '',
    `Thank you for your order. We have it, and this email is your receipt.`,
    '',
    `Order ${order.reference}`,
    '',
    'Items',
    ...itemRows(message),
    '',
    `Total  ${formatKobo(order.totalKobo)}`,
    '',
    'Delivering to',
    shipping.fullName,
    shipping.addressLine1,
    ...(shipping.addressLine2 === undefined ? [] : [shipping.addressLine2]),
    `${shipping.city}, ${shipping.state}`,
    shipping.country,
    `Phone  ${shipping.phone}`,
  ];

  const url = orderUrl(message);
  if (url !== null) lines.push('', `Track this order: ${url}`);

  lines.push('', `${BRAND} — considered tools for focused work.`);
  return lines.join('\n');
}

export function renderConfirmationHtml(message: ConfirmationMessage): string {
  const { order, shipping } = message;
  const url = orderUrl(message);

  const addressLines = [
    shipping.addressLine1,
    ...(shipping.addressLine2 === undefined ? [] : [shipping.addressLine2]),
    `${shipping.city}, ${shipping.state}`,
    shipping.country,
  ]
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join('');

  const rows = message.order.items
    .map(
      (item) => `<tr>
        <td style="padding:8px 0">${item.quantity} × ${escapeHtml(item.productName)}</td>
        <td style="padding:8px 0;text-align:right">${formatKobo(item.unitPriceKobo)}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#faf9f5;color:#1b1c1a;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px">
      <p style="font-weight:700;letter-spacing:.14em;margin:0 0 24px">${BRAND}</p>
      <h1 style="font-size:24px;margin:0 0 8px">Thank you, ${escapeHtml(shipping.fullName)}.</h1>
      <p style="margin:0 0 24px;color:#44474a">
        We have your order. This email is your receipt.
      </p>

      <p style="font-family:ui-monospace,Menlo,monospace;margin:0 0 16px">
        Order ${escapeHtml(order.reference)}
      </p>

      <table style="width:100%;border-collapse:collapse;border-top:2px solid #1b1c1a">
        ${rows}
        <tr>
          <td style="padding:12px 0;border-top:1px solid #c5c6c9;font-weight:700">Total</td>
          <td style="padding:12px 0;border-top:1px solid #c5c6c9;text-align:right;font-weight:700">
            ${formatKobo(order.totalKobo)}
          </td>
        </tr>
      </table>

      <h2 style="font-size:14px;letter-spacing:.06em;margin:32px 0 8px">Delivering to</h2>
      <div style="color:#44474a">
        <div>${escapeHtml(shipping.fullName)}</div>
        ${addressLines}
        <div>${escapeHtml(shipping.phone)}</div>
      </div>
      ${
        url === null
          ? ''
          : `<p style="margin:32px 0 0"><a href="${escapeHtml(url)}" style="color:#191e00">Track this order</a></p>`
      }
      <p style="margin:32px 0 0;color:#75777a;font-size:13px">
        ${BRAND} — considered tools for focused work.
      </p>
    </div>
  </body>
</html>`;
}

/**
 * The customer's own name and street go into a third party's inbox, so they are
 * escaped before they become markup. The subject line carries only the order
 * reference, which is the one identifier that is safe to put in a notification.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
