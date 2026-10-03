/**
 * The frozen route table.
 *
 * FROZEN CONTRACT SURFACE. PLAN 3 fixes these paths; six agents code against
 * them in parallel and a route that moves under one of them is a merge conflict
 * nobody can resolve cleanly.
 *
 * | Path               | Page module                                | Surface |
 * | ------------------ | ------------------------------------------ | ------- |
 * | `/`                | `src/pages/home/HomePage`                 | A4 |
 * | `/shop`            | `src/pages/catalog/CatalogPage`            | A4 |
 * | `/shop?category=`  | same page, filtered by the query param     | A4 |
 * | `/product/:slug`   | `src/pages/product/ProductPage`            | A4 |
 * | `/cart`            | `src/pages/cart/CartPage`                  | A5 |
 * | `/checkout`        | `src/pages/checkout/CheckoutPage`          | A5 |
 * | `/order/:id`       | `src/pages/order-confirmation/…`           | A5 |
 * | `/account`         | `src/pages/account/AccountPage`            | A6 |
 * | `/auth/callback`   | `src/pages/auth/AuthCallbackPage`          | A6 |
 * | `*`                | `src/pages/not-found/NotFoundPage`         | Foundation |
 *
 * Every one of those modules is a real page. If you genuinely need a different
 * path, a nested layout, or a route guard wrapper, write it in
 * `docs/CONTRACT-REQUESTS.md` and keep building against what is here.
 *
 * ## Three decisions worth knowing
 *
 * - **Category is a query param, not a path segment.** `/shop?category=desk`
 *   keeps one catalogue component, makes a filtered view shareable, and makes
 *   the back button correct without any history bookkeeping.
 * - **There is no `/about` route.** The rail and the tab bar both point ABOUT at
 *   the home page's `#about` brand statement. If you build the home page, give
 *   that section `id="about"`; both nav entries then work for free.
 * - **No layout route.** Each page renders its own `<PageShell>`, so it can pass
 *   its own mobile header. The shell, not this file, owns the responsive switch.
 *
 * ## Why there is no JSX in this file
 *
 * The table stays `.ts` because that is the frozen path six agents were told to
 * expect, and the import specifier is `@/routes` either way. Nine
 * `createElement` calls are the entire cost of keeping it.
 */

import { createElement, type ReactElement } from 'react';
import type { RouteObject } from 'react-router-dom';
import { AccountPage } from './pages/account/AccountPage';
import { AuthCallbackPage } from './pages/auth/AuthCallbackPage';
import { CartPage } from './pages/cart/CartPage';
import { CatalogPage } from './pages/catalog/CatalogPage';
import { CheckoutPage } from './pages/checkout/CheckoutPage';
import { HomePage } from './pages/home/HomePage';
import { NotFoundPage } from './pages/not-found/NotFoundPage';
import { OrderConfirmationPage } from './pages/order-confirmation/OrderConfirmationPage';
import { ProductPage } from './pages/product/ProductPage';

/**
 * Catch-all content, for a URL that matches no route.
 *
 * Not part of the frozen table, and deliberately so: without it a mistyped or
 * stale URL renders nothing at all, which is exactly the silent failure SPEC
 * forbids. It renders `NotFoundPage`, which says the page does not exist and
 * offers the way back — never anything about what we are still building.
 */
function NotFound(): ReactElement {
  return createElement(NotFoundPage);
}

/**
 * Passed straight to `createBrowserRouter` in `src/main.tsx`.
 *
 * Kept last because it matches everything: React Router scores routes by
 * specificity and falls back to this one.
 */
export const routes: RouteObject[] = [
  { path: '/', element: createElement(HomePage) },
  { path: '/shop', element: createElement(CatalogPage) },
  { path: '/product/:slug', element: createElement(ProductPage) },
  { path: '/cart', element: createElement(CartPage) },
  { path: '/checkout', element: createElement(CheckoutPage) },
  { path: '/order/:id', element: createElement(OrderConfirmationPage) },
  { path: '/account', element: createElement(AccountPage) },
  { path: '/auth/callback', element: createElement(AuthCallbackPage) },
  { path: '*', element: createElement(NotFound) },
];

/** Every path the app serves, for reference. Query params are not paths. */
export const ROUTE_PATHS = {
  home: '/',
  catalog: '/shop',
  product: (slug: string) => `/product/${slug}`,
  cart: '/cart',
  checkout: '/checkout',
  order: (id: string) => `/order/${id}`,
  account: '/account',
  authCallback: '/auth/callback',
  about: '/#about',
} as const;

/** Query param the catalogue filter is read from and written to. */
export const CATEGORY_PARAM = 'category';
