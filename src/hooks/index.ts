/**
 * Barrel for `src/hooks`. Import from `@/hooks` everywhere.
 *
 * Every hook here is a frozen contract (see `docs/CONTRACTS.md`). They all share
 * one shape so a page never has to special-case one:
 *
 *   data     the last successful value, or a neutral empty value
 *   status   'idle' | 'loading' | 'success' | 'error'
 *   error    a normalised AppError, or null
 *   isLoading true while a request is in flight, including the first
 *   refresh  re-run the read
 *
 * `useAsyncResource` is deliberately **not** exported: it is the internal
 * primitive, and its semantics are only guaranteed through the hooks above.
 */

export type { AsyncStatus } from './internal/useAsyncResource';
export {
  AuthProvider,
  type AuthState,
  type AuthStatus,
  useAuth,
  useUserId,
} from './useAuth';
export {
  type CartState,
  useCart,
} from './useCart';
export { type OrderSnapshot, type OrderState, type UseOrderOptions, useOrder } from './useOrder';
export { type OrderSummary, type OrdersState, useOrders } from './useOrders';
export { type ProductState, type UseProductOptions, useProduct } from './useProduct';
export {
  CATEGORIES,
  categoryLabel,
  type ProductCategoryFilter,
  type ProductsState,
  type UseProductsOptions,
  useProducts,
} from './useProducts';
