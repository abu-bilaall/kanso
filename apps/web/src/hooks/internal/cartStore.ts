/**
 * The one cart.
 *
 * `useCart` used to be `useAsyncResource` plus local state, which meant every
 * call site owned a private copy. `DesktopRail`, `MobileHeader`, `MobileTabBar`
 * and the page under them each ran their own fetch, so the badge kept showing
 * the pre-checkout count on the confirmation screen and the checkout page could
 * disagree with the badge about what was in the cart. This module is the single
 * source of truth they all read from.
 *
 * It is a plain external store rather than a provider, for three reasons:
 *
 *   1. `useCart`'s public shape is a contract. A store the hook subscribes to
 *      changes nothing about that shape, and needs no new mount point in
 *      `main.tsx` — a provider would have been a second thing to forget to
 *      mount above a route that renders a badge.
 *   2. One fetch. Every consumer shares the in-flight promise, so three mounted
 *      consumers of the same user still produce exactly one query.
 *   3. One mutation. A write from any consumer republishes to all of them, so a
 *      line removed on the cart page clears the rail badge in the same commit.
 *
 * State is keyed by user id. Signing in as somebody else starts clean, and
 * nothing signed in can read a previous user's cart out of the module.
 *
 * Not part of the public contract — see `useCart`, which is.
 */

import { AppError, InsufficientInventoryError, toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getSupabaseClient } from '@/lib/supabase';
import type { Cart, CartItemWithProduct, Product } from '@/lib/supabase.types';
import type { AsyncStatus } from './useAsyncResource';

/** Cart plus its joined items — the shape one fetch returns. */
export interface CartSnapshot {
  cart: Cart;
  items: CartItemWithProduct[];
}

export interface CartStoreState {
  /** Whose cart this is. `null` until a session resolves to a user. */
  userId: string | null;
  data: CartSnapshot | null;
  status: AsyncStatus;
  error: AppError | null;
  /** True while any consumer's mutation is in flight. */
  isMutating: boolean;
}

const INITIAL_STATE: CartStoreState = {
  userId: null,
  data: null,
  status: 'idle',
  error: null,
  isMutating: false,
};

let state: CartStoreState = INITIAL_STATE;
let listeners: Array<() => void> = [];

/** The single in-flight read, shared by every consumer that asks for one. */
let inFlight: Promise<void> | null = null;

/** Bumped whenever a read starts or the subject changes, so a late answer is dropped. */
let generation = 0;

function publish(next: CartStoreState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** The `getSnapshot` seam `useSyncExternalStore` needs. */
export function getCartStoreState(): CartStoreState {
  return state;
}

/**
 * Abandoning the store is only safe once nothing is listening. React unmounts
 * the outgoing route's `PageShell` — and with it the rail, the header and the
 * tab bar — in the same commit that mounts the incoming one, so the count hits
 * zero mid-navigation. Deferring to a microtask lets that commit finish first;
 * a synchronous reset would throw away a warm cart on every route change.
 */
export function subscribeToCartStore(listener: () => void): () => void {
  listeners = [...listeners, listener];

  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
    if (listeners.length > 0) return;
    queueMicrotask(() => {
      if (listeners.length === 0) {
        generation += 1;
        inFlight = null;
        publish(INITIAL_STATE);
      }
    });
  };
}

/* ===========================================================================
   Reads
   =========================================================================== */

/**
 * Point the store at `userId` and make sure its cart is loaded. Calling it
 * again for the same user is a refresh, not a reset — which is what lets every
 * mounted consumer ask on mount without fighting over the state.
 */
export async function selectCart(userId: string): Promise<void> {
  if (state.userId !== userId) {
    generation += 1;
    inFlight = null;
    publish({ ...INITIAL_STATE, userId, status: 'loading' });
  }
  await refreshCart();
}

/**
 * Re-read the active cart. Concurrent callers share one request: the rail, the
 * header and the page all mount together, and three identical queries would be
 * three chances to disagree.
 *
 * `force` starts a second read even when one is already in flight. A mutation
 * needs that — the read it would otherwise join may have begun before the write
 * and would publish the cart as it was before the customer's change.
 */
export async function refreshCart(options: { force?: boolean } = {}): Promise<void> {
  const userId = state.userId;
  if (userId === null) return;
  if (inFlight !== null && options.force !== true) return inFlight;

  // Starting a read supersedes any read already running, so the older answer is
  // dropped rather than published over the newer one.
  const mine = ++generation;
  const startedAt = Date.now();
  publish({ ...state, status: 'loading' });

  const run = (async () => {
    try {
      const snapshot = await loadOrCreateActiveCart(userId);
      if (mine !== generation) return;

      publish({ ...state, data: snapshot, error: null, status: 'success' });
      logger.info({
        event: 'cart_loaded',
        scope: 'cart',
        outcome: 'success',
        durationMs: Date.now() - startedAt,
        userId,
      });
    } catch (thrown) {
      if (mine !== generation) return;

      const error = toAppError(thrown, 'Could not load your cart');
      publish({ ...state, data: null, error, status: 'error' });
      logger.error({
        event: 'cart_loaded',
        scope: 'cart',
        durationMs: Date.now() - startedAt,
        userId,
        error,
      });
    }
  })();

  inFlight = run;
  try {
    await run;
  } finally {
    if (inFlight === run) inFlight = null;
  }
}

/** Resolve the active cart, creating it when the user has none. */
async function loadOrCreateActiveCart(userId: string): Promise<CartSnapshot> {
  const client = getSupabaseClient();

  const { data: existing, error: findError } = await client
    .from('carts')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (findError) throw toAppError(findError, 'Could not load your cart');

  let cart = existing;

  if (cart === null) {
    const { data: created, error: createError } = await client
      .from('carts')
      .insert({ user_id: userId, status: 'active' })
      .select('*')
      .single();

    if (createError) throw toAppError(createError, 'Could not start a cart for you');
    cart = created;
    logger.info({ event: 'cart_created', scope: 'cart', outcome: 'success', userId });
  }

  const { data: items, error: itemsError } = await client
    .from('cart_items')
    .select('*, product:products(*)')
    .eq('cart_id', cart.id)
    .order('created_at', { ascending: true });

  if (itemsError) throw toAppError(itemsError, 'Could not load your cart');
  return { cart, items: items ?? [] };
}

/* ===========================================================================
   Writes
   =========================================================================== */

/**
 * Read the product's live price and inventory. Every mutation re-reads it — a
 * cart line's inventory is a moving target, and a stale value from the join
 * would let an oversell through to the server.
 */
async function readProduct(productId: string): Promise<Product> {
  const { data, error } = await getSupabaseClient()
    .from('products')
    .select('*')
    .eq('id', productId)
    .maybeSingle();

  if (error) throw toAppError(error, 'Could not check that item');
  if (data === null) {
    throw new AppError('not_found', 'That product is no longer available.', {
      details: { productId },
    });
  }
  return data;
}

/**
 * Run a mutation with a consistent envelope: mark busy, do the write, republish
 * to every consumer, and always clear busy.
 *
 * A failure rejects and is logged, and deliberately leaves the read state
 * alone. Setting `error` here would flip `status` to `'error'` and replace a
 * whole page of cart with an error panel because one line was out of stock. The
 * caller surfaces the rejection on the row that caused it, which is the
 * contract's "either await it or watch `isMutating`" split.
 */
async function mutate(
  userId: string | null,
  event: string,
  run: (context: { cartId: string }) => Promise<void>,
): Promise<void> {
  const currentCart = state.data?.cart ?? null;
  // `state.userId !== userId` is not redundancy: a mutation issued from a render
  // that has since been signed out and replaced by another account would
  // otherwise write into the new account's cart.
  if (userId === null || currentCart === null || state.userId !== userId) {
    throw new AppError('unauthenticated', 'You need to sign in to change your cart.');
  }

  publish({ ...state, isMutating: true });
  const startedAt = Date.now();
  try {
    await run({ cartId: currentCart.id });
    await refreshCart({ force: true });
    logger.info({
      event,
      scope: 'cart',
      outcome: 'success',
      durationMs: Date.now() - startedAt,
      cartId: currentCart.id,
      userId,
    });
  } catch (thrown) {
    const error =
      thrown instanceof AppError ? thrown : toAppError(thrown, 'Could not update your cart');
    logger.error({
      event,
      scope: 'cart',
      durationMs: Date.now() - startedAt,
      cartId: currentCart.id,
      userId,
      error,
    });
    publish({ ...state, isMutating: false });
    throw error;
  }
  publish({ ...state, isMutating: false });
}

export function addCartItem(
  userId: string | null,
  productId: string,
  quantity: number,
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity < 1) {
    return Promise.reject(new AppError('validation', 'Choose a quantity of at least one.'));
  }

  return mutate(userId, 'cart_item_added', async ({ cartId }) => {
    const existingLine = state.data?.items.find((item) => item.product_id === productId);
    const nextQuantity = (existingLine?.quantity ?? 0) + quantity;

    const product = await readProduct(productId);

    if (nextQuantity > product.inventory) {
      throw new InsufficientInventoryError(
        product.inventory === 0
          ? `${product.name} is out of stock.`
          : `Only ${product.inventory} of ${product.name} left.`,
        { productId, available: product.inventory },
      );
    }

    const { error } = await getSupabaseClient()
      .from('cart_items')
      .upsert(
        { cart_id: cartId, product_id: productId, quantity: nextQuantity },
        { onConflict: 'cart_id,product_id' },
      );

    if (error) throw toAppError(error, 'Could not add that to your cart');
  });
}

export function setCartItemQuantity(
  userId: string | null,
  productId: string,
  quantity: number,
): Promise<void> {
  return mutate(userId, 'cart_item_updated', async ({ cartId }) => {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new AppError('validation', 'Quantity must be a whole number of zero or more.');
    }

    // Zero means "remove". Deleting is the honest implementation of an empty
    // line, and it keeps the unique (cart_id, product_id) index satisfied.
    if (quantity === 0) {
      const { error } = await getSupabaseClient()
        .from('cart_items')
        .delete()
        .eq('cart_id', cartId)
        .eq('product_id', productId);
      if (error) throw toAppError(error, 'Could not remove that item');
      return;
    }

    const product = await readProduct(productId);
    if (quantity > product.inventory) {
      throw new InsufficientInventoryError(`Only ${product.inventory} of ${product.name} left.`, {
        productId,
        available: product.inventory,
      });
    }

    const { error } = await getSupabaseClient()
      .from('cart_items')
      .update({ quantity })
      .eq('cart_id', cartId)
      .eq('product_id', productId);
    if (error) throw toAppError(error, 'Could not update that item');
  });
}

export function removeCartItem(userId: string | null, productId: string): Promise<void> {
  return mutate(userId, 'cart_item_removed', async ({ cartId }) => {
    const { error } = await getSupabaseClient()
      .from('cart_items')
      .delete()
      .eq('cart_id', cartId)
      .eq('product_id', productId);
    if (error) throw toAppError(error, 'Could not remove that item');
  });
}

export function clearCart(userId: string | null): Promise<void> {
  return mutate(userId, 'cart_cleared', async ({ cartId }) => {
    const { error } = await getSupabaseClient().from('cart_items').delete().eq('cart_id', cartId);
    if (error) throw toAppError(error, 'Could not empty your cart');
  });
}
