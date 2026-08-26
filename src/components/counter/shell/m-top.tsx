"use client"

import { useId, useState, type CSSProperties, type ReactNode } from "react"
import { PhoneSheet } from "./phone-sheet"
import { STAGE_TAG, type SwitchableStore } from "./store-switcher"

/**
 * `.mtop` — the phone's top chrome, and the control surface `/m` lost when the
 * editorial mobile home was replaced by Counter's Overview.
 *
 * `phoneFor()` at line 8742 of `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="mtop">
 *   <button class="mback">‹ Overview</button>          ← only on a sub-page
 *   <span class="st">Hollywood ⌄</span>
 *   <span style="margin-left:auto">{CD.chip()}</span>
 * </div>
 * ```
 *
 * It sits OUTSIDE `.mscroll`, which is why it is outside the fidelity
 * surface — `SURFACE_ROOT.phone` is `#phoneHost .pframe .mscroll`, so nothing
 * here is measured against the prototype by `npm run fidelity`. That is not a
 * reason for it to be approximate. It is the reason it has to be right by
 * reading, and every element below is the prototype's own.
 *
 * ## Why this had to be built now
 *
 * The page reads `?range`, `?store` and `?cmp`, so a redirect from
 * `/dashboard?range=d7` lands on the right window — but before this, a
 * PHONE-ONLY reader could not change any of the three. That is a functional
 * regression, not a cosmetic gap: the editorial `MToolbar` this page replaced
 * did offer a store and a period control. Driving Counter's range from that
 * toolbar's own `?period=` vocabulary instead would have put two range
 * vocabularies on one page, which is note 60's defect exactly. So the controls
 * are rebuilt on the prototype's own phone chrome and write the same three
 * parameters the desk writes.
 *
 * ## The one thing the prototype does NOT have, and this must
 *
 * **`.st` is a `<span>` in the prototype and it opens nothing.** It carries a
 * chevron — the universal promise of a picker — and there is no picker behind
 * it anywhere in the file. That is note 46's defect ("markup that looks wired
 * and is not") sitting in the design itself. A `<button>` with a real sheet is
 * what the chevron already claims, and `.mtop .st` styles a button unchanged
 * (`font-weight`, `font-size`, `display:flex`, `gap`, `letter-spacing` — no
 * element-specific rule among them).
 *
 * The sheet it opens is composed from the prototype's own two pieces rather
 * than invented: `.msheet`, the phone's sheet, holding the `.storeopt` rows
 * the rail's store popover already uses on the desk. `.storeopt` is styled
 * standalone (counter-components.css:748–754) — the only thing `.storepop`
 * contributes is the popover box, which is exactly what a phone replaces with
 * a sheet. The stage words and their `.mtag` tones are `StoreSwitcher`'s, so
 * one store cannot be "Trading" here and something else in the rail.
 *
 * `.mback` is not emitted: `trailOf('overview')` is empty in the prototype
 * because Overview is a root tab, and a back button to nowhere is the same
 * defect as a chevron to nowhere. It stays a prop for the pages that do have
 * a trail.
 *
 * WHERE THE SHEETS SIT IN THE DOM. The prototype emits `CD.sheet()` at
 * `.pframe` level, after `.mscroll`. Ours are rendered next to their triggers
 * instead, which changes no layout — both are `position:fixed` and out of flow
 * — and keeps a trigger's `aria-controls` pointed at a sheet that is mounted
 * whenever the trigger is.
 */

/** The prototype's own chevron on `.st`, at its own stroke width. */
function StoreChevron() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M4 6.5L8 10.5 12 6.5" />
    </svg>
  )
}

/** The prototype's own `style="margin-left:auto"` on the date chip's wrapper. */
const DATE_SLOT: CSSProperties = { marginLeft: "auto" }

export interface MTopProps {
  stores: SwitchableStore[]
  /** null means all stores — the absence of a store, not a magic "all" id. */
  selectedStoreId: string | null
  onSelectStore: (id: string | null) => void
  /** The date control. `MDateSheet` on every page that has a window. */
  date?: ReactNode
  /** `.mback`, for a page with a trail. Overview is a root tab and has none. */
  back?: ReactNode
}

export function MTop({ stores, selectedStoreId, onSelectStore, date, back }: MTopProps) {
  const [open, setOpen] = useState(false)
  const sheetId = useId()

  const selected = selectedStoreId === null
    ? null
    : (stores.find((s) => s.id === selectedStoreId) ?? null)

  const choose = (id: string | null) => {
    onSelectStore(id)
    setOpen(false)
  }

  return (
    <div className="mtop">
      {back}

      <button
        className="st"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={sheetId}
        onClick={() => setOpen(true)}
      >
        {selected ? selected.name : "All stores"}
        <StoreChevron />
      </button>

      <PhoneSheet open={open} onClose={() => setOpen(false)} title="Pick a store" id={sheetId}>
        <button
          type="button"
          className="storeopt"
          aria-pressed={selectedStoreId === null}
          onClick={() => choose(null)}
        >
          <span>
            <b>All stores</b>
          </span>
          <span className="mtag">{stores.length}</span>
        </button>
        {stores.map((store) => {
          const tag = STAGE_TAG[store.stage]
          return (
            <button
              key={store.id}
              type="button"
              className="storeopt"
              aria-pressed={store.id === selectedStoreId}
              onClick={() => choose(store.id)}
            >
              <span>
                <b>{store.name}</b>
              </span>
              <span className={tag.className}>{tag.label}</span>
            </button>
          )
        })}
      </PhoneSheet>

      {date ? <span style={DATE_SLOT}>{date}</span> : null}
    </div>
  )
}
