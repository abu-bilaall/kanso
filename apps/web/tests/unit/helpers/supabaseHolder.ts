/**
 * The seam between a hook test and its hoisted `vi.mock('@/lib/supabase')`.
 *
 * The mock cannot live here: Vitest hoists `vi.mock` to the top of the *file
 * that declares it*, so a mock registered inside this helper would run after the
 * test file had already imported the hooks and linked the real module. Each test
 * file therefore declares its own `vi.mock` and reads its client from the holder
 * exported here.
 */

import type { FakeSupabase } from './fakeSupabase';

export const supabaseHolder: { current: FakeSupabase | null } = { current: null };
