/**
 * ProfileCard.
 *
 * Who is signed in, from the `profiles` row, falling back to what the auth
 * session carries when that row has not been created yet.
 *
 * The fallback is visible rather than silent. A reader whose details came from
 * Google and not from their Kanso profile deserves to know which they are
 * looking at, and a failed read gets the same courtesy in the opposite
 * direction — a quiet note instead of an error panel, because the orders
 * underneath are real and still worth reading.
 */

import { useState } from 'react';
import { Alert } from '@/components/ui';
import type { ProfileView } from '@/features/auth';

export interface ProfileCardProps {
  profile: ProfileView;
  headingId?: string;
}

const AVATAR_CLASSES =
  'h-14 w-14 shrink-0 rounded-component border-hard object-cover border-hairline';

export function ProfileCard({ profile, headingId = 'profile-heading' }: ProfileCardProps) {
  // Google's avatar URL can 404 — the account was deleted, the URL was revoked,
  // the CDN is having a moment. A broken-image glyph is worse than initials.
  const [avatarBroken, setAvatarBroken] = useState(false);

  const name = profile.displayName ?? 'Signed in';
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'K';

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="font-display text-lg uppercase tracking-tight text-ink">
        Profile
      </h2>

      <div className="flex items-center gap-4 rounded-component border-hard border-hairline bg-surface-lowest p-4">
        {profile.avatarUrl === null || avatarBroken ? (
          <span
            aria-hidden
            className="grid h-14 w-14 shrink-0 place-items-center rounded-component border-hard border-ink bg-ink font-display text-lg text-ink-on-primary"
          >
            {initials}
          </span>
        ) : (
          <img
            src={profile.avatarUrl}
            alt=""
            width={56}
            height={56}
            className={AVATAR_CLASSES}
            onError={() => setAvatarBroken(true)}
          />
        )}

        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-label uppercase tracking-[0.06em] text-ink">{name}</span>
          {profile.email === null ? null : (
            <span className="truncate text-sm text-ink-muted">{profile.email}</span>
          )}
        </div>
      </div>

      {profile.error === null ? null : (
        <Alert tone="info" title="Showing your Google account">
          We could not read your Kanso profile, so these details are the ones Google gave us.
        </Alert>
      )}
      {profile.error !== null || profile.isLoading || profile.hasProfileRow ? null : (
        <Alert tone="info" title="Your profile is still being set up">
          For now these are the details from your Google account.
        </Alert>
      )}

      {profile.phone === null && profile.provider === null ? null : (
        <dl className="flex flex-col divide-y divide-hairline rounded-component border-hard border-hairline bg-surface-lowest">
          {profile.phone === null ? null : <Row term="Phone">{profile.phone}</Row>}
          {profile.provider === null ? null : (
            <Row term="Signed in with">
              {profile.provider.charAt(0).toUpperCase() + profile.provider.slice(1)}
            </Row>
          )}
        </dl>
      )}
    </section>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="font-editorial text-meta uppercase tracking-wider text-ink-subtle">{term}</dt>
      <dd className="min-w-0 truncate text-sm text-ink">{children}</dd>
    </div>
  );
}
