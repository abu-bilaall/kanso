/**
 * GoogleSignInButton.
 *
 * The only control that starts a sign-in, and the only place the app calls
 * `signInWithGoogle`. It exists so that four screens — the account page, the
 * callback's failure states — all start a sign-in the same way: with the
 * post-login destination attached, a pending state that survives a redirect,
 * and a failure that says what happened instead of leaving a dead button.
 *
 * ## On the pending state
 *
 * `signInWithGoogle` resolves once the browser has been redirected, so on
 * success this component never re-enables — it is unmounted by the navigation.
 * Only a rejected call clears `pending`, which is why the reset is in the catch
 * and not a `finally`.
 *
 * The glyph is a monochrome `G` drawn on the same 24-grid as
 * `src/components/icons.tsx` rather than Google's multi-colour mark. Kanso uses
 * outline iconography from one set; a brand-coloured blob in the middle of a
 * chartreuse button would be the only place in the shop where colour is
 * decoration.
 */

import { useState } from 'react';
import { Alert, Button, type ButtonSize, type ButtonVariant } from '@/components/ui';
import { callbackUrlFor, rememberReturnTo } from '@/features/checkout/returnIntent';
import { useAuth } from '@/hooks';
import { type AppError, toAppError } from '@/lib/errors';
import { ROUTE_PATHS } from '@/routes';

export interface GoogleSignInButtonProps {
  /**
   * Where the round trip should end up. Root-relative; anything else is dropped
   * by `returnIntent`'s same-origin check before it reaches Google.
   */
  destination?: string;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export function GoogleSignInButton({
  destination = ROUTE_PATHS.account,
  label = 'Continue with Google',
  variant = 'accent',
  size = 'lg',
  fullWidth = true,
}: GoogleSignInButtonProps) {
  const { signInWithGoogle } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  async function handleClick(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      // Both channels, in A5's order of preference: the parameter goes through
      // Google, the marker survives a provider that drops it. See
      // `src/features/checkout/returnIntent.ts`.
      rememberReturnTo(destination);
      await signInWithGoogle({ redirectTo: callbackUrlFor(destination) });
    } catch (thrown) {
      setError(toAppError(thrown, 'Could not start Google sign-in'));
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        fullWidth={fullWidth}
        loading={pending}
        onClick={() => {
          void handleClick();
        }}
        icon={<GoogleGlyph />}
      >
        {label}
      </Button>
      {error === null ? null : (
        <div className="mt-3">
          <Alert tone="danger" title="Sign-in did not start">
            {error.message}
          </Alert>
        </div>
      )}
    </>
  );
}

function GoogleGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d="M18.5 8.25A7.5 7.5 0 1 0 19.5 12M19.5 12h-7" />
    </svg>
  );
}
