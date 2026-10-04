/**
 * The `create-order` Edge Function entrypoint.
 *
 * This file is the only place that touches the runtime: it reads `Deno.env`,
 * builds the Supabase client and the Mailgun transport, and serves. Everything
 * that decides anything lives in `../_shared`, which imports nothing from here
 * and is therefore testable under Node.
 *
 * The one import from the application is the frozen
 * `createOrderPayloadSchema`. It is injected rather than imported by the shared
 * code because the Deno runtime needs the `.ts` extension and the frozen
 * `tsconfig.app.json` rejects it — see `docs/CONTRACT-REQUESTS.md`.
 */

import { createOrderPayloadSchema } from '../../../apps/web/src/schemas/checkout.ts';
import { type CreateOrderDeps, handleCreateOrder } from '../_shared/create-order.ts';
import { logger } from '../_shared/logger.ts';
import { createMailgunMailer, type Mailer } from '../_shared/mailgun.ts';
import { OrderError } from '../_shared/order-error.ts';
import { createSupabaseOrderStore } from '../_shared/supabase-store.ts';

/** Mailgun's US root. EU accounts are served by `https://api.eu.mailgun.net/v3`. */
const MAILGUN_API_BASE = 'https://api.mailgun.net/v3';

Deno.serve(async (request: Request): Promise<Response> => {
  try {
    return await handleCreateOrder(request, resolveDeps());
  } catch (error) {
    // Anything that escapes the handler is a bug in the wiring, not in the
    // request. It still gets the same typed body, never a stack trace.
    const failure =
      error instanceof OrderError
        ? error
        : new OrderError('configuration', 'Order creation is not configured correctly.', {
            cause: error,
          });
    logger.error({
      event: 'order_create_failed',
      scope: 'create-order',
      stage: 'boot',
      error: failure,
    });
    return new Response(JSON.stringify(failure.toBody()), {
      status: failure.status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
});

/**
 * Built per request because building it is two env reads and a client
 * construction, and because reading the environment lazily means a missing
 * value produces a typed error for that request instead of a worker that
 * refuses to boot and answers nothing at all.
 */
function resolveDeps(): CreateOrderDeps {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (url === undefined || serviceRoleKey === undefined) {
    throw new OrderError('configuration', 'Order creation is not configured correctly.', {
      details: { reason: 'missing_supabase_credentials' },
    });
  }

  return {
    store: createSupabaseOrderStore({ url, serviceRoleKey }),
    mailer: resolveMailer(),
    payloadSchema: createOrderPayloadSchema,
    appUrl: Deno.env.get('APP_URL') ?? null,
  };
}

/**
 * `null` when Mailgun is not configured, which the handler treats as a delivery
 * failure on an otherwise successful order rather than a refused purchase.
 */
function resolveMailer(): Mailer | null {
  const apiKey = Deno.env.get('MAILGUN_API_KEY');
  const domain = Deno.env.get('MAILGUN_DOMAIN');
  const from = Deno.env.get('MAILGUN_FROM');
  if (apiKey === undefined || domain === undefined || from === undefined) return null;

  return createMailgunMailer({
    apiKey,
    domain,
    from,
    apiBase: Deno.env.get('MAILGUN_API_BASE') ?? MAILGUN_API_BASE,
  });
}
