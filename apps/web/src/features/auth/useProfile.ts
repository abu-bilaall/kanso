/**
 * `useProfile` — the account page's view of `profiles`.
 *
 * The frozen hook set has no profile hook, so this is a query written against
 * the same client the rest of the app uses. It is not exported from `@/hooks`;
 * it lives here, in the feature that needs it. See `docs/CONTRACT-REQUESTS.md`.
 *
 * ## Why this degrades instead of failing
 *
 * A `profiles` row is created by a database trigger on signup. Between the
 * Google redirect and that trigger firing — and on any deployment where the
 * table has not been migrated yet — there is no row, and there may not even be a
 * table. Neither is a reason to withhold the account page: the identity a reader
 * came for is in the auth session too, so this falls back to
 * `user.user_metadata` and the email Supabase guarantees.
 *
 * A row that is *missing* is a state, not an error, and logs at info. A query
 * that *fails* is an error: it is logged, and surfaced as a quiet note, because
 * "never silently swallow errors" outranks "keep the page tidy".
 */

import type { UserMetadata } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks';
import { type AppError, toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getSupabaseClient } from '@/lib/supabase';
import type { Profile } from '@/lib/supabase.types';

/** Metadata keys Google and Supabase have used for a display name, in order. */
const NAME_KEYS = ['full_name', 'name'] as const;
/** Likewise for an avatar. */
const AVATAR_KEYS = ['avatar_url', 'picture'] as const;

export interface ProfileView {
  /** `null` when Google supplied neither a name nor an email we can shorten. */
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  phone: string | null;
  /** The OAuth provider Supabase recorded, e.g. `google`. */
  provider: string | null;
  /** True when the `profiles` row answered; false when we fell back. */
  hasProfileRow: boolean;
  /** True while the row is being read. */
  isLoading: boolean;
  /** Non-null only when the read itself failed. Absence of a row is not a failure. */
  error: AppError | null;
}

export function useProfile(): ProfileView {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [row, setRow] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    if (userId === null) {
      setRow(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let active = true;
    const startedAt = Date.now();
    setIsLoading(true);

    const settle = (profile: Profile | null, failure: AppError | null): void => {
      if (!active) return;
      setRow(profile);
      setError(failure);
      setIsLoading(false);
      const fields = {
        event: 'profile_loaded',
        scope: 'account',
        durationMs: Date.now() - startedAt,
        userId,
        found: profile !== null,
      };
      if (failure === null) {
        logger.info({ ...fields, outcome: 'success' });
      } else {
        logger.error({ ...fields, outcome: 'failure', error: failure });
      }
    };

    let query: PromiseLike<{ data: unknown; error: unknown }>;
    try {
      query = getSupabaseClient().from('profiles').select('*').eq('id', userId).maybeSingle();
    } catch (thrown) {
      settle(null, toAppError(thrown, 'Could not load your profile'));
      return;
    }

    query.then(
      ({ data, error: queryError }) =>
        settle(
          queryError === null ? ((data as Profile | null) ?? null) : null,
          queryError ? toAppError(queryError, 'Could not load your profile') : null,
        ),
      (thrown: unknown) => settle(null, toAppError(thrown, 'Could not load your profile')),
    );

    return () => {
      active = false;
    };
  }, [userId]);

  const metadata: UserMetadata = user?.user_metadata ?? {};

  return {
    displayName: row?.full_name ?? metadataString(metadata, NAME_KEYS),
    email: row?.email ?? user?.email ?? null,
    avatarUrl: row?.avatar_url ?? metadataString(metadata, AVATAR_KEYS),
    phone: row?.phone ?? null,
    provider: user?.app_metadata?.provider ?? null,
    hasProfileRow: row !== null,
    isLoading,
    error,
  };
}

/** First non-blank string among `keys`, trimmed. Auth metadata is untyped. */
function metadataString(metadata: UserMetadata, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}
