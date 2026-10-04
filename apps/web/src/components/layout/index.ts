/**
 * Barrel for `src/components/layout`. Import from `@/components/layout`.
 *
 * Exactly four pieces, and the 768px switch lives in one of them:
 *
 *   DesktopRail  fixed 160px left navigation, >= 768px only
 *   MobileHeader sticky top bar, < 768px only
 *   MobileTabBar fixed five-item bottom bar, < 768px only
 *   PageShell    the frame every route renders inside; owns the switch
 */

export { DesktopRail } from './DesktopRail';
export type { MobileHeaderProps } from './MobileHeader';
export { MobileHeader } from './MobileHeader';
export { MobileTabBar } from './MobileTabBar';
export type { PageShellProps, PageWidth } from './PageShell';
export { PageShell } from './PageShell';
