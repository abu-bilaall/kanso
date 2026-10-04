/**
 * Barrel for `src/features/auth`. Import from `@/features/auth`.
 *
 * The account and sign-in surfaces only. Nothing else in the app needs these,
 * which is why they are not in the frozen `@/hooks` barrel.
 */

export type {
  AuthResponse,
  CallbackErrorCode,
  CallbackEvent,
  CallbackState,
} from './callbackMachine';
export {
  CALLBACK_ERROR_BODIES,
  CALLBACK_ERROR_TITLES,
  callbackReducer,
  initialCallbackState,
  parseAuthResponse,
} from './callbackMachine';
export { readDestination } from './destination';
export type { AuthCallbackView } from './useAuthCallback';
export { useAuthCallback } from './useAuthCallback';
export type { ProfileView } from './useProfile';
export { useProfile } from './useProfile';
export type { SessionExpiry } from './useSessionExpiry';
export { useSessionExpiry } from './useSessionExpiry';
