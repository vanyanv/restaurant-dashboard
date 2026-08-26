/**
 * The prototype's `svg('search')`, from `IC` at line 2947 of
 * `docs/counter/counter-prototype.html`:
 *
 *   search:'<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L14 14"/>'
 *
 * Lives beside `AskGlyph` and `Caret` as its own file, matching their
 * convention: one prototype glyph, one component, no inline `<path>` in the
 * component that uses it (`Filters`).
 *
 * NOT added to `src/components/counter/shell/nav-icons.ts` — that map is a
 * different icon system. It resolves the seventeen rail/palette destinations
 * to `lucide-react` components (`NAV_ICONS: Record<string, LucideIcon>`), one
 * name per nav row from `nav.ts`. The prototype's own `IC` table of raw SVG
 * paths is a separate, unrelated set of glyphs, and every other one already
 * ported from it (`AskGlyph`, `Caret`) lives as its own component here in
 * `surface/`, not in `nav-icons.ts`. Adding `search` to the lucide map would
 * require a `lucide-react` substitute for a path this specific, which is
 * exactly the drift Phase B's verbatim-port rule exists to prevent.
 *
 * No width or height of its own — `.search svg` in the ported sheet sizes it
 * to 13px, and a glyph with dimensions baked in would fight that rule the way
 * `AskGlyph`'s module comment already explains for its own three callers.
 */
export function SearchGlyph() {
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
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2L14 14" />
    </svg>
  )
}
