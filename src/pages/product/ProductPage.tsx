/**
 * `/product/:slug` — one product.
 *
 * Structure follows `stitch-designs/kanso_product_detail/code.html`: a large
 * image, a sticky purchase rail with the price, the stock state, the quantity
 * control and the add-to-cart, then the specification and the care notes.
 *
 * ## What the data can actually say
 *
 * Stitch's specification matrix has four rows — material, dimensions, weight,
 * finish. `products` has one: `spec_line`. Rather than invent three more, the
 * matrix rows are the four facts the row genuinely carries (division, spec line,
 * availability, price) and the rest of the page is the product's own
 * description. Nothing here is filler with a mono font on it.
 *
 * ## The gallery
 *
 * `ProductImage` resolves one image per **ratio** from the manifest, so the most
 * a gallery can honestly be is the `4x3` crop and the `1x1` crop of the same
 * photograph. That is what the thumbnail strip offers, and it disappears when
 * the manifest has only one crop — which is the state PLAN §2.4 calls acceptable
 * rather than a gap. Until the media agent fills the manifest, every image here
 * is the neutral placeholder `ProductImage` draws, at the right size.
 *
 * ## Quantity, stock, and adding
 *
 * The quantity control is clamped to `product.inventory` — never above it, and
 * never below one — through `clampQuantity`, which is the same function the unit
 * tests pin. A sold-out product renders no control and no button at all rather
 * than a disabled one that cannot do anything.
 *
 * Adding to the cart is a real mutation against `useCart`. It rejects when the
 * visitor is anonymous, and that rejection is not swallowed: it becomes an
 * inline message with a Google sign-in action that returns to this product.
 */

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowForwardIcon, CheckIcon } from '@/components/icons';
import { MobileHeader, PageShell } from '@/components/layout';
import { ProductImage } from '@/components/media/ProductImage';
import { StockBadge } from '@/components/product/StockBadge';
import {
  Alert,
  Button,
  buttonClasses,
  ErrorState,
  QuantityControl,
  Skeleton,
} from '@/components/ui';
import { clampQuantity, isPurchasable, stockLabel } from '@/features/catalog/inventory';
import { useAuth, useCart, useProduct } from '@/hooks';
import { categoryLabel } from '@/hooks/useProducts';
import { toAppError } from '@/lib/errors';
import { getImageUrls, IMAGE_RATIOS, type ImageRatio } from '@/lib/images';
import { formatMoney, sumLineTotals } from '@/lib/money';
import { ROUTE_PATHS } from '@/routes';

type Feedback = {
  tone: 'success' | 'danger';
  title: string;
  body: string;
  /** True when the failure was "no session" and the way out is signing in. */
  signIn?: boolean;
};

export function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const { product, error, isLoading, refresh } = useProduct(slug);
  const { addItem, isMutating } = useCart();
  const { signInWithGoogle } = useAuth();

  const [requested, setRequested] = useState(1);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // Derived, not stored: if inventory drops between two renders — another
  // shopper, a refresh — the selected quantity is clamped down automatically
  // rather than left on a value that is no longer for sale.
  const quantity = product === null ? 1 : clampQuantity(requested, product.inventory);
  const purchasable = product !== null && isPurchasable(product.inventory);

  const onAdd = async () => {
    if (product === null) return;
    setFeedback(null);
    try {
      await addItem(product.id, quantity);
      setFeedback({
        tone: 'success',
        title: 'Added to your cart',
        body: `${product.name} — ${quantity} ${quantity === 1 ? 'unit' : 'units'}.`,
      });
    } catch (thrown) {
      const failure = toAppError(thrown, 'Could not add that to your cart');
      setFeedback({
        tone: 'danger',
        title:
          failure.code === 'unauthenticated' ? 'Sign in to use a cart' : 'Could not add to cart',
        body: failure.message,
        signIn: failure.code === 'unauthenticated',
      });
    }
  };

  const onSignIn = async () => {
    try {
      await signInWithGoogle({
        redirectTo: `${window.location.origin}${ROUTE_PATHS.product(slug ?? '')}`,
      });
    } catch (thrown) {
      setFeedback({
        tone: 'danger',
        title: 'Sign-in did not start',
        body: toAppError(thrown, 'Could not start Google sign-in').message,
        signIn: false,
      });
    }
  };

  return (
    <PageShell
      title={product?.name ?? 'Product'}
      header={
        <MobileHeader backTo={ROUTE_PATHS.catalog} contextLabel={product?.name ?? 'Object'} />
      }
    >
      {isLoading ? (
        <ProductSkeleton />
      ) : error !== null ? (
        // `not_found` arrives with `retryable: false`, so `ErrorState` renders no
        // "Try again" — a retry cannot conjure a product that does not exist.
        <ErrorState
          title={error.code === 'not_found' ? 'That object is not in the catalogue' : undefined}
          error={error}
          onRetry={() => void refresh()}
          retrying={isLoading}
          action={
            <Link
              to={ROUTE_PATHS.catalog}
              className={buttonClasses({ variant: 'outline', size: 'sm' })}
            >
              Back to the catalogue
            </Link>
          }
        />
      ) : product === null ? null : (
        <>
          {/* Breadcrumb. On mobile it is the only thing between the header and
              the photograph, so it is a compact strip rather than a nav bar. */}
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-2 border-b border-hairline pb-3 font-editorial text-[10px] uppercase tracking-widest text-ink-subtle">
              <li>
                <Link to={ROUTE_PATHS.catalog} className="transition-colors hover:text-ink">
                  Shop
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <Link
                  to={`${ROUTE_PATHS.catalog}?category=${product.category}`}
                  className="transition-colors hover:text-ink"
                >
                  {categoryLabel(product.category)}
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-ink">
                {product.slug}
              </li>
            </ol>
          </nav>

          {/* The split waits for `lg`, like the Stitch prototype: at 768px the rail
              leaves too little for a 5-column purchase panel to hold a price and
              a quantity control on one line. */}
          <div className="grid items-start gap-6 lg:grid-cols-12">
            <div className="flex flex-col gap-3 lg:col-span-7">
              <ProductGallery slug={product.slug} name={product.name} />

              {product.description === null ? null : (
                <div className="rounded-component border-hard border-hairline bg-surface-low p-5">
                  <h2 className="font-editorial text-[10px] uppercase tracking-widest text-ink-subtle">
                    About this object
                  </h2>
                  <p className="mt-2 text-body-lg leading-7 text-ink">{product.description}</p>
                </div>
              )}
            </div>

            {/* The purchase rail: sticky on desktop, in flow on mobile where the
                tab bar owns the bottom of the screen. */}
            <div className="flex flex-col gap-4 lg:col-span-5 lg:sticky lg:top-6">
              <div className="rounded-component border-hard border-ink bg-surface-lowest p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-editorial text-[10px] uppercase tracking-widest text-ink-subtle">
                    {categoryLabel(product.category)} / {product.slug}
                  </p>
                  <StockBadge inventory={product.inventory} live />
                </div>

                <h1 className="mt-3 font-display text-heading uppercase leading-none tracking-tight text-ink">
                  {product.name}
                </h1>

                <p className="mt-3 border-b-2 border-ink pb-3 font-editorial text-2xl font-bold tabular-nums text-ink">
                  {formatMoney(product.price_kobo)}
                  <span className="ml-2 text-[10px] font-normal uppercase tracking-widest text-ink-subtle">
                    NGN · incl. duties
                  </span>
                </p>

                {product.spec_line === null ? null : (
                  <p className="mt-3 font-editorial text-[11px] uppercase leading-5 tracking-wider text-ink-muted">
                    {product.spec_line}
                  </p>
                )}

                <div className="mt-5 flex flex-col gap-3">
                  {purchasable ? (
                    <>
                      <div className="flex flex-wrap items-center gap-3">
                        <QuantityControl
                          value={quantity}
                          onChange={setRequested}
                          max={product.inventory}
                          label="Quantity"
                          trailing={`Max ${product.inventory}`}
                        />
                      </div>

                      <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        loading={isMutating}
                        onClick={() => void onAdd()}
                      >
                        Add to cart —{' '}
                        {formatMoney(
                          sumLineTotals([{ quantity, unitPriceKobo: product.price_kobo }]),
                        )}
                      </Button>
                    </>
                  ) : (
                    <p className="rounded-component border-hard border-danger bg-danger-surface/40 p-3 text-sm leading-6 text-danger-ink">
                      This run has sold out. Nothing of {product.name} is left to ship.
                    </p>
                  )}
                </div>
              </div>

              {feedback === null ? null : (
                <Alert
                  tone={feedback.tone}
                  title={feedback.title}
                  onDismiss={() => setFeedback(null)}
                >
                  <p>{feedback.body}</p>
                  {feedback.signIn ? (
                    <div className="mt-3">
                      <Button variant="primary" size="sm" onClick={() => void onSignIn()}>
                        Sign in with Google
                        <ArrowForwardIcon size={16} />
                      </Button>
                    </div>
                  ) : null}
                </Alert>
              )}

              {feedback?.tone === 'success' ? (
                <Link
                  to={ROUTE_PATHS.cart}
                  className={`${buttonClasses({ variant: 'accent', size: 'lg', fullWidth: true })}`}
                >
                  <CheckIcon size={16} />
                  Go to cart
                </Link>
              ) : null}

              <dl className="rounded-component border-hard border-hairline">
                <SpecRow term="Division" detail={categoryLabel(product.category)} />
                <SpecRow term="Availability" detail={stockLabel(product.inventory)} />
                <SpecRow term="Reference" detail={product.slug} />
              </dl>

              <Link
                to={`${ROUTE_PATHS.catalog}?category=${product.category}`}
                className="flex items-center justify-between gap-2 rounded-component border-hard border-hairline px-4 py-3 font-label text-label uppercase tracking-[0.06em] transition-kanso hover:border-ink"
              >
                More in {categoryLabel(product.category)}
                <ArrowForwardIcon size={16} />
              </Link>
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}

function SpecRow({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-hairline bg-surface-container px-3 py-2 last:border-b-0">
      <dt className="font-editorial text-[10px] uppercase tracking-widest text-ink-subtle">
        {term}
      </dt>
      <dd className="truncate font-editorial text-[11px] uppercase tracking-wider text-ink">
        {detail}
      </dd>
    </div>
  );
}

/**
 * The stage plus its thumbnail strip.
 *
 * The thumbnails exist only when the manifest holds more than one crop of this
 * product; otherwise the stage stands alone rather than sitting next to a
 * duplicate of itself.
 */
function ProductGallery({ slug, name }: { slug: string; name: string }) {
  const ratios = useMemo(
    () => IMAGE_RATIOS.filter((ratio) => getImageUrls(slug, ratio) !== null),
    [slug],
  );
  const [chosen, setChosen] = useState<ImageRatio | null>(null);
  const ratio: ImageRatio = chosen !== null && ratios.includes(chosen) ? chosen : '4x3';

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-component border-hard border-ink p-2">
        <ProductImage
          slug={slug}
          ratio={ratio}
          sizes="(min-width: 768px) 58vw, 100vw"
          priority
          className="rounded-component"
        />
      </div>

      {ratios.length < 2 ? null : (
        <ul className="grid grid-cols-2 gap-3">
          {ratios.map((option) => (
            <li key={option}>
              <button
                type="button"
                onClick={() => setChosen(option)}
                aria-pressed={ratio === option}
                className={`w-full overflow-hidden rounded-component border-hard bg-surface-lowest p-1.5 transition-kanso ${
                  ratio === option ? 'border-ink' : 'border-hairline hover:border-ink'
                }`}
              >
                <ProductImage
                  slug={slug}
                  ratio={option}
                  sizes="(min-width: 768px) 29vw, 50vw"
                  className="rounded-tight"
                />
                <span className="mt-1.5 block font-editorial text-[10px] uppercase tracking-widest text-ink-muted">
                  {option === '4x3' ? 'Landscape' : 'Square'} — {name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading this product">
      <Skeleton className="h-4 w-48" />
      <div className="grid gap-6 md:grid-cols-12">
        <div className="flex flex-col gap-3 md:col-span-7">
          <Skeleton className="aspect-[4/3] w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="flex flex-col gap-3 md:col-span-5">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}
