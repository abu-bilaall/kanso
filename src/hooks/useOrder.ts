/**
 * `useOrder` — one order, with its line items.
 *
 * Used by the confirmation screen after checkout and by the account's order
 * history. The route is `/order/:id` and `:id` is the order's **uuid**, not its
 * human-facing reference.
 *
 * ## Ownership
 *
 * The query filters on `user_id` as well as `id`. Row Level Security already
 * enforces that a user cannot read another user's order (SPEC, "Row Level
 * Security"); repeating the filter in the query is defence in depth, not a
 * substitute. A miss is reported as `not_found` rather than `forbidden`, so the
 * UI cannot be used to probe which order ids exist.
 *
 * ## Totals
 *
 * `order.total_kobo` and `order_item.unit_price_kobo` are server-computed
 * snapshots. This hook never recomputes them — a historical order must show what
 * was actually paid, not what the catalogue charges today.
 */

import { useMemo } from 'react';
import { AppError, toAppError } from '@/lib/errors';
import { getSupabaseClient } from '@/lib/supabase';
import type { Order, OrderItemWithProduct } from '@/lib/supabase.types';
import { type AsyncStatus, useAsyncResource } from './internal/useAsyncResource';
import { useAuth } from './useAuth';

/** An order plus its items — the shape one fetch returns. */
export interface OrderSnapshot {
  order: Order;
  items: OrderItemWithProduct[];
}

export interface UseOrderOptions {
  /** Skip the query. Defaults to `true` only when an id and a session exist. */
  enabled?: boolean;
}

export interface OrderState {
  order: Order | null;
  /** Snapshot lines. `[]` when the order has not loaded or does not exist. */
  items: OrderItemWithProduct[];
  status: AsyncStatus;
  error: AppError | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useOrder(id: string | undefined, options: UseOrderOptions = {}): OrderState {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = options.enabled ?? (id !== undefined && id.length > 0 && userId !== null);

  const resource = useAsyncResource<OrderSnapshot>(
    async () => {
      if (id === undefined || userId === null) {
        throw new AppError('not_found', 'That order could not be found.');
      }

      const client = getSupabaseClient();

      const { data: order, error: orderError } = await client
        .from('orders')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();

      if (orderError) throw toAppError(orderError, 'Could not load that order');
      if (order === null) {
        throw new AppError('not_found', 'We could not find that order.', {
          details: { orderId: id },
        });
      }

      const { data: items, error: itemsError } = await client
        .from('order_items')
        .select('*, product:products(id, slug, name)')
        .eq('order_id', order.id)
        .order('created_at', { ascending: true });

      if (itemsError) throw toAppError(itemsError, 'Could not load that order');
      return { order, items: items ?? [] };
    },
    { enabled, logEvent: 'order_loaded', logFields: { orderId: id } },
  );

  return useMemo(
    () => ({
      order: resource.data?.order ?? null,
      items: resource.data?.items ?? [],
      status: resource.status,
      error: resource.error,
      isLoading: resource.isLoading,
      refresh: resource.refresh,
    }),
    [resource],
  );
}
