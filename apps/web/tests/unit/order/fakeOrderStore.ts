/**
 * A stateful in-memory `OrderStore`.
 *
 * Not a spy: it holds products, carts and orders and really mutates them, so a
 * test can assert that stock went down and the cart closed without asserting
 * that a particular method was called. It also models the one property that
 * matters most about the real thing — `commitOrder` is atomic. The whole order
 * is assembled before anything is written, so a failure anywhere inside the
 * commit leaves the store exactly as it was, which is what lets a test say "a
 * failed checkout leaves no half-order".
 */

import { OrderError } from '../../../../../supabase/functions/_shared/order-error';
import type {
  ActiveCart,
  CartLine,
  CommitOrderInput,
  CommittedOrder,
  CommittedOrderItem,
  OrderStore,
} from '../../../../../supabase/functions/_shared/types';

export interface FakeProduct {
  id: string;
  slug: string;
  name: string;
  /** Integer kobo. */
  priceKobo: number;
  inventory: number;
}

export interface FakeCart {
  id: string;
  userId: string;
  status: 'active' | 'closed';
  closedAt: string | null;
  items: Array<{ productId: string; quantity: number }>;
}

export interface FakeOrder extends CommittedOrder {
  userId: string;
  cartId: string;
}

interface FakeShortfall {
  productId: string;
  productName: string;
  requested: number;
  available: number;
}

export class FakeOrderStore implements OrderStore {
  readonly products = new Map<string, FakeProduct>();
  readonly carts = new Map<string, FakeCart>();
  readonly orders: FakeOrder[] = [];

  /** Thrown by `commitOrder` before any effect is applied. */
  failCommitWith: Error | null = null;
  /** Thrown by `loadActiveCart` before anything is read. */
  failLoadWith: Error | null = null;

  private readonly userIdByToken = new Map<string, string>();
  private orderCounter = 0;

  readonly userId: string;

  constructor(userId: string = 'user-1') {
    this.userId = userId;
    this.userIdByToken.set('valid-token', userId);
  }

  /* ------------------------------------------------------------- fixtures */

  addProduct(product: FakeProduct): this {
    this.products.set(product.id, { ...product });
    return this;
  }

  addCart(cart: Omit<FakeCart, 'status' | 'closedAt'> & Partial<FakeCart>): this {
    this.carts.set(cart.id, {
      status: 'active',
      closedAt: null,
      ...cart,
      items: cart.items.map((item) => ({ ...item })),
    });
    return this;
  }

  inventoryOf(productId: string): number {
    const product = this.products.get(productId);
    if (product === undefined) throw new Error(`no such product: ${productId}`);
    return product.inventory;
  }

  cart(cartId: string): FakeCart {
    const cart = this.carts.get(cartId);
    if (cart === undefined) throw new Error(`no such cart: ${cartId}`);
    return cart;
  }

  /* ------------------------------------------------------------- the port */

  async resolveUserId(accessToken: string): Promise<string> {
    const userId = this.userIdByToken.get(accessToken);
    if (userId === undefined) {
      throw new OrderError('unauthenticated', 'You need to sign in to place an order.', {
        details: { reason: 'invalid_token' },
      });
    }
    return userId;
  }

  async loadActiveCart(userId: string): Promise<ActiveCart | null> {
    if (this.failLoadWith !== null) throw this.failLoadWith;

    const cart = [...this.carts.values()].find(
      (candidate) => candidate.userId === userId && candidate.status === 'active',
    );
    if (cart === undefined) return null;

    const lines: CartLine[] = cart.items.flatMap((item) => {
      const product = this.products.get(item.productId);
      if (product === undefined) return [];
      return [
        {
          productId: product.id,
          slug: product.slug,
          productName: product.name,
          quantity: item.quantity,
          unitPriceKobo: product.priceKobo,
          inventory: product.inventory,
        },
      ];
    });
    return { id: cart.id, lines };
  }

  /**
   * Assemble the whole order first, mutate second. That ordering is the point:
   * a throw above the mutation block cannot leave a partial order behind, which
   * is exactly the guarantee `create_order_atomic` gives against a real
   * database.
   */
  async commitOrder(input: CommitOrderInput): Promise<CommittedOrder> {
    if (this.failCommitWith !== null) throw this.failCommitWith;

    const cart = this.carts.get(input.cartId);
    if (cart === undefined || cart.userId !== input.userId || cart.status !== 'active') {
      throw new OrderError('validation', 'Your cart is no longer available.', {
        details: { reason: 'cart_not_active' },
      });
    }
    if (cart.items.length === 0) {
      throw new OrderError('validation', 'Your cart is empty.', {
        details: { reason: 'cart_empty' },
      });
    }

    const committed: CommittedOrderItem[] = [];
    const shortfalls: FakeShortfall[] = [];
    let totalKobo = 0;

    for (const line of cart.items) {
      const product = this.products.get(line.productId);
      if (product === undefined) {
        throw new OrderError('validation', 'A product in your cart no longer exists.', {
          details: { reason: 'unknown_product', productId: line.productId },
        });
      }
      if (product.inventory < line.quantity) {
        shortfalls.push({
          productId: product.id,
          productName: product.name,
          requested: line.quantity,
          available: product.inventory,
        });
        continue;
      }
      committed.push({
        productId: product.id,
        productName: product.name,
        quantity: line.quantity,
        unitPriceKobo: product.priceKobo,
      });
      totalKobo += product.priceKobo * line.quantity;
    }

    const shortfall = shortfalls[0];
    if (shortfall !== undefined) {
      throw new OrderError(
        'insufficient_inventory',
        `Only ${shortfall.available} of ${shortfall.productName} left in stock.`,
        { status: 409, details: { ...shortfall } },
      );
    }

    const sequence = this.orderCounter;
    this.orderCounter += 1;
    const order: FakeOrder = {
      id: `order-${sequence + 1}`,
      reference: nextReference(sequence),
      userId: input.userId,
      cartId: input.cartId,
      status: 'confirmed',
      subtotalKobo: totalKobo,
      totalKobo,
      createdAt: '2026-10-02T09:00:00.000Z',
      items: committed,
    };

    // --- the transaction begins here: nothing above this line has written ---
    for (const line of committed) {
      const product = this.products.get(line.productId);
      if (product !== undefined) product.inventory -= line.quantity;
    }
    cart.status = 'closed';
    cart.closedAt = order.createdAt;
    this.orders.push(order);

    return {
      id: order.id,
      reference: order.reference,
      status: order.status,
      subtotalKobo: order.subtotalKobo,
      totalKobo: order.totalKobo,
      createdAt: order.createdAt,
      items: order.items,
    };
  }
}

/** `KS-8902-DX` — the shape DESIGN.md and the email template both use. */
function nextReference(sequence: number): string {
  const digits = String(1000 + sequence).slice(-4);
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const first = letters[(sequence * 7) % letters.length] ?? 'K';
  const second = letters[(sequence * 13) % letters.length] ?? 'S';
  return `KS-${digits}-${first}${second}`;
}
