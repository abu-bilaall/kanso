/**
 * `/` — the storefront.
 *
 * Structure follows `stitch-designs/kanso_storefront/code.html`: a technical
 * meta strip, the hero, a flagship object, the three divisions, a curated strip,
 * and the brand statement. What is different is that every number on this page
 * comes from the catalogue instead of the prototype's hard-coded copy — the
 * object count, the flagship, the per-division thumbnails.
 *
 * ## The `#about` contract
 *
 * There is no `/about` route. The desktop rail and the mobile tab bar both point
 * ABOUT at `/#about`, which makes **this page** the about page (see
 * `docs/CONTRACTS.md`). The brand statement therefore carries `id="about"`, and
 * {@link useAboutAnchor} resolves the fragment on arrival — a client-rendered app
 * cannot rely on the browser to find an element that did not exist when it
 * scanned the URL.
 *
 * ## Loading, empty, failed
 *
 * All three are first-class here, because during development this page mostly
 * *is* those three states: the catalogue is written in parallel with this UI. A
 * failed read is reported once, in the flagship section, with a retry; the
 * divisions still render, because they are part of the brand and their links
 * work whether or not anything is currently in stock.
 */

import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowForwardIcon } from '@/components/icons';
import { PageShell } from '@/components/layout';
import { ProductImage } from '@/components/media/ProductImage';
import { ProductGrid } from '@/components/product/ProductGrid';
import { StockBadge } from '@/components/product/StockBadge';
import { Badge, buttonClasses, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { selectFeatured } from '@/features/catalog/sorting';
import { useProducts } from '@/hooks';
import { categoryLabel } from '@/hooks/useProducts';
import { formatMoney } from '@/lib/money';
import { PRODUCT_CATEGORIES, type ProductCategory } from '@/lib/supabase.types';
import { ROUTE_PATHS } from '@/routes';

/** What both navs point ABOUT at. `ROUTE_PATHS.about` is `/#about`. */
const ABOUT_SECTION_ID = 'about';
const ABOUT_HASH = '#about';

/** The four objects Stitch's curated strip shows. */
const CURATED_COUNT = 4;

/** One line per division. Brand copy, not catalogue data. */
const DIVISION_NOTES: Readonly<Record<ProductCategory, string>> = {
  desk: 'Heavy desktop infrastructure to structure open surface area and arrest visual clutter.',
  carry: 'Zero-redundancy envelopes, sleeves and wraps designed for disciplined transit.',
  write: 'High-mass marking devices and acid-free paper, calibrated for clear ideation.',
};

/**
 * Scrolls to the brand statement when the URL arrives on `/#about`.
 *
 * Runs on mount and on every hash change, so ABOUT works from the tab bar while
 * the visitor is already on the home page, not only on a cold load. Honours
 * `prefers-reduced-motion`, which `tokens.css` handles for CSS but not for this
 * scripted scroll.
 */
function useAboutAnchor(): void {
  const { hash } = useLocation();

  useEffect(() => {
    if (hash !== ABOUT_HASH) return;
    const target = document.getElementById(ABOUT_SECTION_ID);
    if (target === null) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  }, [hash]);
}

function SectionHeading({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-hairline pb-3">
      <div>
        <p className="font-editorial text-[10px] uppercase tracking-widest text-ink-subtle">
          {kicker}
        </p>
        <h2 className="font-display text-heading uppercase leading-none tracking-tight text-ink">
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

export function HomePage() {
  useAboutAnchor();

  const { products, status, error, isLoading, refresh } = useProducts();
  const featured = selectFeatured(products);
  const failed = status === 'error' && error !== null;

  return (
    <PageShell title="Kanso — tools for focused work" width="wide">
      {/* Meta strip. The count is printed only once the catalogue has actually
          answered, so the strip never claims a number it does not have. */}
      <div className="flex flex-col gap-1 border-b border-hairline pb-4 font-editorial text-[10px] uppercase tracking-widest text-ink-subtle sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
          Lagos / worldwide — tools for focused work
        </p>
        <p>
          {status === 'success' ? `${products.length} objects in the catalogue` : null}
          {status === 'loading' ? 'Reading the catalogue' : null}
        </p>
      </div>

      {/* Hero */}
      <section className="rounded-component bg-surface-low p-6 md:p-10">
        <div className="flex max-w-3xl flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="accent">Desk · Carry · Write</Badge>
            <span className="font-editorial text-[10px] uppercase tracking-widest text-ink-muted">
              One collection · small runs
            </span>
          </div>

          <h1 className="font-display text-heading uppercase leading-none tracking-tight text-ink md:text-hero">
            Instruments designed for daily focus.
          </h1>

          <p className="max-w-2xl text-body-lg text-ink-muted">
            A catalogue of stripped, dense objects engineered to decelerate thought and anchor
            presence. Milled metal, waxed canvas, technical felt. No decorative noise.
          </p>

          <div className="flex flex-col gap-2 pt-2 sm:flex-row">
            <Link
              to={ROUTE_PATHS.catalog}
              className={`${buttonClasses({ variant: 'primary', size: 'lg', fullWidth: true })} sm:w-auto`}
            >
              Shop the catalogue
              <ArrowForwardIcon size={18} />
            </Link>
            {/* A plain anchor, not a Link: this is a fragment inside this page,
                and the browser scrolls to it for free. */}
            <a
              href={ABOUT_HASH}
              className={`${buttonClasses({ variant: 'outline', size: 'lg', fullWidth: true })} sm:w-auto`}
            >
              Our approach
            </a>
          </div>
        </div>
      </section>

      {/* Flagship object */}
      <section className="mt-10">
        <SectionHeading kicker="Flagship / object 01" title="Core apparatus">
          {featured === null ? null : (
            <span className="font-editorial text-[10px] uppercase tracking-widest text-ink-subtle">
              Ref / {featured.slug}
            </span>
          )}
        </SectionHeading>

        {isLoading ? (
          <Skeleton className="h-80 w-full" label="Loading the flagship object" />
        ) : failed ? (
          <ErrorState
            title="The catalogue did not load"
            error={error}
            onRetry={() => void refresh()}
            retrying={isLoading}
          />
        ) : featured === null ? (
          <EmptyState
            title="The catalogue is being restocked"
            description="There is nothing to show yet. The divisions below are still worth a look, and everything else will be back shortly."
            action={
              <Link
                to={ROUTE_PATHS.catalog}
                className={buttonClasses({ variant: 'outline', size: 'sm' })}
              >
                Open the catalogue
              </Link>
            }
          />
        ) : (
          <article className="grid gap-4 rounded-component border-hard border-ink bg-surface-lowest lg:grid-cols-12">
            <div className="lg:col-span-7">
              <ProductImage
                slug={featured.slug}
                ratio="4x3"
                sizes="(min-width: 768px) 58vw, 100vw"
                priority
                className="h-full rounded-component"
              />
            </div>

            <div className="flex flex-col gap-3 p-6 lg:col-span-5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-editorial text-[10px] uppercase tracking-widest text-ink-subtle">
                  {categoryLabel(featured.category)}
                </span>
                <StockBadge inventory={featured.inventory} />
              </div>

              <h3 className="font-display text-heading uppercase leading-none tracking-tight text-ink">
                {featured.name}
              </h3>

              <p className="font-editorial text-xl font-bold tabular-nums text-ink">
                {formatMoney(featured.price_kobo)}
              </p>

              {featured.spec_line === null ? null : (
                <p className="font-editorial text-[11px] uppercase leading-5 tracking-wider text-ink-muted">
                  {featured.spec_line}
                </p>
              )}

              {featured.description === null ? null : (
                <p className="text-body text-ink-muted">{featured.description}</p>
              )}

              <Link
                to={ROUTE_PATHS.product(featured.slug)}
                className={`${buttonClasses({ variant: 'primary', size: 'lg', fullWidth: true })} mt-auto`}
              >
                View object
                <ArrowForwardIcon size={18} />
              </Link>
            </div>
          </article>
        )}
      </section>

      {/* Divisions of work */}
      <section className="mt-10">
        <SectionHeading kicker="Divisions of work" title="System volumes">
          <Link
            to={ROUTE_PATHS.catalog}
            className="font-editorial text-[10px] uppercase tracking-widest text-ink-muted transition-colors hover:text-ink"
          >
            View all
          </Link>
        </SectionHeading>

        <div className="grid gap-4 sm:grid-cols-3">
          {PRODUCT_CATEGORIES.map((category, index) => {
            const inDivision = products.filter((product) => product.category === category);
            // A real photograph of a real object from the division; with the
            // catalogue empty there is nothing to show, and a neutral panel says
            // that better than a stock photo of somebody's desk.
            const cover = inDivision[0];

            return (
              <Link
                key={category}
                to={`${ROUTE_PATHS.catalog}?category=${category}`}
                className="group flex flex-col overflow-hidden rounded-component border-hard border-hairline bg-surface-lowest transition-kanso hover:border-ink motion-safe:hover:-translate-y-1"
              >
                <div className="relative">
                  {cover === undefined ? (
                    <div aria-hidden="true" className="aspect-[4/3] w-full bg-surface-container" />
                  ) : (
                    <ProductImage
                      slug={cover.slug}
                      ratio="4x3"
                      sizes="(min-width: 640px) 33vw, 100vw"
                      decorative
                      className="rounded-none"
                    />
                  )}
                  <span className="absolute left-2 top-2 rounded-tight bg-paper/90 px-2 py-0.5 font-editorial text-[10px] uppercase tracking-widest text-ink">
                    Vol. {String(index + 1).padStart(2, '0')}
                  </span>
                  {inDivision.length > 0 ? (
                    <span className="absolute bottom-2 right-2 rounded-tight border-hard border-ink bg-ink px-2 py-0.5 font-editorial text-[10px] uppercase tracking-widest text-ink-on-primary">
                      {inDivision.length} {inDivision.length === 1 ? 'object' : 'objects'}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-1 flex-col gap-1 p-4">
                  <h3 className="font-display text-xl uppercase leading-none tracking-tight text-ink transition-colors group-hover:text-accent-deep">
                    {categoryLabel(category)}
                  </h3>
                  <p className="text-sm leading-6 text-ink-muted">{DIVISION_NOTES[category]}</p>
                  <span className="mt-auto flex items-center gap-1 pt-3 font-editorial text-[10px] uppercase tracking-widest text-ink-muted transition-colors group-hover:text-ink">
                    View division
                    <ArrowForwardIcon size={14} />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Curated strip */}
      <section className="mt-10">
        <SectionHeading kicker="Curated selection" title="Precision objects">
          <Link
            to={ROUTE_PATHS.catalog}
            className="font-editorial text-[10px] uppercase tracking-widest text-ink-muted transition-colors hover:text-ink"
          >
            View all ({products.length})
          </Link>
        </SectionHeading>

        {failed ? (
          <ErrorState
            title="The catalogue did not load"
            error={error}
            onRetry={() => void refresh()}
          />
        ) : isLoading ? (
          <ProductGrid
            products={[]}
            loading
            skeletonCount={CURATED_COUNT}
            priorityCount={CURATED_COUNT}
          />
        ) : products.length === 0 ? (
          <EmptyState
            title="No objects to show yet"
            description="The catalogue is empty. Nothing has been published, so there is nothing to browse."
            action={
              <Link
                to={ROUTE_PATHS.catalog}
                className={buttonClasses({ variant: 'outline', size: 'sm' })}
              >
                Check the catalogue
              </Link>
            }
          />
        ) : (
          <ProductGrid
            products={products.slice(0, CURATED_COUNT)}
            sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
            priorityCount={2}
          />
        )}
      </section>

      {/* Brand statement — the ABOUT target for the rail and the tab bar. */}
      <section
        id={ABOUT_SECTION_ID}
        aria-labelledby="about-heading"
        className="mt-10 scroll-mt-20 rounded-component bg-inverse p-6 text-inverse-text md:p-10"
      >
        <div className="grid gap-6 md:grid-cols-12 md:items-center">
          <div className="md:col-span-7">
            <p className="font-editorial text-[10px] uppercase tracking-widest text-accent">
              {'Doctrine // form follows cognition'}
            </p>
            <h2
              id="about-heading"
              className="mt-2 font-display text-heading uppercase leading-none tracking-tight md:text-hero"
            >
              Tools as ritual,
              <br />
              not distraction.
            </h2>
            <p className="mt-4 max-w-xl text-body-lg text-surface-highest">
              The objects on your desk mediate the quality of your attention. Kanso rejects
              smart-appliance novelty, synthetic softness and planned obsolescence. Every bevel is
              drawn to ground attention; every material is chosen to outlast its user.
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-3 md:col-span-5">
            <div className="rounded-component border border-inverse-text/20 p-3">
              <dt className="font-editorial text-[10px] uppercase tracking-widest text-surface-highest">
                Production
              </dt>
              <dd className="mt-1 font-label text-label uppercase tracking-[0.06em]">
                Small runs, no restocks
              </dd>
            </div>
            <div className="rounded-component border border-inverse-text/20 p-3">
              <dt className="font-editorial text-[10px] uppercase tracking-widest text-surface-highest">
                Dispatch
              </dt>
              <dd className="mt-1 font-label text-label uppercase tracking-[0.06em]">
                Lagos / worldwide
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </PageShell>
  );
}
