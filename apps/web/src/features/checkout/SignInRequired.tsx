/**
 * The signed-out checkout.
 *
 * Not an error and not a dead end: Kanso needs a Google account to own the cart
 * and the order, so the customer is told why, offered exactly one button, and
 * returned to checkout when Google is done. The screen carries no marketing, no
 * second action and nothing to scroll past — the account/auth agent owns the
 * sign-in *screen*; this is the two sentences of context that make the redirect
 * from here make sense.
 *
 * A sign-in that cannot start is reported inline. Swallowing it would leave a
 * button that does nothing, which is the failure SPEC forbids by name.
 */

import { useState } from 'react';
import { Alert } from '@/components/ui';
import { Button } from '@/components/ui/Button';

export interface SignInRequiredProps {
  /** Starts Google OAuth and comes back here afterwards. */
  onSignIn: () => Promise<void>;
}

export function SignInRequired({ onSignIn }: SignInRequiredProps) {
  const [isStarting, setIsStarting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const start = async (): Promise<void> => {
    setIsStarting(true);
    setFailure(null);
    try {
      await onSignIn();
    } catch (thrown) {
      setFailure(thrown instanceof Error ? thrown.message : 'Google sign-in could not start.');
      setIsStarting(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-heading uppercase leading-none tracking-tight text-ink">
          Sign in to check out
        </h1>
        <p className="max-w-prose text-sm leading-6 text-ink-muted">
          Your cart and order belong to your Kanso account, so we ask you to sign in before taking
          your details. You will come straight back here.
        </p>
      </div>

      {failure === null ? null : <Alert tone="danger">{failure}</Alert>}

      <Button
        variant="primary"
        size="lg"
        fullWidth
        loading={isStarting}
        onClick={() => {
          void start();
        }}
      >
        Continue with Google
      </Button>
    </div>
  );
}
