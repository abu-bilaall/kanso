/**
 * Application entry point.
 *
 * Provider order matters and is the whole of it:
 *
 *   1. `StrictMode` — double-invokes effects in development, which is how the
 *      hooks' abort-on-supersede logic gets exercised before it matters.
 *   2. `AuthProvider` — outside the router, because nothing in it uses a router
 *      hook and every hook in the tree may want the session.
 *   3. `RouterProvider` — the frozen route table from `src/routes.ts`.
 *
 * The page frame (`PageShell`) is rendered by each page rather than here, so a
 * page can supply its own mobile header. That is why there is no layout route in
 * the table and why there is no `<App>` component.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/hooks';
import { routes } from '@/routes';
import '@/styles/index.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Kanso could not start: #root is missing from index.html.');
}

const router = createBrowserRouter(routes);

createRoot(container).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
