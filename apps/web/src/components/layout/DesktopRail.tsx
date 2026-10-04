/**
 * DesktopRail.
 *
 * The persistent left navigation: a fixed 160px column beside the content
 * (DESIGN.md "persistent left navigation rail (~160px)"), present at and above
 * the 768px breakpoint.
 *
 * Structure, top to bottom, exactly as DESIGN.md lists it:
 *   KANSO (wordmark, links home)
 *   SHOP
 *     All / Desk / Carry / Write
 *   ABOUT
 *   CART (with an item-count badge)
 *   ACCOUNT
 *
 * The Stitch prototype draws this `w-48` (192px); DESIGN.md and the Phase 1 brief
 * both fix it at 160px, which is the value in `--k-rail-width`. Nothing else
 * about the rail is literal: the wordmark is text, not the prototype's raster,
 * because the vectorised logo lands later.
 *
 * ABOUT is the one entry with no route of its own — the frozen route table has
 * no `/about`. It points at the home page's brand-statement section, `#about`,
 * which the home page agent owns. See docs/CONTRACTS.md.
 */

import { Link, NavLink } from 'react-router-dom';
import { BagIcon } from '@/components/icons';
import { useCart } from '@/hooks/useCart';

interface RailLinkProps {
  to: string;
  label: string;
  /** Match exactly (`end`) or as a prefix. */
  end?: boolean;
}

function RailLink({ to, label, end = false }: RailLinkProps) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          'font-label uppercase tracking-[0.06em] transition-kanso py-1',
          isActive ? 'font-bold text-ink' : 'text-ink-muted hover:translate-x-1 hover:text-ink',
        ].join(' ')
      }
    >
      {label}
    </NavLink>
  );
}

/**
 * The category sub-navigation. `All` is a plain `/shop`; the rest carry the
 * `category` query param, which is what makes a filtered catalogue shareable and
 * back-button correct (PLAN 5, A4).
 */
function CategoryLink({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          'font-editorial text-meta uppercase leading-5 tracking-wider transition-kanso',
          isActive ? 'font-bold text-ink' : 'text-ink-muted hover:translate-x-1 hover:text-ink',
        ].join(' ')
      }
    >
      {label}
    </NavLink>
  );
}

function CartBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="grid h-5 min-w-5 place-items-center rounded-full border-hard border-ink bg-accent px-1 font-editorial text-[10px] font-bold leading-none text-ink-on-accent">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function DesktopRail() {
  const { itemCount } = useCart();

  return (
    <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:z-50 md:flex md:w-k-rail md:flex-col md:justify-between md:border-r-2 md:border-ink md:bg-paper md:p-k-md">
      <div className="flex flex-col gap-k-lg">
        <div className="pt-k-xs">
          <Link
            to="/"
            className="font-display text-xl uppercase leading-none tracking-[0.18em] text-ink"
            aria-label="Kanso — home"
          >
            KANSO
          </Link>
        </div>

        <nav aria-label="Primary" className="flex flex-col gap-k-md">
          <div className="flex flex-col gap-k-xs">
            <RailLink to="/shop" label="Shop" end />
            <div className="flex flex-col gap-1 border-l border-hairline pl-k-sm">
              <CategoryLink to="/shop" label="All" end />
              <CategoryLink to="/shop?category=desk" label="Desk" />
              <CategoryLink to="/shop?category=carry" label="Carry" />
              <CategoryLink to="/shop?category=write" label="Write" />
            </div>
          </div>

          {/* Plain Link, not NavLink: the target is a hash on `/`, which NavLink
              would report as active for the whole home page and light up
              alongside the Store entry. */}
          <Link
            to="/#about"
            className="py-1 font-label uppercase tracking-[0.06em] text-ink-muted transition-kanso hover:translate-x-1 hover:text-ink"
          >
            About
          </Link>

          <NavLink
            to="/cart"
            className={({ isActive }) =>
              [
                'flex items-center justify-between gap-2 py-1 font-label uppercase tracking-[0.06em] transition-kanso',
                isActive
                  ? 'font-bold text-ink'
                  : 'text-ink-muted hover:translate-x-1 hover:text-ink',
              ].join(' ')
            }
          >
            <span className="flex items-center gap-2">
              <BagIcon size={16} />
              Cart
            </span>
            <CartBadge count={itemCount} />
          </NavLink>

          <RailLink to="/account" label="Account" end />
        </nav>
      </div>

      {/* The Stitch prototypes close the rail with a status strip. It is kept as
          text, never as a live signal: a dot that animates forever is decoration
          and DESIGN.md says motion must communicate state. */}
      <div className="flex flex-col gap-k-xs border-t border-hairline pt-k-md font-editorial text-[10px] uppercase tracking-tight text-ink-subtle">
        <span>Kanso — Tools for focus</span>
        <span>Lagos / Worldwide</span>
      </div>
    </aside>
  );
}
