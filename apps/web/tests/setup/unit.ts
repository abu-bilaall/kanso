/**
 * Unit test setup.
 *
 * Unit tests run in jsdom with **no Docker and no database**. Three things are
 * stubbed here so that every suite can assume them:
 *
 *   1. `matchMedia` — jsdom does not implement it, and the UI reads it for
 *      `prefers-reduced-motion`. The stub is complete enough to subscribe to.
 *   2. `scrollTo` — the router calls it on navigation.
 *   3. The logger is silenced, so a suite's output is its assertions rather than
 *      thirty JSON lines. The one test that cares about logging turns it back
 *      on for itself.
 *
 * Nothing here touches Supabase. Hook tests mock `@/lib/supabase` themselves;
 * mocking it centrally would hide the module contract the tests exist to pin.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { logger } from '@/lib/logger';

logger.setLevel('silent');

afterEach(() => {
  cleanup();
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList,
});

window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
