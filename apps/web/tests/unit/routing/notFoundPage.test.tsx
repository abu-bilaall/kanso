/**
 * `/no-such-page`.
 *
 * The catch-all route rendered the shared `Placeholder`, so a mistyped URL told
 * a stranger "Not built yet" and "Owned by nobody — it is not a real surface":
 * the build's own state, in the build's own voice, on a storefront. The route
 * itself was always right — a blank screen on a bad URL is worse — so what is
 * pinned here is *what* it renders.
 *
 * The assertions run through the real route table rather than against the page
 * module directly, because the wiring is half of the defect: a `*` route pointed
 * at the wrong component would pass any test that renders the page in isolation.
 */

import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { routes } from '@/routes';

/** Build state leaks. None of it is a customer's business. */
const SCAFFOLDING_COPY = /not built|owned by|placeholder|not implemented|todo/i;

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('the not-found route', () => {
  it('says the page does not exist', () => {
    renderAt('/no-such-page');
    expect(
      screen.getByRole('heading', { level: 1, name: /this page does not exist/i }),
    ).toBeInTheDocument();
  });

  it('offers a way back into the shop', () => {
    renderAt('/no-such-page');
    expect(screen.getByRole('link', { name: /browse the catalogue/i })).toHaveAttribute(
      'href',
      '/shop',
    );
    expect(screen.getByRole('link', { name: /back to the store/i })).toHaveAttribute('href', '/');
  });

  it('shows the visitor nothing about what is still being built', () => {
    const { container } = renderAt('/no-such-page');
    expect(container.textContent ?? '').not.toMatch(SCAFFOLDING_COPY);
  });

  it('catches a stale nested path, not only a top-level typo', () => {
    renderAt('/shop/steel-rule/extra');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/does not exist/i);
  });
});
