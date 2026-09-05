/**
 * The five glyphs the conversations rail grew in the Sept-5 mock
 * (`docs/counter/ask-page-mock.html`): New, the ⋯ that opens a row's menu,
 * and the menu's three verbs. Same 16-box, same 1.5 stroke as `SearchGlyph`
 * beside them, sized by the class that places them — none carries its own
 * dimensions.
 */
const common = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
}

export function PlusGlyph() {
  return (
    <svg {...common}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

export function DotsGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="8" cy="3.5" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="8" cy="12.5" r="1.4" />
    </svg>
  )
}

export function PenGlyph() {
  return (
    <svg {...common}>
      <path d="M11.5 2.5l2 2L6 12H4v-2z" />
    </svg>
  )
}

export function TrashGlyph() {
  return (
    <svg {...common}>
      <path d="M3 4.5h10M6.5 2.5h3M4.5 4.5l.7 8.5h5.6l.7-8.5" />
    </svg>
  )
}

export function ForkGlyph() {
  return (
    <svg {...common}>
      <circle cx="4" cy="3.5" r="1.5" />
      <circle cx="12" cy="3.5" r="1.5" />
      <circle cx="8" cy="12.5" r="1.5" />
      <path d="M4 5v1.5a2 2 0 002 2h4a2 2 0 002-2V5M8 8.5V11" />
    </svg>
  )
}

export function ListGlyph() {
  return (
    <svg {...common}>
      <path d="M3 4h10M3 8h10M3 12h7" />
    </svg>
  )
}
