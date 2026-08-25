/**
 * The prototype's `svg('chev')`, at prototype line 2948.
 *
 * Every disclosure in the ported sheet — `.stcard__h .car`, `.drill__t .car`,
 * `.prow .car` — draws a chevron that points RIGHT when closed and is rotated
 * 90° by CSS when its control reads `aria-expanded="true"`. The rotation is
 * the sheet's (`transform: rotate(90deg)`), so the glyph itself must be the
 * right-pointing one; shipping a down-chevron here would render a
 * down-then-rotated-to-up caret on every open drawer.
 *
 * The wrapping `<span class="car">` is the element the sheet sizes and rotates
 * — this component emits it, so no caller has to remember it.
 */
export function Caret() {
  return (
    <span className="car">
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M6 3.5L10.5 8 6 12.5" />
      </svg>
    </span>
  )
}
