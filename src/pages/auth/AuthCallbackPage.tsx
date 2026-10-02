// Placeholder for `/auth/callback`. Replaced wholesale by A6 (Account, auth, order history).
// See src/pages/_placeholder/Placeholder.tsx and docs/CONTRACTS.md.
import { Placeholder } from '../_placeholder/Placeholder';

export function AuthCallbackPage() {
  return (
    <Placeholder
      path="/auth/callback"
      owner="A6 — Account & Auth"
      intent="Handles the Google OAuth redirect: loading, success and failure states."
    />
  );
}
