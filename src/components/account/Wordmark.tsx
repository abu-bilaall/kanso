/**
 * Wordmark.
 *
 * The vector form of `stitch-designs/kanso_wordmark_logo/screen.png`: a
 * rounded-square reticle — a filled eye with four ticks to the corners of the
 * frame — beside the word. Stitch generated that screen as an SVG
 * (`stitch-designs/kanso_wordmark_logo/code.html`); this is that geometry, in a
 * component, with every hex replaced by a token.
 *
 * Why inline rather than a raster: the rail renders it at 28px, the sign-in
 * screen at 40px and a retina display at twice that. A 5KB PNG at those sizes is
 * either soft or oversized, and an SVG is one request fewer. No icon package is
 * involved — this is not an icon, it is the brand.
 *
 * The `<text>` is real text, not outlined paths, because the app already ships
 * Archivo Black; turning six glyphs into two hundred path commands would make
 * the mark heavier without making it sharper. If Kanso ever outlives Archivo
 * Black, this is the one thing to revisit.
 */

export interface WordmarkProps {
  /** Rendered height in pixels. The width follows the mark's own aspect. */
  height?: number;
  /**
   * Accessible name. Omit when the wordmark sits inside something already
   * labelled — a link reading "Kanso — home", say — and the SVG is then hidden
   * from assistive technology rather than announced twice.
   */
  label?: string;
  className?: string;
}

/**
 * The word is set in Archivo Black, which is wider than the grotesque Stitch
 * drafted it against, so the box has to be wider than Stitch's 120 to keep
 * `KANSO` inside it. Measured once against the shipped face, not guessed.
 */
const VIEWBOX_WIDTH = 141;
const VIEWBOX_HEIGHT = 40;

export function Wordmark({ height = 40, label, className = '' }: WordmarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      height={height}
      width={(height * VIEWBOX_WIDTH) / VIEWBOX_HEIGHT}
      fill="none"
      role={label === undefined ? 'presentation' : 'img'}
      aria-label={label}
      aria-hidden={label === undefined || undefined}
      focusable="false"
      className={className}
    >
      {/* Inset by half the stroke width so the hard edge sits inside the viewBox. */}
      <rect
        x="3.25"
        y="3.25"
        width="33.5"
        height="33.5"
        rx="3.75"
        strokeWidth="2.5"
        className="fill-paper stroke-ink"
      />
      <circle cx="20" cy="20" r="6" className="fill-ink" />
      <path
        d="M20 8v6M20 26v6M8 20h6M26 20h6"
        strokeWidth="2"
        strokeLinecap="square"
        className="stroke-ink"
      />
      <text x="48" y="26" fontSize="20" letterSpacing="2" className="fill-ink font-display">
        KANSO
      </text>
    </svg>
  );
}
