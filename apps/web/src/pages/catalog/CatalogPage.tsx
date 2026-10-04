/**
 * `/shop` — the catalogue.
 *
 * Structure follows `stitch-designs/kanso_catalogue_index/code.html`: a header
 * carrying the collection's size, a filter bar, and the grid. What is different
 * is that the filter bar is made of **links**, not buttons.
 *
 * ## Why the filter is a link
 *
 * The filter is `/shop?category=desk`, read from the URL and written back to it
 * (`@/features/catalog/query`). That makes a filtered view shareable, makes the
 * browser's back button step back through the filters the visitor actually
 * applied, and means the router — not an effect — decides what to re-render. The
 * sort control is a `<Select>` that writes a query param for the same reason: a
 * sorted catalogue is as copyable as a filtered one.
 *
 * No pagination. Ten products, one screen, and DESIGN.md says to avoid it until
 * the catalogue earns it.
 *
 * ## The one hook caveat this page has to work around
 *
 * `useProducts` runs its query when the component mounts and when `enabled`
 * changes — but the category is a URL param, and the hook's internal effect does
 * not key on it. So a filter change is followed by an explicit `refresh()`,
 * which is exactly what the contract's `refresh` is for. The ref below starts on
 * the current category, so the first render does not fire a second identical
 * query. Raised as a contract request.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageShell } from '@/components/layout';
import { ProductGrid } from '@/components/product/ProductGrid';
import { buttonClasses, EmptyState, ErrorState, Select, type SelectOption } from '@/components/ui';
import {
  ALL_CATEGORIES,
  type CatalogueQuery,
  catalogueHref,
  catalogueSearch,
  readCatalogueQuery,
} from '@/features/catalog/query';
import { parseSort, SORT_OPTIONS, sortProducts } from '@/features/catalog/sorting';
import { useProducts } from '@/hooks';
import { CATEGORIES, categoryLabel } from '@/hooks/useProducts';
import { ROUTE_PATHS } from '@/routes';

/** Column layout of the grid, mirrored in the `sizes` hint below. */
const GRID_SIZES = '(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw';

const SORT_SELECT_OPTIONS: readonly SelectOption[] = SORT_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = readCatalogueQuery(searchParams);
  const { category, sort } = query;
  const { products, status, error, isLoading, refresh } = useProducts({ category });

  const requestedCategory = useRef(category);
  useEffect(() => {
    if (requestedCategory.current === category) return;
    requestedCategory.current = category;
    void refresh();
  }, [category, refresh]);

  const visible = useMemo(() => sortProducts(products, sort), [products, sort]);
  const failed = status === 'error' && error !== null;

  return (
    <PageShell title="Catalogue — Kanso" width="wide">
      <header className="rounded-component bg-surface-low p-6 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <p className="font-editorial text-[10px] uppercase tracking-widest text-ink-subtle">
              Kanso archive / index
            </p>
            <h1 className="font-display text-heading uppercase leading-none tracking-tight text-ink md:text-hero">
              Product catalogue
            </h1>
            <p className="max-w-xl text-body-lg text-ink-muted">
              Tactile tools and accessories engineered for cognitive clarity and focused work.
            </p>
          </div>

          {/* A live region, so changing the filter announces the new count rather
              than leaving it in a corner to be noticed. */}
          <p
            role="status"
            aria-live="polite"
            className="rounded-component border-hard border-hairline bg-surface-lowest px-3 py-2 font-editorial text-[10px] uppercase tracking-widest text-ink-muted"
          >
            <ResultCount query={query} count={visible.length} loading={isLoading} failed={failed} />
          </p>
        </div>
      </header>

      {/* Filter bar. Every control here is a link or a query-param write.
          Stacked until there is genuinely room for it side by side: at 768px the
          rail leaves ~600px, where four chips and a 224px select just barely
          wrap. */}
      <div className="flex flex-col gap-3 rounded-component bg-surface-container p-3 lg:flex-row lg:items-end lg:justify-between">
        <nav aria-label="Product category">
          <ul className="flex flex-wrap items-center gap-2">
            <li>
              <CategoryFilterLink category={ALL_CATEGORIES} label="All" current={query} />
            </li>
            {CATEGORIES.map((entry) => (
              <li key={entry.value}>
                <CategoryFilterLink category={entry.value} label={entry.label} current={query} />
              </li>
            ))}
          </ul>
        </nav>

        <div className="w-full lg:w-56">
          <Select
            label="Order"
            value={sort}
            options={SORT_SELECT_OPTIONS}
            onChange={(event) => {
              setSearchParams(catalogueSearch({ category, sort: parseSort(event.target.value) }));
            }}
          />
        </div>
      </div>

      {failed ? (
        <ErrorState
          title="The catalogue did not load"
          error={error}
          onRetry={() => void refresh()}
          retrying={isLoading}
          action={
            <Link
              to={ROUTE_PATHS.home}
              className={buttonClasses({ variant: 'outline', size: 'sm' })}
            >
              Back to the storefront
            </Link>
          }
        />
      ) : visible.length === 0 && !isLoading ? (
        <EmptyState
          title={
            category === ALL_CATEGORIES
              ? 'The catalogue is empty'
              : `Nothing in ${categoryLabel(category)} yet`
          }
          description={
            category === ALL_CATEGORIES
              ? 'No objects have been published. This is where they will appear.'
              : `There is nothing in the ${categoryLabel(category).toLowerCase()} division right now. The other divisions are open.`
          }
          action={
            <Link
              to={catalogueHref({ category: ALL_CATEGORIES, sort })}
              className={buttonClasses({ variant: 'outline', size: 'sm' })}
            >
              {category === ALL_CATEGORIES ? 'Back to the storefront' : 'Show all objects'}
            </Link>
          }
        />
      ) : (
        <ProductGrid products={visible} loading={isLoading} sizes={GRID_SIZES} priorityCount={4} />
      )}
    </PageShell>
  );
}

function ResultCount({
  query,
  count,
  loading,
  failed,
}: {
  query: CatalogueQuery;
  count: number;
  loading: boolean;
  failed: boolean;
}) {
  if (loading) return <>{'Reading the catalogue'}</>;
  if (failed) return <>Unavailable</>;

  const objects = `${count} ${count === 1 ? 'object' : 'objects'}`;
  return (
    <>
      {query.category === ALL_CATEGORIES
        ? objects
        : `${objects} in ${categoryLabel(query.category)}`}
    </>
  );
}

/**
 * One filter chip. The active chip is inverted and carries `aria-current`, so the
 * current division is never communicated by colour alone.
 */
function CategoryFilterLink({
  category,
  label,
  current,
}: {
  category: CatalogueQuery['category'];
  label: string;
  current: CatalogueQuery;
}) {
  const active = current.category === category;
  const classes = [
    'inline-flex min-h-11 items-center rounded-component border-hard px-3 font-label uppercase tracking-[0.06em] transition-kanso',
    active
      ? 'border-ink bg-ink text-ink-on-primary'
      : 'border-hairline bg-surface-lowest text-ink-muted hover:border-ink hover:text-ink',
  ];

  return (
    <Link
      to={catalogueHref({ category, sort: current.sort })}
      aria-current={active ? 'page' : undefined}
      className={classes.join(' ')}
    >
      {label}
    </Link>
  );
}
