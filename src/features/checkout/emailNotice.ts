/**
 * The confirmation-email notice.
 *
 * This is the one place in Kanso where being wrong is expensive, so the copy is
 * derived rather than written inline and every branch is pinned by a test.
 *
 * `create-order` commits the order first and attempts Mailgun second, then
 * reports what actually happened in `emailSent`. Three states exist, and all
 * three are reachable:
 *
 * - `true`   — delivery was attempted and accepted.
 * - `false`  — the order **exists**; the email did not go out. The wording says
 *              the order is confirmed and that the email may not arrive. It
 *              never says the order failed, because it did not, and it never
 *              claims an email is on its way, because none is.
 * - `null`   — the confirmation screen was opened directly, or reloaded, so there
 *              is no `create-order` response to read. The honest move is to say
 *              nothing is known; inventing either answer would be a lie about
 *              the customer's money.
 */

import type { AlertTone } from '@/components/ui';

export interface EmailNotice {
  tone: AlertTone;
  title: string;
  body: string;
}

/**
 * The notice for a known delivery outcome.
 *
 * @param emailSent `create-order`'s flag. `null` when the screen was reached
 *                  without placing the order in this browser session.
 */
export function emailNotice(emailSent: boolean, email?: string): EmailNotice {
  if (emailSent) {
    return {
      tone: 'success',
      title: 'Confirmation emailed',
      body:
        email === undefined
          ? 'Your order confirmation is on its way to the address you gave us.'
          : `Your order confirmation is on its way to ${email}. It should arrive within a few minutes.`,
    };
  }

  return {
    tone: 'warning',
    title: 'Order confirmed — email not delivered',
    body:
      'Your order is confirmed and saved. We could not send the confirmation email, so it may not arrive. ' +
      'Quote the order reference above if you contact us.',
  };
}

/** The notice for an outcome we have no record of. Says so; claims nothing. */
export function unknownEmailNotice(): EmailNotice {
  return {
    tone: 'info',
    title: 'Confirmation email',
    body:
      'This order was not placed in this browser session, so we have no delivery record for the confirmation ' +
      'email. Check your inbox, or quote the order reference above.',
  };
}

/**
 * Read the `emailSent` flag out of the router state checkout navigates with.
 *
 * Router state is how a one-shot result crosses a navigation: the flag is not on
 * the order row, and a later visit to `/order/:id` genuinely has no value. An
 * absent, malformed or hostile value reads as `null` — "unknown", which is the
 * only safe reading of a flag that was never set.
 */
export function readEmailSent(state: unknown): boolean | null {
  if (typeof state !== 'object' || state === null || !('emailSent' in state)) return null;
  const flag = state.emailSent;
  return typeof flag === 'boolean' ? flag : null;
}
