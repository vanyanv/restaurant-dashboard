/**
 * The prototype's `ask` glyph, from `IC` at line 2930 of
 * `docs/counter/counter-prototype.html`, emitted exactly as `svg('ask')` does.
 *
 * It carries NO width or height of its own, as in the prototype: the three
 * surfaces that print it each size it themselves — `.askmini svg` to 11px,
 * `.askbar__in svg` to 15px, the mobile `.masksheet .row svg` to its own. A
 * glyph with dimensions baked in would fight all three.
 *
 * Lives in its own file because two components now emit it (`Section`'s
 * "ask about this" affordance and `AskBar`), and one glyph drawn twice is one
 * path that can drift.
 */
export function AskGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13.5 9.5a1.6 1.6 0 01-1.6 1.6H5.6L2.5 13.8V4.1a1.6 1.6 0 011.6-1.6h7.8a1.6 1.6 0 011.6 1.6z" />
      <path d="M6 6.4h4M6 8.6h2.4" />
    </svg>
  )
}
