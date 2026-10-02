/**
 * `useCart` — the signed-in user's active cart, with every mutation the UI needs.
 *
 * ## What it owns
 *
 * A Kanso user has at most one *active* cart (PLAN 4, A1's partial unique index).
 * This hook resolves it lazily: on first load for an authenticated user it reads
 * the active cart and, if none exists, creates one. Anonymous visitors get an
 * empty cart in memory and are not asked to sign in until checkout — which is
 * the journey DESIGN.md describes.
 *
 * ## Money
 *
 * `subtotalKobo` is computed here from the *server's* current `price_kobo` for
 * each joined product. That is a display convenience, not an authority: the
 * order total is recalculated by `create-order`, which never trusts this value.
 * Prices are integer kobo throughout; nothing in this hook uses a float.
 *
 * ## Inventory
 *
 * Mutations clamp against the product's current `inventory` and fail with an
 * {@link InsufficientInventoryError} naming the product. That check is a courtesy
 * that stops a pointless round trip — `create-order` enforces it again, server
 * side, against the same rule, and that second check is the one that counts.
 *
 * ## Errors
 *
 * - Signed out: `status: 'idle'`, `cart: null`, `items: []`. No error, no query.
 *   Mutating methods reject with an `unauthenticated` AppError rather than
 *   silently doing nothing.
 * - Every other failure is `status: 'error'` with a normalised {@link AppError}.
 *   Mutations reject with the same error and also set `error`, so a caller can
 *   either await them or watch the state.
 */

import { useCallback, useMemo, useState } from 'react';
import { AppError, InsufficientInventoryError, toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { sumLineTotals } from '@/lib/money';
import { getSupabaseClient } from '@/lib/supabase';
import type { Cart, CartItemWithProduct, Product } from '@/lib/supabase.types';
import { type AsyncStatus, useAsyncResource } from './internal/useAsyncResource';
import { useAuth } from './useAuth';

/** Cart plus its joined items — the shape one fetch returns. */
interface CartSnapshot {
  cart: Cart;
  items: CartItemWithProduct[];
}

export interface CartState {
  /** The active cart row, or `null` when signed out or on error. */
  cart: Cart | null;
  /** Items with their product joined in. Never `null`; `[]` when empty. */
  items: CartItemWithProduct[];
  /** Sum of quantities. The number the rail badge shows. */
  itemCount: number;
  /** Display subtotal in integer kobo, from server prices. See the note above. */
  subtotalKobo: number;
  status: AsyncStatus;
  error: AppError | null;
  isLoading: boolean;
  /** True while any mutation is in flight, so a button can disable itself. */
  isMutating: boolean;
  refresh: () => Promise<void>;
  /**
   * Add `quantity` of `productId`, clamped to available inventory.
   * Adding a product already in the cart increases its quantity; a product never
   * appears twice in one cart (unique `(cart_id, product_id)`).
   */
  addItem: (productId: string, quantity?: number) => Promise<void>;
  /** Set an item's quantity. `0` (or less) removes the line. */
  setItemQuantity: (productId: string, quantity: number) => Promise<void>;
  /** Remove one line. No-op if the product is not in the cart. */
  removeItem: (productId: string) => Promise<void>;
  /** Empty the active cart without closing it. */
  clear: () => Promise<void>;
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

export function useCart(): CartState {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const userId = user?.id ?? null;

  const [isMutating, setIsMutating] = useState(false);

  const resource = useAsyncResource<CartSnapshot>(
    async () => {
      if (userId === null) {
        throw new AppError('unauthenticated', 'You need to sign in to use a cart.');
      }
      return loadOrCreateActiveCart(userId);
    },
    {
      enabled: isAuthenticated && userId !== null,
      logEvent: 'cart_loaded',
      logFields: { userId },
    },
  );

  /**
   * Read the product's live price and inventory. Every mutation re-reads it —
   * a cart line's inventory is a moving target, and a stale value from the join
   * would let an oversell through to the server.
   */
  const readProduct = useCallback(async (productId: string): Promise<Product> => {
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
  }, []);

  /**
   * Run a mutation with a consistent envelope: mark busy, surface failures on
   * `error` as well as by rejecting, refresh, and always clear busy.
   */
  const mutate = useCallback(
    async (event: string, run: (context: { cartId: string }) => Promise<void>): Promise<void> => {
      const currentCart = resource.data?.cart;
      if (currentCart === null || currentCart === undefined) {
        throw new AppError('unauthenticated', 'You need to sign in to change your cart.');
      }

      setIsMutating(true);
      const startedAt = Date.now();
      try {
        await run({ cartId: currentCart.id });
        await resource.refresh();
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
        throw error;
      } finally {
        setIsMutating(false);
      }
    },
    [resource, userId],
  );

  const addItem = useCallback(
    async (productId: string, quantity = 1): Promise<void> => {
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new AppError('validation', 'Choose a quantity of at least one.');
      }

      await mutate('cart_item_added', async ({ cartId }) => {
        const existingLine = resource.data?.items.find((item) => item.product_id === productId);
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
    },
    [mutate, readProduct, resource.data],
  );

  const setItemQuantity = useCallback(
    async (productId: string, quantity: number): Promise<void> => {
      await mutate('cart_item_updated', async ({ cartId }) => {
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
          throw new InsufficientInventoryError(
            `Only ${product.inventory} of ${product.name} left.`,
            { productId, available: product.inventory },
          );
        }

        const { error } = await getSupabaseClient()
          .from('cart_items')
          .update({ quantity })
          .eq('cart_id', cartId)
          .eq('product_id', productId);
        if (error) throw toAppError(error, 'Could not update that item');
      });
    },
    [mutate, readProduct],
  );

  const removeItem = useCallback(
    async (productId: string): Promise<void> => {
      await mutate('cart_item_removed', async ({ cartId }) => {
        const { error } = await getSupabaseClient()
          .from('cart_items')
          .delete()
          .eq('cart_id', cartId)
          .eq('product_id', productId);
        if (error) throw toAppError(error, 'Could not remove that item');
      });
    },
    [mutate],
  );

  const clear = useCallback(async (): Promise<void> => {
    await mutate('cart_cleared', async ({ cartId }) => {
      const { error } = await getSupabaseClient().from('cart_items').delete().eq('cart_id', cartId);
      if (error) throw toAppError(error, 'Could not empty your cart');
    });
  }, [mutate]);

  return useMemo<CartState>(() => {
    const items = resource.data?.items ?? [];
    return {
      cart: resource.data?.cart ?? null,
      items,
      itemCount: items.reduce((total, item) => total + item.quantity, 0),
      subtotalKobo: sumLineTotals(
        items.flatMap((item) =>
          item.product === null
            ? []
            : [{ quantity: item.quantity, unitPriceKobo: item.product.price_kobo }],
        ),
      ),
      // While the session is still being read, the cart is loading — not empty,
      // not broken. Collapsing those two states is what makes signed-in users see
      // an empty cart flash on every page load.
      status: authLoading && !isAuthenticated ? 'loading' : resource.status,
      error: resource.error,
      isLoading: authLoading || resource.isLoading,
      isMutating,
      refresh: resource.refresh,
      addItem,
      setItemQuantity,
      removeItem,
      clear,
    };
  }, [
    resource,
    authLoading,
    isAuthenticated,
    isMutating,
    addItem,
    setItemQuantity,
    removeItem,
    clear,
  ]);
}
