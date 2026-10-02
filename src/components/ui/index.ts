/**
 * Barrel for `src/components/ui`. Import from `@/components/ui`.
 *
 * This is DESIGN.md's component vocabulary and nothing more:
 * Button, Input, Select, QuantityControl, Badge, EmptyState, ErrorState,
 * Skeleton, Alert. If a sixth agent needs a tenth primitive, it goes through
 * `docs/CONTRACT-REQUESTS.md` — six divergent `Button` variants is how a
 * storefront stops looking like one shop.
 */

export type { AlertProps, AlertTone } from './Alert';
export { Alert } from './Alert';
export type { BadgeProps, BadgeTone } from './Badge';
export { Badge } from './Badge';
export type { ButtonClassOptions, ButtonProps, ButtonSize, ButtonVariant } from './Button';
export { Button, buttonClasses } from './Button';
export type { EmptyStateProps } from './EmptyState';
export { EmptyState } from './EmptyState';
export type { ErrorStateProps } from './ErrorState';
export { ErrorState } from './ErrorState';
export type { InputProps } from './Input';
export { Input } from './Input';
export type { QuantityControlProps } from './QuantityControl';
export { QuantityControl } from './QuantityControl';
export type { SelectOption, SelectProps } from './Select';
export { Select } from './Select';
export type { SkeletonProps } from './Skeleton';
export { Skeleton } from './Skeleton';
