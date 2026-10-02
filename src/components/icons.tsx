/**
 * The Kanso icon set.
 *
 * DESIGN.md asks for "outline icons from one consistent set such as Lucide". No
 * icon package is a pre-approved dependency, so this file *is* the set: twelve
 * 24x24 outline glyphs drawn on the same grid, with the same 2px stroke, the
 * same round caps and the same optical size. Adding a thirteenth means adding it
 * here, not importing a second family's icon halfway through the app.
 *
 * Every icon:
 *   - is decorative-by-default (`aria-hidden`) because the surrounding label
 *     already says what it means; pass a `title` to make one meaningful,
 *   - inherits `currentColor`, so it works on paper, ink and chartreuse,
 *   - scales with the text via `width`/`height` defaults of `1em`.
 */

import type { SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Pixel size for both dimensions. Defaults to `1em`. */
  size?: number | string;
  /** Accessible name. Omit for decorative icons. */
  title?: string;
}

function Icon({
  size = '1em',
  title,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: conditional <title> below; a static rule cannot see it
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title === undefined ? 'presentation' : 'img'}
      aria-hidden={title === undefined || undefined}
      focusable="false"
      {...rest}
    >
      {title === undefined ? null : <title>{title}</title>}
      {children}
    </svg>
  );
}

/* --- Navigation ---------------------------------------------------------- */

export const StoreIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 9l1.5-5h15L21 9" />
    <path d="M4 9v11h16V9" />
    <path d="M3 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0" />
  </Icon>
);

export const GridIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </Icon>
);

export const InfoIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
);

export const AccountIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="10" r="3" />
    <path d="M6 19a6.5 6.5 0 0112 0" />
  </Icon>
);

export const ArrowBackIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);

export const ArrowForwardIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

/* --- Commerce ------------------------------------------------------------ */

export const CartIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 4h2l2.4 11.2a2 2 0 002 1.6h7.7a2 2 0 002-1.5L21 8H6" />
    <circle cx="10" cy="20" r="1.4" />
    <circle cx="18" cy="20" r="1.4" />
  </Icon>
);

export const BagIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 8h12l-1 12H7L6 8z" />
    <path d="M9 8V6a3 3 0 016 0v2" />
  </Icon>
);

export const MinusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12h14" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    <path d="M10 11v6M14 11v6" />
  </Icon>
);

/* --- Status -------------------------------------------------------------- */

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 12.5l5 5L20 6.5" />
  </Icon>
);

export const AlertIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3l9.5 17h-19L12 3z" />
    <path d="M12 10v4M12 17h.01" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const MenuIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);
