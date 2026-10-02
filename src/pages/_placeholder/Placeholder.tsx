/**
 * Placeholder.
 *
 * ## What this is
 *
 * A page that is not built yet. Every route in `src/routes.ts` points at a
 * module in `src/pages/**` that renders `<Placeholder />` until the agent who
 * owns that surface replaces the file wholesale. It exists so the build, the dev
 * server and every navigation target are green before six agents start, and so a
 * reviewer opening any URL can tell instantly that a surface is unbuilt rather
 * than broken.
 *
 * ## The rule for the agent who replaces it
 *
 * Replace the whole `src/pages/<surface>/<Surface>Page.tsx` file. Do not import
 * this component, do not keep it alongside real markup, and do not branch on it.
 * When your page exists, `Placeholder` should have no remaining importers — the
 * route table is frozen and a leftover usage is dead code, not a feature flag.
 *
 * ## The rule for everyone
 *
 * If you need to change `src/routes.ts`, or the shape of anything in
 * `src/components/`, `src/hooks/` or `src/lib/`, do not edit it. Write the
 * request in `docs/CONTRACT-REQUESTS.md` and carry on with what exists. See
 * `docs/CONTRACTS.md`.
 */

import { InfoIcon } from '@/components/icons';
import { PageShell } from '@/components/layout';
import { EmptyState } from '@/components/ui';

export interface PlaceholderProps {
  /** The route this placeholder stands in for, shown verbatim. */
  path: string;
  /** The agent or phase that owns the real surface. */
  owner: string;
  /** One line on what the finished surface does. */
  intent: string;
}

export function Placeholder({ path, owner, intent }: PlaceholderProps) {
  return (
    <PageShell title="Kanso">
      <EmptyState
        icon={<InfoIcon size={20} />}
        title="Not built yet"
        description={
          <>
            <span className="block">
              This route is a <strong className="font-bold text-ink">{path}</strong> placeholder.{' '}
              {intent}
            </span>
            <span className="mt-2 block font-editorial text-[10px] uppercase tracking-wider text-ink-subtle">
              Owned by {owner}
            </span>
          </>
        }
      />
    </PageShell>
  );
}
