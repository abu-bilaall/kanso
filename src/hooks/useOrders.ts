/**
 * `useOrders` — the signed-in user's order history, newest first.
 *
 * Backs the account page. Item counts are fetched alongside each order in the
 * same round trip (`order_items(count)`), so a history list never needs N
 * follow-up queries.
 *
 * Signed out, this is `status: 'idle'` with an empty list and no error — the
 * account page shows a sign-in prompt instead of an error panel.
 */

import { useMemo } from 'react';
import { AppError, toAppError } from '@/lib/errors';
import { getSupabaseClient } from '@/lib/supabase';
import type { Order } from '@/lib/supabase.types';
import { type AsyncStatus, useAsyncResource } from './internal/useAsyncResource';
import { useAuth } from './useAuth';

/** An order plus the number of line items on it. */
export interface OrderSummary extends Order {
  itemCount: number;
}

export interface OrdersState {
  /** Newest first. `[]` while loading, signed out, or with no history. */
  orders: OrderSummary[];
  status: AsyncStatus;
  error: AppError | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useOrders(): OrdersState {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const resource = useAsyncResource<OrderSummary[]>(
    async () => {
      if (userId === null) {
        throw new AppError('unauthenticated', 'You need to sign in to see your orders.');
      }

      const { data, error } = await getSupabaseClient()
        .from('orders')
        .select('*, order_items(count)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw toAppError(error, 'Could not load your orders');

      return (data ?? []).map((row) => {
        const count =
          (row as { order_items?: Array<{ count: number }> }).order_items?.[0]?.count ?? 0;
        const { order_items: _ignored, ...order } = row as Order & {
          order_items?: Array<{ count: number }>;
        };
        return { ...order, itemCount: count };
      });
    },
    { enabled: userId !== null, logEvent: 'orders_loaded', logFields: { userId } },
  );

  return useMemo(
    () => ({
      orders: resource.data ?? [],
      status: resource.status,
      error: resource.error,
      isLoading: resource.isLoading,
      refresh: resource.refresh,
    }),
    [resource],
  );
}
