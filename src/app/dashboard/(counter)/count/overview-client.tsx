"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Section, useCounterTransition, usePageChrome, useSurfaceHref } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { ShelfData, ShelfLine, ShelfSections, StoreShelf } from "@/lib/counter/adapters/inventory-shelf"
import { ALL_STORES, needsOrderNow, type ShelfState } from "@/lib/counter/shelf-state"
import { CountHead, StoreSwitch, money } from "./count-ui"
import { Block, DaysBar, Fresh, Legend, MiniMap, PinnedActions, ShelfMap, Tiles, coverageSay } from "./shelf-ui"

/**
 * Inventory — Overview. What to order, first: one number, one sentence, the
 * draft order one tap away; then the three groups (out now, order today,
 * order soon), the shelf as a picture, the three money figures, and whatever
 * needs the owner, folded. One client for the desk and the phone: the layout
 * follows the width it is given, not the route.
 */
export function OverviewClient({ sections }: { sections: SectionSources<ShelfSections> }) {
  usePageChrome({ leaf: "Overview" })
  const { pending } = useCounterTransition()
  return (
    <>
      <CountHead sub="What to order, and what is on the shelf" />
      <Section bare title="Inventory" data={sections.shelf} pending={pending}>
        {(d) =>
          d ? (
            <>
              <StoreSwitch data={d} allView />
              {d.view === ALL_STORES ? <AllStores data={d} /> : <OneStore data={d} shelf={d.shelves[0]} />}
            </>
          ) : null
        }
      </Section>
    </>
  )
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** One row per item: an item counted at two stops is ordered once. */
function byItem(lines: ShelfLine[]): ShelfLine[] {
  const seen = new Map<string, ShelfLine>()
  for (const l of lines) {
    const had = seen.get(l.ingredientId)
    if (!had) seen.set(l.ingredientId, l)
    else if (l.typed) seen.set(l.ingredientId, { ...had, typed: [had.typed, l.typed].filter(Boolean).join("; "), amount: null })
  }
  return [...seen.values()]
}

function groupsOf(shelf: StoreShelf) {
  const of = (s: ShelfState) => byItem(shelf.lines.filter((l) => l.state === s))
  return { out: of("out"), now: of("order_now"), soon: of("order_soon") }
}

// ---------------------------------------------------------------------------
// One store
// ---------------------------------------------------------------------------

function OneStore({ data, shelf }: { data: ShelfData; shelf: StoreShelf }) {
  const href = useSurfaceHref()
  const g = groupsOf(shelf)
  return (
    <>
    <PinnedActions shelf={shelf} />
    <div className="iv-c">
    <div className="iv iv--one">
      <div className="iv-a-fresh"><Fresh shelf={shelf} /></div>
      <Lead shelf={shelf} out={g.out.length} now={g.now.length} soon={g.soon.length} />

      {(g.out.length > 0 || g.now.length > 0 || g.soon.length > 0) && (
        <div className="iv-a-buckets iv-buckets">
          {g.out.length > 0 && <Bucket state="out" title="Out now" rows={g.out} barDays={data.barDays} />}
          {g.now.length > 0 && <Bucket state="order_now" title="Order today" rows={g.now} barDays={data.barDays} />}
          {g.soon.length > 0 && <Bucket state="order_soon" title={shelf.soonTitle} rows={g.soon} barDays={data.barDays} fold />}
        </div>
      )}

      {shelf.lines.length > 0 && (
        <section className="iv-card iv-a-map" aria-label="The shelf at a glance">
          <div className="iv-card__h">
            <b>The shelf at a glance</b>
            <Link className="iv-link" href={href(`/dashboard/count/shelf?store=${shelf.id}`)}>Shelf ›</Link>
          </div>
          <ShelfMap shelf={shelf} areas={data.areas} />
          <Legend counts={shelf.counts} soonLabel={shelf.soonTitle} />
        </section>
      )}

      <div className="iv-a-tiles"><Tiles shelf={shelf} /></div>
      <Needs shelf={shelf} />
    </div>
    </div>
    </>
  )
}

/** `out` and `now` are items, as `toOrder` is: an item on two shelves is ordered once, and the sentence adds up to the number. */
function Lead({ shelf, out, now, soon }: { shelf: StoreShelf; out: number; now: number; soon: number }) {
  const href = useSurfaceHref()
  const c = shelf.counts
  const n = shelf.toOrder
  const orderHref = href(`/dashboard/count/orders?store=${shelf.id}`)

  if (shelf.lines.length === 0) {
    return (
      <section className="iv-card iv-lead iv-a-lead" aria-label="What to order">
        <div className="iv-lead__n iv-lead__n--text"><strong>No count list yet</strong></div>
        <p className="iv-say">Pick what you count and how it comes in, once, and it is here every week.</p>
        <Link className="iv-btn iv-btn--primary" href={href("/dashboard/count/setup")}>Set up the count list</Link>
      </section>
    )
  }
  if (n === null) {
    return (
      <section className="iv-card iv-lead iv-a-lead" aria-label="What to order">
        <div className="iv-lead__n iv-lead__n--text"><strong>Not counted yet</strong></div>
        <p className="iv-say">
          {shelf.name} has no finished count{shelf.skip ? " from before the last 7 days" : ""}, so there is nothing to order from yet.
          <small>{shelf.openCount !== null ? `A count is open with ${plural(shelf.openCount, "line")} saved. Finish it and the order appears here.` : "Count the shelves once and this page fills in."}</small>
        </p>
        <Link className="iv-btn iv-btn--ink" href={href(`/dashboard/count/walk?store=${shelf.id}`)}>
          {shelf.openCount !== null ? `Resume count · ${shelf.name}` : `Count ${shelf.name}`}
        </Link>
      </section>
    )
  }

  const parts: string[] = []
  if (out > 0) parts.push(`${out === 1 ? "1 item is" : `${out} items are`} out`)
  if (now > 0) parts.push(`${now} ${now === 1 ? "has" : "have"} to be ordered today to arrive in time`)
  const say = n === 0
    ? "Nothing has to be ordered today."
    : `${parts.join(" and ")}.`
  const more: string[] = []
  if (soon > 0) more.push(`${soon} more: ${shelf.soonTitle.replace(/^Order/, "order")}.`)
  if (c.cant_tell > 0) more.push(`${plural(c.cant_tell, "line")} can't be read yet.`)
  if (c.not_counted > 0) more.push(`${plural(c.not_counted, "line")} not counted.`)
  if (shelf.skip) more.push(`Skip this week's count is on, so this is read from the ${shelf.lastCount?.day ?? "older"} count.`)
  else if (shelf.lastCount?.stale) more.push(`The count is from ${shelf.lastCount.ago}, so this has drifted.`)

  return (
    <section className="iv-card iv-lead iv-a-lead" aria-label="What to order">
      <div className="iv-lead__n">
        <strong>{n}</strong>
        <span>to order now</span>
      </div>
      <p className="iv-say">
        {say}
        {more.length > 0 && <small>{more.join(" ")}</small>}
      </p>
      {shelf.draftVendors > 0 ? (
        <Link className="iv-btn iv-btn--primary" href={orderHref}>
          Open draft order · {plural(shelf.draftVendors, "vendor")}
        </Link>
      ) : (
        <p className="iv-quiet">
          No draft yet{n > 0 ? ": nothing on the menu uses these lines, so the app can't size an order" : ""}.{" "}
          <Link className="iv-link" href={orderHref}>Open Order</Link>
        </p>
      )}
    </section>
  )
}

function Bucket({
  state,
  title,
  rows,
  barDays,
  fold = false,
}: {
  state: ShelfState
  title: string
  rows: ShelfLine[]
  barDays: number
  fold?: boolean
}) {
  // Folded where the page is one column; open where there is room for it
  // beside the other two. Decided after mount so the server and the first
  // paint agree.
  const [open, setOpen] = useState(!fold)
  useEffect(() => {
    if (fold && window.matchMedia("(min-width: 1100px)").matches) setOpen(true)
  }, [fold])
  const head = (
    <>
      <Block state={state} size="key" />
      <b>{title}</b>
      <span className="n">{rows.length}</span>
    </>
  )
  const list = (
    <ul className="iv-olist">
      {rows.map((r) => (
        <li key={r.id} className="iv-o">
          <div className="iv-o__l">
            <b>{r.name}</b>
            {(r.typed || r.amount) && (
              <span>
                {r.typed ? <em>{r.typed}</em> : null}
                {r.typed && r.amount ? " · " : null}
                {r.amount}
              </span>
            )}
            <DaysBar line={r} barDays={barDays} />
            {r.from ? <span>From the {r.from} count</span> : null}
          </div>
          <div className="iv-o__r">
            {r.order ? <b>Order {r.order}</b> : <b className="soft">No draft yet</b>}
            {r.belowZero
              ? <small>Reads below zero: count it again</small>
              : r.vendor ? <small>{r.order ? "from" : "last from"} {r.vendor}</small> : null}
            {fold && needsOrderNow(r.state) === false && r.when && r.when !== title ? <small>{r.when}</small> : null}
          </div>
        </li>
      ))}
    </ul>
  )
  if (!fold) {
    return (
      <section className="iv-bucket" aria-label={`${title}, ${rows.length}`}>
        <div className="iv-bucket__h">{head}</div>
        {list}
      </section>
    )
  }
  return (
    <details className="iv-bucket" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="iv-bucket__h">
        {head}
        {!open && <small>{preview(rows)}</small>}
      </summary>
      {list}
    </details>
  )
}

function preview(rows: ShelfLine[]): string {
  const names = rows.slice(0, 3).map((r) => r.name)
  return rows.length > 3 ? `${names.join(", ")} and ${rows.length - 3} more` : names.join(", ")
}

/** What only the owner can fix, folded. One button per group. */
function Needs({ shelf }: { shelf: StoreShelf }) {
  const href = useSurfaceHref()
  const counted = shelf.lines.filter((l) => l.state !== "not_counted")
  const unsized = counted.filter((l) => l.notValuedWhy === "size")
  const unpriced = counted.filter((l) => l.notValuedWhy === "price")
  const changed = counted.filter((l) => l.notValuedWhy === "boxes")
  const below = shelf.lines.filter((l) => l.belowZero)
  const never = shelf.lastCount ? shelf.lines.filter((l) => l.state === "not_counted") : []
  const walk = href(`/dashboard/count/walk?store=${shelf.id}`)
  const groups = [
    unsized.length > 0 && {
      n: unsized.length,
      title: `${unsized.length === 1 ? "line" : "lines"} counted but not valued yet`,
      body: `A box on ${unsized.length === 1 ? "this line" : "these lines"} has no size yet, so the count can't be turned into an amount or dollars. Set the size once and every count after it is valued.`,
      names: unsized,
      btn: "Set sizes",
      to: href("/dashboard/count/setup"),
    },
    unpriced.length > 0 && {
      n: unpriced.length,
      title: `${unpriced.length === 1 ? "line has" : "lines have"} no price yet`,
      body: "A price comes from an invoice line matched to the item. Until one is, the line is counted but left out of the shelf total.",
      names: unpriced,
      btn: "Open Ingredients",
      to: href("/dashboard/ingredients"),
    },
    below.length > 0 && {
      n: below.length,
      title: `${below.length === 1 ? "count looks" : "counts look"} off`,
      body: "More was used or logged off since the count than was counted, so on hand reads below zero and the draft order leaves these out. A delivery may not be invoiced yet. Count again and the order can be trusted.",
      names: below,
      btn: `Count ${shelf.name}`,
      to: walk,
    },
    changed.length > 0 && {
      n: changed.length,
      title: `${changed.length === 1 ? "line" : "lines"} to count again`,
      body: "A size or a box was changed in Sizes & list after the count, so what was typed then can't be turned into an amount. Count again and they are valued.",
      names: changed,
      btn: `Count ${shelf.name}`,
      to: walk,
    },
    never.length > 0 && {
      n: never.length,
      title: `${never.length === 1 ? "line" : "lines"} never counted`,
      body: shelf.skip
        ? "Not on any count from before the last 7 days, which is all the page reads while this week's count is skipped. A blank is not a zero, so nothing is ordered from it."
        : `Not on any finished count at ${shelf.name} yet. A blank is not a zero, so nothing is ordered from it.`,
      names: never,
      btn: `Count ${shelf.name}`,
      to: walk,
    },
  ].filter((g): g is Exclude<typeof g, false> => g !== false)
  if (groups.length === 0) return null
  return (
    <section className="iv-card iv-a-needs" aria-label="Needs you">
      <div className="iv-card__h">
        <b>Needs you</b>
        <span className="iv-mono">{plural(groups.length, "group")}</span>
      </div>
      {groups.map((g) => (
        <details key={g.title} className="iv-need">
          <summary>
            <span className="n">{g.n}</span>
            <span>{g.title}</span>
          </summary>
          <div className="iv-need__b">
            <p>{g.body}</p>
            <p className="iv-need__names">{[...new Set(g.names.map((l) => l.name))].join(", ")}</p>
            <Link className="iv-btn iv-btn--sm" href={g.to}>{g.btn}</Link>
          </div>
        </details>
      ))}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Every store
// ---------------------------------------------------------------------------

function AllStores({ data }: { data: ShelfData }) {
  const counted = data.shelves.filter((s) => s.toOrder !== null)
  const blank = data.shelves.filter((s) => s.toOrder === null)
  const valued = data.shelves.filter((s) => s.coverage.dollars !== null)
  const total = valued.reduce((t, s) => t + (s.coverage.dollars ?? 0), 0)
  const n = data.shelves.length
  return (
    <>
    <PinnedActions shelf={null} />
    <div className="iv-c">
    <div className="iv iv--all">
      <p className="iv-say iv-a-say">
        {data.total === null
          ? `None of the ${n} stores has a finished count yet.`
          : data.total === 0
            ? `Nothing has to be ordered today at ${counted.length === n ? `any of the ${n} stores` : counted.map((s) => s.name).join(" or ")}.`
            : `${plural(data.total, "item")} to order now across ${counted.length === n ? `the ${n} stores` : counted.map((s) => s.name).join(" and ")}.`}
        {blank.length > 0 && data.total !== null && (
          <small>{blank.map((s) => s.name).join(" and ")} {blank.length === 1 ? "has" : "have"} no finished count, so {blank.length === 1 ? "it is" : "they are"} not in that number.</small>
        )}
      </p>
      <div className="iv-card iv-a-key"><Legend /></div>
      <div className="iv-stores">
        {data.shelves.map((s) => <StoreCard key={s.id} shelf={s} areas={data.areas} />)}
      </div>
      <div className="iv-card iv-tile iv-a-total">
        <span className="iv-mono">On the shelf · {valued.length} of {n} stores</span>
        {valued.length > 0 ? <strong>{money(total)}</strong> : <strong className="txt">Not valued yet</strong>}
        <span>
          {valued.length === 0
            ? "No store has a counted line with a value yet."
            : valued.length === n
              ? "The lines each store has valued, added up. Each store says how many that is."
              : `${valued.map((s) => s.name).join(" and ")} only. ${data.shelves.filter((s) => s.coverage.dollars === null).map((s) => s.name).join(" and ")} not added in.`}
        </span>
      </div>
    </div>
    </div>
    </>
  )
}

function StoreCard({ shelf, areas }: { shelf: StoreShelf; areas: ShelfData["areas"] }) {
  const href = useSurfaceHref()
  const g = groupsOf(shelf)
  const top = [...g.out, ...g.now]
  const c = shelf.coverage
  const open = href(`/dashboard/count?store=${shelf.id}`)
  return (
    <section className="iv-card iv-store" aria-label={shelf.name}>
      <div className="iv-store__h">
        <b>{shelf.name}</b>
        {!shelf.lastCount
          ? <span className="inv-pill inv-pill--mute">Not counted</span>
          : shelf.lastCount.stale
            ? <span className="inv-pill inv-pill--warn">Old count</span>
            : <span className="inv-pill inv-pill--good">Fresh</span>}
      </div>
      {shelf.toOrder === null ? (
        <div className="iv-store__n iv-store__n--text"><strong>Not counted yet</strong></div>
      ) : (
        <div className="iv-store__n"><strong>{shelf.toOrder}</strong><span>to order now</span></div>
      )}
      {shelf.lines.length > 0 && <MiniMap shelf={shelf} areas={areas} />}
      {top.length > 0 && (
        <ul className="iv-top3">
          {top.slice(0, 3).map((r) => (
            <li key={r.id}>
              <Block state={r.state} size="key" />
              <b>{r.name}</b>
              <em>{r.order ? `Order ${r.order}` : "No draft yet"}</em>
            </li>
          ))}
        </ul>
      )}
      {(top.length > 3 || g.soon.length > 0) && (
        <p className="iv-store__more">
          {top.length > 3 ? `${top.length - 3} more to order now. ` : ""}
          {g.soon.length > 0 ? `${g.soon.length} more: ${shelf.soonTitle.replace(/^Order/, "order")}.` : ""}
        </p>
      )}
      <p className="iv-store__m">
        {shelf.skip ? "Skipping this week's count. " : ""}
        {shelf.lastCount ? `Counted ${shelf.lastCount.day}, ${shelf.lastCount.ago}${shelf.lastCount.older > 0 ? `, ${plural(shelf.lastCount.older, "line")} from older counts` : ""}. ` : ""}
        {!shelf.lastCount && shelf.openCount !== null ? `A count is open with ${plural(shelf.openCount, "line")} saved. ` : ""}
        {c.dollars !== null ? <><b>{money(c.dollars)}</b> on the shelf, </> : null}
        {coverageSay(shelf)}
        {shelf.missing && shelf.missing.missingDollars !== null ? <> <b>{money(shelf.missing.missingDollars)}</b> went missing.</> : null}
        {shelf.waste.entries > 0 && shelf.waste.unpriced < shelf.waste.entries ? <> <b>{money(shelf.waste.dollars)}</b> thrown out.</> : null}
      </p>
      <div className="iv-store__btns">
        <Link className="iv-btn iv-btn--sm" href={open}>Open {shelf.name}</Link>
        {shelf.toOrder === null && (
          <Link className="iv-btn iv-btn--sm iv-btn--ink" href={href(`/dashboard/count/walk?store=${shelf.id}`)}>
            {shelf.openCount !== null ? "Resume count" : `Count ${shelf.name}`}
          </Link>
        )}
      </div>
    </section>
  )
}
