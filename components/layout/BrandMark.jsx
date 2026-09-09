/**
 * The HyperFamily brand mark — the logo provided by the owner (v2.0.17).
 *
 * The full lockup (mark + wordmark) renders at hero sizes such as the login
 * screen; compact contexts pass `symbol` to show the mark alone, which stays
 * legible at sidebar scale. Both come from the owner's artwork, pre-processed
 * onto a transparent background (public/brand/).
 *
 * Brand palette (fixed, not theme-driven — a logo must not change colour with
 * the interface theme): red mark on white, or on a dark slate tile for the
 * application icon.
 */
import { cn } from '@/lib/utils'

export const BRAND_RED = '#d4211f'
export const BRAND_TEAL = '#00b1c5'
export const BRAND_GREY = '#939598'

export default function BrandMark({ className = 'h-10 w-10', title = 'HyperFamily', symbol = false }) {
  return (
    /* The mark ships as a static PNG asset; next/image optimisation is
       disabled for this export. */
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={symbol ? '/brand/logo-mark.png' : '/brand/logo-full.png'}
      alt={title}
      title={title}
      draggable={false}
      className={cn('shrink-0 select-none object-contain', className)}
    />
  )
}
