/**
 * PageShell.
 *
 * The one place the responsive switch happens, and the frame every route renders
 * inside. A page supplies its content; the shell supplies the skip link, the
 * rail or the mobile header, the tab bar, the gutters and the safe-area insets.
 * No page has to think about any of that.
 *
 * The switch, from PLAN 3:
 *
 *   >= 768px (Tailwind `md`)   fixed 160px rail on the left, no mobile chrome,
 *                              content offset by `--k-rail-width`
 *   <  768px                  sticky header on top, fixed 5-item tab bar at the
 *                              bottom, 16px gutters, content padded clear of both
 *
 * ## Props
 *
 * - `title` sets `document.title`. Pass the page's own name; the shell appends
 *   nothing, because a storefront does not shout its brand in every tab.
 * - `header` replaces the default mobile header — product detail and checkout
 *   need a back control. Below 768px only; above it the rail is the navigation.
 * - `width` caps the content column. Product and checkout pages are narrower than
 *   the catalogue; this is how, without each page inventing a max-width.
 *
 * ## Accessibility
 *
 * The skip link is not decoration. With a fixed rail on the left and a fixed tab
 * bar at the bottom, it is the difference between one Tab press and nine. The
 * `<main>` takes `tabIndex={-1}` so receiving focus does not also ring every
 * descendant on some browsers.
 */

import { type ReactNode, useEffect } from 'react';
import { DesktopRail } from './DesktopRail';
import { MobileHeader } from './MobileHeader';
import { MobileTabBar } from './MobileTabBar';

export type PageWidth = 'narrow' | 'default' | 'wide';

export interface PageShellProps {
  children: ReactNode;
  /** Page name, used for `document.title`. */
  title?: string;
  /** Replaces the default mobile header for this page. */
  header?: ReactNode;
  width?: PageWidth;
}

const WIDTH_CLASSES: Record<PageWidth, string> = {
  narrow: 'max-w-2xl',
  default: 'max-w-5xl',
  wide: 'max-w-7xl',
};

export function PageShell({ children, title, header, width = 'default' }: PageShellProps) {
  useEffect(() => {
    if (title === undefined) return;
    document.title = title;
  }, [title]);

  return (
    <div className="min-h-screen bg-paper text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-component focus:border-hard focus:border-ink focus:bg-accent focus:px-3 focus:py-2 focus:font-label focus:uppercase focus:tracking-[0.06em] focus:text-ink-on-accent"
      >
        Skip to content
      </a>

      <DesktopRail />

      {header ?? (
        <div className="md:hidden">
          <MobileHeader />
        </div>
      )}

      {/* Content clears the fixed rail on desktop, and the sticky header plus the
          fixed tab bar on mobile. The mobile bottom inset is the tab bar's height
          plus its safe-area padding; `env()` resolves to 0 where there is no
          inset, so the same value is safe everywhere. */}
      <div className="md:pl-k-rail">
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full px-k-gutter pb-[calc(var(--k-tabbar-height)+env(safe-area-inset-bottom)+var(--k-space-xl))] pt-k-md focus:outline-none md:px-k-gutter-desktop md:pb-k-xl md:pt-k-lg"
        >
          <div className={`mx-auto flex w-full flex-col gap-k-lg ${WIDTH_CLASSES[width]}`}>
            {children}
          </div>
        </main>
      </div>

      <MobileTabBar />
    </div>
  );
}
