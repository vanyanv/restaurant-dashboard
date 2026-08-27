import type { CSSProperties, ReactNode } from "react"
import { SearchGlyph } from "./search-glyph"

export interface FilterToggle {
  /** Stable id — the value written to the URL. */
  id: string
  label: string
  /** A `ct-` custom property NAME, e.g. "--ch-dd". Never a colour literal. */
  tint?: string
  pressed: boolean
  /**
   * How many rows are behind this toggle, printed after its label.
   *
   * Ruling N-R1, from the alert inbox: four of that page's five source
   * toggles have never matched a single row, and a toggle that silently
   * filters to nothing is worse than one that says `Price moves 0`. Optional,
   * because the orders page's four channels have no such problem and the
   * prototype draws them as bare words.
   */
  count?: number
  /**
   * Nothing to filter: the toggle still RENDERS — the landmark count must not
   * change with the data — and cannot be pressed.
   */
  disabled?: boolean
}

/**
 * `.togs` — the row of toggles, on its own.
 *
 * Extracted so the alert inbox's SECOND filter row (`P.alerts.desk`, line
 * 4788: a `.mono` caption and five source toggles, with no search box, no
 * clear and no count) emits the same `.tog` DOM as this one. A second copy of
 * `aria-pressed` + `--pc` + `<i/>` is how one of the two rows comes to be
 * styled by a rule the other one has moved off.
 */
export function Toggles({
  toggles,
  onToggle,
}: {
  toggles: FilterToggle[]
  onToggle: (id: string) => void
}): ReactNode {
  return (
    <div className="togs">
      {toggles.map((t) => (
        <button
          key={t.id}
          className="tog"
          type="button"
          style={t.tint ? ({ "--pc": `var(${t.tint})` } as CSSProperties) : undefined}
          aria-pressed={t.pressed}
          disabled={t.disabled}
          onClick={() => onToggle(t.id)}
        >
          <i />
          {t.count === undefined ? t.label : `${t.label} ${t.count}`}
        </button>
      ))}
    </div>
  )
}

/**
 * Filters that visibly filter: a search box, a row of channel toggles, a
 * clear affordance, and the count of what's left.
 *
 * Ported from `P.orders.desk()` at line 4857 of
 * `docs/counter/counter-prototype.html`:
 *
 *   <div class="filters">
 *     <label class="search">{svg('search')}<input type="search" …></label>
 *     <div class="togs">
 *       <button class="tog" type="button" style="--pc:var(--ch-dd)" aria-pressed="true"><i></i>DoorDash</button>
 *       …
 *     </div>
 *     <button class="clear" type="button">Clear filters</button>
 *     <span class="count">8 of 187</span>
 *   </div>
 *
 * Three details the ported sheet (`src/styles/counter-components.css:220-233`)
 * makes load-bearing, all called out in the task brief:
 *
 * - `.clear` is emitted always and hidden with the `hidden` attribute when
 *   `onClear` is undefined — never conditionally absent, so the landmark
 *   count doesn't change between a filtered and an unfiltered render.
 * - Every `.tog` carries `aria-pressed`, both values, always — the pressed
 *   style (`.tog[aria-pressed="true"]`) has no other hook.
 * - `.tog i` reads `var(--pc, var(--ink-3))`. A toggle with no `tint` omits
 *   the inline `style` entirely (never `--pc:none`) so it inherits the
 *   fallback ink colour.
 *
 * `tint` is a bare custom-property NAME (`"--ch-dd"`), matching the prop
 * interface's own doc comment — this component is what wraps it in `var(…)`
 * for the inline style, so callers never write a `var()` string themselves.
 */
export function Filters(props: {
  search: string
  searchPlaceholder: string
  searchLabel: string
  onSearch: (next: string) => void
  toggles: FilterToggle[]
  onToggle: (id: string) => void
  /** Shown only when something is actually filtered. */
  onClear?: () => void
  /** The prototype's `8 of 187`. Pre-formatted. */
  count: string
}): ReactNode {
  const { search, searchPlaceholder, searchLabel, onSearch, toggles, onToggle, onClear, count } = props

  return (
    <div className="filters">
      <label className="search">
        <SearchGlyph />
        <input
          type="search"
          placeholder={searchPlaceholder}
          aria-label={searchLabel}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </label>
      <Toggles toggles={toggles} onToggle={onToggle} />
      <button className="clear" type="button" hidden={!onClear} onClick={onClear}>
        Clear filters
      </button>
      <span className="count">{count}</span>
    </div>
  )
}
