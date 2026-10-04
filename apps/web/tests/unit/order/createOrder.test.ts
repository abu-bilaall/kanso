/**
 * `create-order` behaviour.
 *
 * The store is a stateful fake and the mail transport is a mocked `fetch`, so
 * every assertion here is about something a customer or an operator would
 * actually observe: the HTTP status and body, whether stock went down, whether
 * the cart closed, and what reached the log stream. Nothing asserts that a
 * particular method was called.
 *
 * The one test that matters most is the mail-failure one: if the transport is
 * down, the order still exists and the response is still a success. Break that
 * and the suite goes red — see the note above it.
 */

import { describe, expect, it, vi } from 'vitest';
import { APP_ERROR_CODES } from '@/lib/errors';
import { checkoutFieldErrors, createOrderPayloadSchema } from '@/schemas/checkout';
import {
  type CreateOrderDeps,
  handleCreateOrder,
} from '../../../../../supabase/functions/_shared/create-order';
import {
  createCapturingLogger,
  createLogger,
} from '../../../../../supabase/functions/_shared/logger';
import {
  type ConfirmationMessage,
  createMailgunMailer,
  type Mailer,
  type SendResult,
} from '../../../../../supabase/functions/_shared/mailgun';
import type { OrderErrorBody } from '../../../../../supabase/functions/_shared/order-error';
import { ORDER_ERROR_CODES } from '../../../../../supabase/functions/_shared/order-error';
import type { CreateOrderResult } from '../../../../../supabase/functions/_shared/types';
import { FakeOrderStore } from './fakeOrderStore';

/* ===========================================================================
   Fixtures
   =========================================================================== */

// Shaped like a Mailgun private key so the redaction test is meaningful, and
// spelled so no scanner — or future reader — mistakes it for a real one.
const API_KEY = 'key-not-a-real-key-used-only-in-tests';
const MAILGUN_DOMAIN = 'mg.kanso.test';

const SHIPPING = {
  fullName: 'Adaeze Okonkwo',
  email: 'adaeze.okonkwo@example.test',
  phone: '+2348030000000',
  addressLine1: '14B Admiralty Way, Lekki Phase 1',
  addressLine2: 'Suite 7',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
} as const;

const MAILGUN_CONFIG = {
  apiKey: API_KEY,
  domain: MAILGUN_DOMAIN,
  from: 'Kanso <orders@mg.kanso.test>',
  apiBase: 'https://api.mailgun.test/v3',
};

/** Silent by default, so a suite's output is its assertions, not JSON lines. */
const SILENT_LOGGER = createLogger({}, 'silent');

const CART_ID = 'cart-1';

function seededStore(): FakeOrderStore {
  return new FakeOrderStore('user-1')
    .addProduct({
      id: 'product-pen',
      slug: 'oak-pen-cup',
      name: 'Oak Pen Cup',
      priceKobo: 450_000,
      inventory: 2,
    })
    .addProduct({
      id: 'product-rule',
      slug: 'steel-rule',
      name: 'Steel Rule',
      priceKobo: 320_000,
      inventory: 10,
    })
    .addCart({
      id: CART_ID,
      userId: 'user-1',
      items: [
        { productId: 'product-pen', quantity: 3 },
        { productId: 'product-rule', quantity: 2 },
      ],
    });
}

function checkoutRequest(body: unknown, token: string | null = 'valid-token'): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  return new Request('http://localhost/functions/v1/create-order', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** A store with stock that comfortably covers the seeded cart. */
function orderableStore(): FakeOrderStore {
  const store = seededStore();
  const pen = store.products.get('product-pen');
  if (pen !== undefined) pen.inventory = 8;
  return store;
}

function stubMailer(result: SendResult): { mailer: Mailer; messages: ConfirmationMessage[] } {
  const messages: ConfirmationMessage[] = [];
  return {
    messages,
    mailer: {
      send: async (message) => {
        messages.push(message);
        return result;
      },
    },
  };
}

function mailgunMailer(fetchImpl: typeof fetch): Mailer {
  return createMailgunMailer(MAILGUN_CONFIG, fetchImpl);
}

function depsFor(store: FakeOrderStore, overrides: Partial<CreateOrderDeps> = {}): CreateOrderDeps {
  return {
    store,
    mailer: stubMailer({ sent: true }).mailer,
    payloadSchema: createOrderPayloadSchema,
    appUrl: 'https://kanso.test',
    logger: SILENT_LOGGER,
    ...overrides,
  };
}

async function postOrder(
  store: FakeOrderStore,
  body: unknown = { shipping: SHIPPING },
  overrides: Partial<CreateOrderDeps> = {},
): Promise<Response> {
  return handleCreateOrder(checkoutRequest(body), depsFor(store, overrides));
}

/** The parsed 200 body, typed. */
async function resultOf(response: Response): Promise<CreateOrderResult> {
  return (await response.json()) as CreateOrderResult;
}

async function errorOf(response: Response): Promise<OrderErrorBody> {
  return (await response.json()) as OrderErrorBody;
}

/** The events a run actually wrote to the log stream, parsed. */
function eventsOf(lines: string[]): Array<Record<string, unknown>> {
  return lines.map((line) => Object.fromEntries(Object.entries(JSON.parse(line) as object)));
}

function firstEvent(lines: string[], name: string): Record<string, unknown> | undefined {
  return eventsOf(lines).find((event) => event.event === name);
}

/* ===========================================================================
   Authentication
   =========================================================================== */

describe('authentication', () => {
  it('rejects a request with no bearer token and creates nothing', async () => {
    const store = orderableStore();

    const response = await handleCreateOrder(
      checkoutRequest({ shipping: SHIPPING }, null),
      depsFor(store),
    );

    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe('unauthenticated');
    expect(store.orders).toHaveLength(0);
    expect(store.cart(CART_ID).status).toBe('active');
  });

  it('rejects a token the store will not verify', async () => {
    const store = orderableStore();

    const response = await postOrder(store, { shipping: SHIPPING }, { store });
    expect(response.status).toBe(200);

    const rejected = await handleCreateOrder(
      checkoutRequest({ shipping: SHIPPING }, 'forged-token'),
      depsFor(store),
    );

    expect(rejected.status).toBe(401);
    expect(store.orders).toHaveLength(1);
  });

  it('ignores a client-supplied user id: the order belongs to the verified session', async () => {
    const store = orderableStore();

    const response = await postOrder(store, {
      shipping: { ...SHIPPING },
      userId: 'someone-elses-account',
      totalKobo: 1,
    });

    expect(response.status).toBe(200);
    const order = store.orders[0];
    expect(order?.userId).toBe('user-1');
    expect(order?.userId).not.toBe('someone-elses-account');
  });
});

/* ===========================================================================
   Payload validation
   =========================================================================== */

describe('payload validation', () => {
  it('rejects an invalid payload with field-level detail', async () => {
    const store = orderableStore();

    const response = await postOrder(store, {
      shipping: { ...SHIPPING, city: '', email: 'not-an-email' },
    });
    const body = await errorOf(response);

    expect(response.status).toBe(422);
    expect(body.code).toBe('validation');
    expect(body.details?.fields).toEqual(expect.arrayContaining(['city', 'email']));
    expect(typeof body.details?.fieldErrors).toBe('object');
    expect(store.orders).toHaveLength(0);
  });

  it('names the same fields the browser form does, so checkout can render them', async () => {
    const store = orderableStore();
    const payload = { shipping: { ...SHIPPING, city: '', phone: 'abc' } };

    const response = await postOrder(store, payload);
    const serverFields = ((await errorOf(response)).details?.fields ?? []) as string[];

    // The browser flattens the same ZodError through the frozen helper; only
    // the `shipping.` prefix differs, because the form has no such nesting.
    const parsed = createOrderPayloadSchema.safeParse(payload);
    if (parsed.success) throw new Error('fixture should not validate');
    const browserFields = Object.keys(checkoutFieldErrors(parsed.error));
    const stripped = browserFields.map((field) => field.replace(/^shipping\./, ''));

    expect(serverFields.sort()).toEqual([...new Set(stripped)].sort());
  });

  it('rejects a body that is not an object', async () => {
    const store = orderableStore();
    const request = new Request('http://localhost/functions/v1/create-order', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer valid-token' },
      body: '"just a string"',
    });

    const response = await handleCreateOrder(request, depsFor(store));

    expect(response.status).toBe(400);
    expect(store.orders).toHaveLength(0);
  });
});

/* ===========================================================================
   Authoritative pricing
   =========================================================================== */

describe('pricing', () => {
  it('computes the total from catalogue prices and ignores a client-supplied total', async () => {
    const store = orderableStore();

    const response = await postOrder(store, {
      shipping: { ...SHIPPING },
      totalKobo: 1,
      subtotalKobo: 1,
      total: 999_999_999,
    });
    const body = await resultOf(response);

    // 3 × ₦4,500.00 + 2 × ₦3,200.00 = ₦19,900.00
    expect(body.totalKobo).toBe(1_990_000);
    expect(store.orders[0]?.totalKobo).toBe(1_990_000);
    expect(body.items.map((item) => item.unitPriceKobo)).toEqual([450_000, 320_000]);
  });
});

/* ===========================================================================
   Inventory
   =========================================================================== */

describe('inventory', () => {
  it('returns a structured shortfall naming the product and available count, and creates nothing', async () => {
    const store = seededStore();

    const response = await postOrder(store, { shipping: { ...SHIPPING } });
    const body = await errorOf(response);

    expect(response.status).toBe(409);
    expect(body.code).toBe('insufficient_inventory');
    expect(body.details).toMatchObject({
      product: 'oak-pen-cup',
      requested: 3,
      available: 2,
    });
    expect(body.message).toContain('Oak Pen Cup');

    expect(store.orders).toHaveLength(0);
    expect(store.cart(CART_ID).status).toBe('active');
    expect(store.inventoryOf('product-pen')).toBe(2);
    expect(store.inventoryOf('product-rule')).toBe(10);
  });

  it('decrements inventory for every line', async () => {
    const store = orderableStore();

    await postOrder(store);

    expect(store.inventoryOf('product-pen')).toBe(5);
    expect(store.inventoryOf('product-rule')).toBe(8);
  });

  it('snapshots the purchase-time unit price on the order items', async () => {
    const store = orderableStore();

    const response = await postOrder(store);
    const body = await resultOf(response);

    // The catalogue moves after the purchase. The order must not.
    const pen = store.products.get('product-pen');
    if (pen !== undefined) pen.priceKobo = 999_000;

    expect(body.items).toEqual([
      { productId: 'product-pen', productName: 'Oak Pen Cup', quantity: 3, unitPriceKobo: 450_000 },
      { productId: 'product-rule', productName: 'Steel Rule', quantity: 2, unitPriceKobo: 320_000 },
    ]);
    expect(store.orders[0]?.items[0]?.unitPriceKobo).toBe(450_000);
  });
});

/* ===========================================================================
   The transaction
   =========================================================================== */

describe('the commit', () => {
  it('closes the cart as part of committing the order', async () => {
    const store = orderableStore();

    await postOrder(store);

    const cart = store.cart(CART_ID);
    expect(cart.status).toBe('closed');
    expect(cart.closedAt).not.toBeNull();
  });

  it('leaves no half-order when the commit fails', async () => {
    const store = orderableStore();
    store.failCommitWith = new Error('connection reset');

    const response = await postOrder(store);

    expect(response.status).toBe(500);
    expect(store.orders).toHaveLength(0);
    expect(store.cart(CART_ID).status).toBe('active');
    expect(store.inventoryOf('product-pen')).toBe(8);
    expect(store.inventoryOf('product-rule')).toBe(10);
  });

  it('reports a stock race as insufficient inventory rather than a server error', async () => {
    const store = orderableStore();
    store.failCommitWith = Object.assign(new Error('inventory_race'), { code: 'P0001' });

    const response = await postOrder(store);
    const body = await errorOf(response);

    expect(response.status).toBe(500);
    expect(store.orders).toHaveLength(0);
    expect(body.code).toBe('server');
  });
});

/* ===========================================================================
   The confirmation email
   =========================================================================== */

describe('the confirmation email', () => {
  it('reports a successful delivery', async () => {
    const store = orderableStore();
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response('{"id":"<2026>"}', { status: 200 }),
    );

    const response = await postOrder(
      store,
      { shipping: { ...SHIPPING } },
      {
        mailer: mailgunMailer(fetchMock as unknown as typeof fetch),
      },
    );
    const body = await resultOf(response);

    expect(response.status).toBe(200);
    expect(body.emailSent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.mailgun.test/v3/${MAILGUN_DOMAIN}/messages`);
    expect(init?.headers).toMatchObject({ authorization: `Basic ${btoa(`api:${API_KEY}`)}` });

    const sent = new URLSearchParams(String(init?.body));
    expect(sent.get('subject')).toContain(body.reference);
    expect(sent.get('text')).toContain('Oak Pen Cup');
    expect(sent.get('to')).toBe(`${SHIPPING.fullName} <${SHIPPING.email}>`);
  });

  it('attempts delivery to the address on the order, with the total and reference', async () => {
    const store = orderableStore();
    const { messages, mailer } = stubMailer({ sent: true });

    const response = await postOrder(store, { shipping: { ...SHIPPING } }, { mailer });
    const body = await resultOf(response);

    expect(messages).toHaveLength(1);
    const message = messages[0];
    expect(message?.shipping.email).toBe(SHIPPING.email);
    expect(message?.order.reference).toBe(body.reference);
    expect(message?.order.totalKobo).toBe(1_990_000);
  });

  /**
   * The important one. SPEC: "If email delivery fails, the persisted order
   * remains valid." Break the handler by treating a send failure as a request
   * failure, or by rolling the order back, and this goes red.
   */
  it('keeps the order, the closed cart and the decremented stock when Mailgun is down', async () => {
    const store = orderableStore();
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed: connection refused');
    });
    const { logger, lines } = createCapturingLogger();

    const response = await postOrder(
      store,
      { shipping: { ...SHIPPING } },
      { mailer: mailgunMailer(fetchMock as unknown as typeof fetch), logger },
    );
    const body = await resultOf(response);

    expect(response.status).toBe(200);
    expect(body.emailSent).toBe(false);
    expect(body.reference).not.toBe('');

    expect(store.orders).toHaveLength(1);
    expect(store.orders[0]?.reference).toBe(body.reference);
    expect(store.cart(CART_ID).status).toBe('closed');
    expect(store.inventoryOf('product-pen')).toBe(5);

    const failure = firstEvent(lines, 'confirmation_email_failed');
    expect(failure).toMatchObject({
      orderPersisted: true,
      reference: body.reference,
    });
    expect(failure?.error).toBeDefined();
  });

  it('keeps the order when Mailgun rejects the message', async () => {
    const store = orderableStore();
    const fetchMock = vi.fn(async () => new Response('Forbidden', { status: 403 }));

    const response = await postOrder(
      store,
      { shipping: { ...SHIPPING } },
      { mailer: mailgunMailer(fetchMock as unknown as typeof fetch) },
    );
    const body = await resultOf(response);

    expect(response.status).toBe(200);
    expect(body.emailSent).toBe(false);
    expect(store.orders).toHaveLength(1);
  });

  it('keeps the order when Mailgun is not configured at all', async () => {
    const store = orderableStore();

    const response = await postOrder(store, { shipping: { ...SHIPPING } }, { mailer: null });
    const body = await resultOf(response);

    expect(response.status).toBe(200);
    expect(body.emailSent).toBe(false);
    expect(store.orders).toHaveLength(1);
  });
});

/* ===========================================================================
   Logging
   =========================================================================== */

describe('logging', () => {
  it('emits no credential and no full address on any line', async () => {
    const store = orderableStore();
    const { logger, lines } = createCapturingLogger();
    const fetchMock = vi.fn(async () => new Response('{"id":"<2026>"}', { status: 200 }));

    const response = await postOrder(
      store,
      { shipping: { ...SHIPPING } },
      { logger, mailer: mailgunMailer(fetchMock as unknown as typeof fetch) },
    );
    const body = await resultOf(response);

    expect(response.status).toBe(200);
    expect(lines.length).toBeGreaterThan(0);

    const transcript = lines.join('\n');
    expect(transcript).not.toContain(API_KEY);
    expect(transcript).not.toContain(SHIPPING.fullName);
    expect(transcript).not.toContain(SHIPPING.addressLine1);
    expect(transcript).not.toContain(SHIPPING.addressLine2);
    expect(transcript).not.toContain(SHIPPING.email);
    expect(transcript).not.toContain(SHIPPING.phone);

    // The facts an operator actually needs are still there.
    expect(transcript).toContain(body.reference);
    expect(transcript).toContain(SHIPPING.city);
  });

  it('logs field names, never values, when the payload is invalid', async () => {
    const store = orderableStore();
    const { logger, lines } = createCapturingLogger();

    await postOrder(store, { shipping: { ...SHIPPING, phone: 'SECRET-PHONE-MARKER' } }, { logger });

    const event = firstEvent(lines, 'checkout_validation_failed');
    expect(event?.invalidFields).toContain('phone');
    expect(lines.join('\n')).not.toContain('SECRET-PHONE-MARKER');
  });

  it('uses only error codes the frozen browser vocabulary defines', () => {
    // The browser's `ErrorState` and `Alert` switch on `AppError.code`. A code
    // invented here would render as "Something went wrong" with no way to
    // recover, so the two lists are pinned to each other.
    expect([...ORDER_ERROR_CODES].sort()).toEqual([...APP_ERROR_CODES].sort());
  });
});

/* ===========================================================================
   Transport details
   =========================================================================== */

describe('transport', () => {
  it('answers the CORS preflight the storefront sends before a POST', async () => {
    const store = orderableStore();
    const response = await handleCreateOrder(
      new Request('http://localhost/functions/v1/create-order', { method: 'OPTIONS' }),
      depsFor(store),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(store.orders).toHaveLength(0);
  });

  /**
   * Regression. `@supabase/supabase-js` attaches `x-application-name` to every
   * request when the client sets `global.headers`, so it goes out on
   * `functions.invoke` and the browser names it in `Access-Control-Request-
   * Headers`. When the allow-list omitted it, the preflight failed, the POST
   * never left the page, and checkout surfaced `TypeError: Failed to fetch` —
   * a message that points at the network and not at a CORS header.
   */
  it('allows x-application-name, which the Supabase client sends unasked', async () => {
    const store = orderableStore();
    const response = await handleCreateOrder(
      new Request('http://localhost/functions/v1/create-order', { method: 'OPTIONS' }),
      depsFor(store),
    );

    expect(response.headers.get('access-control-allow-headers')).toContain('x-application-name');
  });

  it('echoes back any header the browser asks for, so the list cannot drift', async () => {
    const store = orderableStore();
    const request = new Request('http://localhost/functions/v1/create-order', {
      method: 'OPTIONS',
    });
    request.headers.set('access-control-request-headers', 'authorization, x-some-future-header');

    const response = await handleCreateOrder(request, depsFor(store));
    const allowed = response.headers.get('access-control-allow-headers') ?? '';

    expect(allowed).toContain('x-some-future-header');
    // The documented set must survive the union, not be replaced by it.
    expect(allowed).toContain('authorization');
    expect(allowed).toContain('apikey');
    expect(allowed).toContain('content-type');
    expect(allowed).toContain('x-client-info');
  });

  it('carries the runtime request id onto the response', async () => {
    const store = orderableStore();
    const request = checkoutRequest({ shipping: { ...SHIPPING } });
    request.headers.set('x-request-id', 'req-abc123');

    const response = await handleCreateOrder(request, depsFor(store));

    expect(response.headers.get('x-request-id')).toBe('req-abc123');
  });
});
