/**
 * `useCart` — the signed-in user's active cart, with every mutation the UI needs.
 *
 * ## What it owns
 *
 * A Kanso user has at most one *active* cart (PLAN 4, A1's partial unique index).
 * The hook resolves it lazily: for an authenticated user it reads the active
 * cart and, if none exists, creates one. Anonymous visitors get an empty cart
 * in memory and are not asked to sign in until checkout — which is the journey
 * DESIGN.md describes.
 *
 * ## One cart, not one per call site
 *
 * The rail, the mobile header, the tab bar and the page under them all call this
 * hook. They used to get a private copy each — four fetches, four badges, and a
 * badge that kept showing the pre-checkout count on the confirmation screen.
 * They now share one store (`internal/cartStore`): one fetch however many
 * consumers are mounted, and a mutation in any of them is visible in all of
 * them on the next paint, with no manual refresh.
 *
 * The public shape below is unchanged by that, and is the contract in
 * `docs/CONTRACTS.md`.
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
 * - A failed read is `status: 'error'` with a normalised {@link AppError}.
 * - A failed mutation rejects with the same error and leaves the read state
 *   alone, so a caller can either await it or watch `isMutating`; the caller
 *   surfaces the rejection on the row that caused it.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { AppError } from '@/lib/errors';
import { sumLineTotals } from '@/lib/money';
import type { Cart, CartItemWithProduct } from '@/lib/supabase.types';
import {
  addCartItem,
  type CartSnapshot,
  clearCart,
  getCartStoreState,
  refreshCart,
  removeCartItem,
  selectCart,
  setCartItemQuantity,
  subscribeToCartStore,
} from './internal/cartStore';
import type { AsyncStatus } from './internal/useAsyncResource';
import { useAuth } from './useAuth';

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

export function useCart(): CartState {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const userId = user?.id ?? null;

  const store = useSyncExternalStore(subscribeToCartStore, getCartStoreState);

  // Idempotent, and shared: the second and third consumer to mount join the
  // first one's request rather than starting another.
  useEffect(() => {
    if (userId === null) return;
    void selectCart(userId);
  }, [userId]);

  const refresh = useCallback(() => refreshCart(), []);
  const addItem = useCallback(
    (productId: string, quantity = 1) => addCartItem(userId, productId, quantity),
    [userId],
  );
  const setItemQuantity = useCallback(
    (productId: string, quantity: number) => setCartItemQuantity(userId, productId, quantity),
    [userId],
  );
  const removeItem = useCallback(
    (productId: string) => removeCartItem(userId, productId),
    [userId],
  );
  const clear = useCallback(() => clearCart(userId), [userId]);

  return useMemo<CartState>(() => {
    const signedIn = isAuthenticated && userId !== null;

    // Signed out, the store's contents are not this visitor's to read. The
    // contract's promise — an empty cart and no prompt — is kept by ignoring
    // them rather than by trusting them to be gone.
    const snapshot: CartSnapshot | null = signedIn ? store.data : null;
    const items = snapshot?.items ?? [];

    // While the session is still being read, the cart is loading — not empty,
    // not broken. Collapsing those two states is what makes signed-in users see
    // an empty cart flash on every page load. The same holds in the frame
    // between auth settling and the store being pointed at this user.
    const status: AsyncStatus = !signedIn
      ? authLoading
        ? 'loading'
        : 'idle'
      : store.userId === userId
        ? store.status
        : 'loading';

    return {
      cart: snapshot?.cart ?? null,
      items,
      itemCount: items.reduce((total, item) => total + item.quantity, 0),
      subtotalKobo: sumLineTotals(
        items.flatMap((item) =>
          item.product === null
            ? []
            : [{ quantity: item.quantity, unitPriceKobo: item.product.price_kobo }],
        ),
      ),
      status,
      error: signedIn ? store.error : null,
      isLoading: status === 'loading',
      isMutating: signedIn && store.isMutating,
      refresh,
      addItem,
      setItemQuantity,
      removeItem,
      clear,
    };
  }, [
    store,
    isAuthenticated,
    userId,
    authLoading,
    refresh,
    addItem,
    setItemQuantity,
    removeItem,
    clear,
  ]);
}
