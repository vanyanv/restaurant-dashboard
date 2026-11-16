"use client"

import type { CSSProperties, ReactNode } from "react"
import Link from "next/link"
import { useSurfaceHref } from "@/components/counter"
import { SHELF_STATES, SHELF_STATE_LABEL, needsOrderNow, type ShelfState } from "@/lib/counter/shelf-state"
import type { ShelfData, ShelfLine, StoreShelf } from "@/lib/counter/adapters/inventory-shelf"
import { money } from "./count-ui"

/**
 * The pieces the Inventory Overview and the Shelf tab are both drawn from:
 * the block, the shelf map, the legend, the days-left bar and the count's
 * freshness line. A state is carried by SHAPE as well as colour (a cross, a
 * bang, a half fill, a solid, a dot, hatching, a dashed outline), so the map
 * reads without colour, and every block and section carries its words.
 */

/** A count-list section's lines, in the sheet's order. */
export function linesIn(lines: ShelfLine[], area: string): ShelfLine[] {
  return lines.filter((l) => l.area === area)
}

/** "1 out, 2 order today, 9 fine" for a set of lines: a section's accessible name. */
export function sayStates(lines: ReadonlyArray<{ state: ShelfState }>, soonLabel: string): string {
  const parts = SHELF_STATES.flatMap((s) => {
    const n = lines.filter((l) => l.state === s).length
    if (n === 0) return []
    const word = s === "order_soon" ? soonLabel : SHELF_STATE_LABEL[s]
    return [`${n} ${word.toLowerCase()}`]
  })
  return parts.join(", ")
}

export function Block({ state, title, size }: { state: ShelfState; title?: string; size?: "sm" | "key" }) {
  return <i className={`iv-bk iv-bk--${state}${size ? ` iv-bk--${size}` : ""}`} title={title} />
}

/** "Lettuce: Out". What a block says on hover, and to anything that reads the title. */
function blockTitle(l: ShelfLine): string {
  return `${l.name}: ${l.stateText}`
}

/**
 * One row per section of the sheet, one block per line. Each row is one
 * target (a link to that section on the Shelf tab, or a button that opens it),
 * tall enough to tap, and named with its section and what its lines say.
 */
export function ShelfMap({
  shelf,
  areas,
  onPick,
}: {
  shelf: StoreShelf
  areas: ShelfData["areas"]
  /** Given on the Shelf tab, where a row opens its section in place. */
  onPick?: (area: string) => void
}) {
  const href = useSurfaceHref()
  return (
    <div className="iv-map">
      {areas.map((a) => {
        const rows = linesIn(shelf.lines, a.id)
        if (rows.length === 0) return null
        const label = `${a.label}, ${rows.length} ${rows.length === 1 ? "line" : "lines"}: ${sayStates(rows, shelf.soonTitle)}`
        const body = (
          <>
            <span className="iv-map__l">
              <b>{a.label}</b>
              <i>{rows.length} {rows.length === 1 ? "line" : "lines"}</i>
            </span>
            <span className="iv-blocks" aria-hidden="true">
              {rows.map((l) => <Block key={l.id} state={l.state} title={blockTitle(l)} />)}
            </span>
          </>
        )
        return onPick ? (
          <button key={a.id} type="button" className="iv-map__s" aria-label={label} onClick={() => onPick(a.id)}>
            {body}
          </button>
        ) : (
          <Link key={a.id} className="iv-map__s" aria-label={label} href={href(`/dashboard/count/shelf?store=${shelf.id}#iv-sec-${a.id}`)}>
            {body}
          </Link>
        )
      })}
    </div>
  )
}

/** Every line of a store as one run of small blocks, a gap between sections. */
export function MiniMap({ shelf, areas }: { shelf: StoreShelf; areas: ShelfData["areas"] }) {
  const say = sayStates(shelf.lines, shelf.soonTitle)
  return (
    <div className="iv-blocks iv-blocks--sm" role="img" aria-label={`${shelf.name}, ${shelf.lines.length} lines: ${say}`}>
      {areas.flatMap((a) =>
        linesIn(shelf.lines, a.id).map((l, i) => (
          <i key={l.id} className={`iv-bk iv-bk--sm iv-bk--${l.state}${i === 0 ? " iv-bk--gap" : ""}`} title={blockTitle(l)} />
        )),
      )}
    </div>
  )
}

/** What each shape means, with how many lines are in it. */
export function Legend({ counts, soonLabel }: { counts?: Record<ShelfState, number>; soonLabel?: string }) {
  return (
    <ul className="iv-key" aria-label="What the blocks mean">
      {SHELF_STATES.map((s) => (
        <li key={s}>
          <Block state={s} size="key" />
          <span>{s === "order_soon" && soonLabel ? soonLabel : SHELF_STATE_LABEL[s]}</span>
          {counts ? <b>{counts[s]}</b> : null}
        </li>
      ))}
    </ul>
  )
}

const PILL: Record<ShelfState, string> = {
  out: "bad",
  order_now: "bad",
  order_soon: "warn",
  ok: "good",
  in_stock: "mute",
  cant_tell: "notyet",
  not_counted: "mute",
}

export function StatePill({ state, children }: { state: ShelfState; children: ReactNode }) {
  return <span className={`iv-pill iv-pill--${PILL[state]}`}>{children}</span>
}

export function NotYet({ children }: { children: ReactNode }) {
  return <span className="iv-pill iv-pill--notyet">{children}</span>
}

/**
 * Days left on a fixed scale, with a mark at the last day an order still
 * arrives in time. Drawn only when a use rate exists; the words beside it say
 * the same thing, so the bar is decoration to a screen reader.
 */
export function DaysBar({ line, barDays }: { line: ShelfLine; barDays: number }) {
  if (line.daysLeft === null) return null
  const pct = (d: number) => `${Math.max(0, Math.min(100, (d / barDays) * 100))}%`
  const tone = needsOrderNow(line.state) ? "bad" : line.state === "order_soon" ? "warn" : "good"
  return (
    <span className="iv-days">
      <span className={`iv-bar iv-bar--${tone}`} aria-hidden="true">
        <i style={{ width: pct(line.daysLeft) }} />
        {line.orderAt !== null && line.orderAt < barDays ? <u style={{ left: pct(line.orderAt) } as CSSProperties} /> : null}
      </span>
      <span>{line.runsOut}</span>
    </span>
  )
}

/**
 * "Counted Sun, Nov 8, 2 days ago · 71 of 72 lines, 3 from older counts". An
 * item skipped on the last count keeps its older number, and this says how
 * many lines that is.
 */
export function freshSay(shelf: StoreShelf): string {
  const c = shelf.coverage
  const last = shelf.lastCount
  if (!last) return shelf.skip ? "No finished count from before the last 7 days." : "No finished count yet."
  const older = last.older > 0 ? `, ${last.older} from older counts` : ""
  return `Counted ${last.day}, ${last.ago} · ${c.counted} of ${c.lines} lines${older}`
}

/** The freshness line: how old the count is, and whether this week's is being skipped. */
export function Fresh({ shelf }: { shelf: StoreShelf }) {
  const skip = shelf.skip ? <span className="iv-pill iv-pill--warn">Skipping this week&apos;s count</span> : null
  // The skip is a switch on the Order tab; said here because it changes every figure on the page.
  const skipSay = shelf.skip ? <span>Counts from the last 7 days are left out, here and on the draft order.</span> : null
  if (!shelf.lastCount) {
    return (
      <p className="iv-fresh">
        <span className="iv-pill iv-pill--mute">Not counted</span>
        {skip}
        <span>{shelf.skip ? `${shelf.name} has no finished count from before the last 7 days.` : `${shelf.name} has no finished count yet.`}</span>
        {skipSay}
      </p>
    )
  }
  return (
    <p className="iv-fresh">
      {shelf.lastCount.stale
        ? <span className="iv-pill iv-pill--warn">Old count</span>
        : <span className="iv-pill iv-pill--good">Fresh</span>}
      {skip}
      <span>{freshSay(shelf)}</span>
      {skipSay}
    </p>
  )
}

/** The "On the shelf" figure and exactly what it covers. */
export function coverageSay(shelf: StoreShelf): string {
  const c = shelf.coverage
  if (c.counted === 0) return `None of the ${c.lines} lines are counted yet.`
  const parts = [`${c.valued} of ${c.lines} lines`]
  if (c.notValued > 0) parts.push(`${c.notValued} not valued yet`)
  if (c.notCounted > 0) parts.push(`${c.notCounted} not counted`)
  return `${parts.join(". ")}.`
}

/** The valued share of the list as a bar: solid valued, hatched not valued yet, empty not counted. */
export function CoverBar({ shelf }: { shelf: StoreShelf }) {
  const c = shelf.coverage
  if (c.lines === 0) return null
  return (
    <span className="iv-cover" aria-hidden="true">
      {c.valued > 0 ? <i style={{ flexGrow: c.valued }} /> : null}
      {c.notValued > 0 ? <i className="ny" style={{ flexGrow: c.notValued }} /> : null}
      {c.notCounted > 0 ? <i className="nc" style={{ flexGrow: c.notCounted }} /> : null}
    </span>
  )
}

/** The three money tiles. Each says what it covers; an unknown is words, never $0. */
export function Tiles({ shelf }: { shelf: StoreShelf }) {
  const c = shelf.coverage
  const w = shelf.waste
  const g = shelf.missing
  return (
    <div className="iv-tri">
      <div className="iv-card iv-tile">
        <span className="iv-mono">On the shelf</span>
        {c.dollars !== null ? <strong>{money(c.dollars)}</strong> : <strong className="txt">{c.counted === 0 ? "Not counted yet" : "Not valued yet"}</strong>}
        <CoverBar shelf={shelf} />
        <span>
          {coverageSay(shelf)}
          {shelf.lastCount && c.dollars !== null
            ? shelf.lastCount.older > 0
              ? ` Last counted ${shelf.lastCount.day}; ${shelf.lastCount.older} ${shelf.lastCount.older === 1 ? "line is" : "lines are"} from older counts.`
              : ` As counted ${shelf.lastCount.day}.`
            : ""}
        </span>
      </div>
      <div className="iv-card iv-tile">
        <span className="iv-mono">Went missing</span>
        {/* A figure only when something was compared and priced; otherwise words, never $0. */}
        {!g
          ? <strong className="txt">Needs two counts</strong>
          : g.items === 0
            ? <strong className="txt">Nothing to compare</strong>
            : g.missingDollars === null
              ? <strong className="txt">Not valued yet</strong>
              : <strong>{money(g.missingDollars)}</strong>}
        <span>
          {!g
            ? "Nothing to compare until this store is counted twice."
            : g.items === 0
              ? `No item was counted on both ${g.from} and ${g.to}.`
              : `${g.items} ${g.items === 1 ? "item" : "items"} compared, ${g.from} to ${g.to}.${
                  g.missingDollars === null ? " None has a price yet." : g.unpriced > 0 ? ` ${g.unpriced} without a price not included.` : ""
                }`}
        </span>
      </div>
      <div className="iv-card iv-tile">
        <span className="iv-mono">Thrown out</span>
        {w.entries === 0
          ? <strong className="txt">Nothing logged</strong>
          : w.unpriced === w.entries
            ? <strong className="txt">Not valued yet</strong>
            : <strong>{money(w.dollars)}</strong>}
        <span>
          Last 7 days{w.entries > 0 ? `, ${w.entries} ${w.entries === 1 ? "entry" : "entries"}` : ""}.
          {w.unpriced > 0 ? ` ${w.unpriced} without a price not included.` : ""}
        </span>
      </div>
    </div>
  )
}

/** The pinned actions: start or pick up the count, and log waste. */
export function PinnedActions({ shelf, children }: { shelf: StoreShelf | null; children?: ReactNode }) {
  const href = useSurfaceHref()
  const q = shelf ? `?store=${shelf.id}` : ""
  return (
    <div className="iv-foot">
      <Link className="iv-btn iv-btn--ink" href={href(`/dashboard/count/walk${q}`)}>
        {shelf ? (shelf.openCount !== null ? `Resume count · ${shelf.name}` : `Count ${shelf.name}`) : "Count a store"}
      </Link>
      {children ?? <Link className="iv-btn" href={href(`/dashboard/count/waste${q}`)}>Log waste</Link>}
    </div>
  )
}
