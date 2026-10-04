/**
 * MobileTabBar.
 *
 * PLAN 3: below 768px, a fixed five-item bottom tab bar — Store, Catalog,
 * About, Cart, Account — with safe-area padding.
 *
 * Five items at 375px is 75px each, comfortably past the 44px minimum, so there
 * is no scroll and no overflow menu. Every item is a real `<NavLink>`; the
 * active item is marked with weight and colour *and* `aria-current`, never by
 * colour alone.
 *
 * About points at the home page's `#about` section, the same target as the
 * desktop rail. The home page agent owns that section.
 */

import { Link, NavLink } from 'react-router-dom';
import { AccountIcon, CartIcon, GridIcon, InfoIcon, StoreIcon } from '@/components/icons';
import { useCart } from '@/hooks/useCart';

interface TabItem {
  to: string;
  label: string;
  icon: typeof StoreIcon;
  /** Match exactly, so `/shop?category=desk` does not light up Catalog twice. */
  end: boolean;
  /** Rendered as a plain Link rather than a NavLink — used for the hash target. */
  plain?: boolean;
}

const TABS: readonly TabItem[] = [
  { to: '/', label: 'Store', icon: StoreIcon, end: true },
  { to: '/shop', label: 'Catalog', icon: GridIcon, end: true },
  { to: '/#about', label: 'About', icon: InfoIcon, end: true, plain: true },
  { to: '/cart', label: 'Cart', icon: CartIcon, end: true },
  { to: '/account', label: 'Account', icon: AccountIcon, end: true },
];

const ITEM_CLASSES =
  'flex h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-component transition-kanso';

export function MobileTabBar() {
  const { itemCount } = useCart();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-hairline bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <div className="flex h-14 items-stretch justify-around px-2">
        {TABS.map((tab) => {
          const Glyph = tab.icon;
          const inner = (
            <>
              <span className="relative">
                <Glyph size={20} />
                {tab.to === '/cart' && itemCount > 0 ? (
                  <span className="absolute -right-1.5 -top-1 grid h-2 w-2 rounded-full border border-ink bg-accent" />
                ) : null}
              </span>
              <span className="text-[9px] uppercase tracking-wider">{tab.label}</span>
            </>
          );

          if (tab.plain === true) {
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={`${ITEM_CLASSES} text-ink-muted hover:text-ink`}
              >
                {inner}
              </Link>
            );
          }

          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `${ITEM_CLASSES} ${isActive ? 'font-bold text-ink' : 'text-ink-muted hover:text-ink'}`
              }
            >
              {inner}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
