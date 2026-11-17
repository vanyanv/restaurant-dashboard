"use client"

import { useEffect, useState, useEffectEvent } from "react"
import Link from "next/link"
import { Section, useCounterTransition, usePageChrome, useSurfaceHref } from "@/components/counter"
import { useUrlParam } from "@/components/counter/keep/use-url-param"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { ShelfData, ShelfLine, ShelfSections, StoreShelf } from "@/lib/counter/adapters/inventory-shelf"
import { ALL_STORES, needsOrderNow, shelfCoverage } from "@/lib/counter/shelf-state"
import { CountHead, StoreSwitch, money } from "../count-ui"
import { ItemLink } from "../picture-ui"
import { DaysBar, Fresh, Legend, MiniMap, NotYet, PinnedActions, ShelfMap, StatePill, freshSay, linesIn } from "../shelf-ui"

/**
 * Inventory — Shelf. The shelf map, then the last count line by line in the
 * sheet's own sections: what was typed, what that comes to where the sizes
 * are known, how long it lasts where something uses it, and what was typed
 * on the count before. A line the app cannot value says "Not valued yet" and
 * why. A row opens the item's own page. With every store picked it is
 * the three maps side by side.
 */
export function ShelfClient({ sections }: { sections: SectionSources<ShelfSections> }) {
  usePageChrome({ leaf: "Shelf" })
  const { pending } = useCounterTransition()
  return (
    <>
      <CountHead sub="The last count, line by line" />
      <Section bare title="Shelf" data={sections.shelf} pending={pending}>
        {(d) =>
          d ? (
            <>
              <StoreSwitch data={d} allView />
              {d.view === ALL_STORES ? <AllShelves data={d} /> : <OneShelf key={d.shelves[0].id} data={d} shelf={d.shelves[0]} />}
            </>
          ) : null
        }
      </Section>
    </>
  )
}

type Show = "all" | "order" | "notvalued"

function matches(l: ShelfLine, show: Show): boolean {
  if (show === "order") return needsOrderNow(l.state) || l.state === "order_soon"
  if (show === "notvalued") return l.notValuedWhy !== null
  return true
}

function OneShelf({ data, shelf }: { data: ShelfData; shelf: StoreShelf }) {
  const href = useSurfaceHref()
  // The filter lives in the URL, so Back and a reload bring it back.
  const [raw, setShow] = useUrlParam("show", "all")
  const show: Show = raw === "order" || raw === "notvalued" ? raw : "all"
  const toOrder = shelf.lines.filter((l) => matches(l, "order")).length
  const notValued = shelf.lines.filter((l) => matches(l, "notvalued")).length
  // Sections with something to order start open; the rest are one tap away.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(data.areas.filter((a) => linesIn(shelf.lines, a.id).some((l) => needsOrderNow(l.state))).map((a) => a.id)),
  )
  const toggle = (area: string, on: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (on) next.add(area)
      else next.delete(area)
      return next
    })
  const pick = (area: string) => {
    if (show !== "all" && !linesIn(shelf.lines, area).some((l) => matches(l, show))) setShow("all")
    toggle(area, true)
    // After the section has opened and the list has its new height.
    requestAnimationFrame(() => document.getElementById(`iv-sec-${area}`)?.scrollIntoView({ block: "start", behavior: "smooth" }))
  }

  // A link from the Overview's map names its section in the hash: open it.
  // Once, for the hash the page arrived with.
  const openFromHash = useEffectEvent(() => {
    const area = window.location.hash.replace(/^#iv-sec-/, "")
    if (area && data.areas.some((a) => a.id === area)) toggle(area, true)
  })
  useEffect(() => openFromHash(), [])

  if (shelf.lines.length === 0) {
    return (
      <div className="iv iv--shelf">
        <section className="iv-card iv-lead" aria-label="Shelf">
          <div className="iv-lead__n iv-lead__n--text"><strong>No count list yet</strong></div>
          <p className="iv-say">Pick what you count and how it comes in, once, and it is here every week.</p>
          <Link className="iv-btn iv-btn--primary" href={href("/dashboard/count/setup")}>Set up the count list</Link>
        </section>
      </div>
    )
  }

  const chips: Array<[Show, string]> = [
    ["all", `All ${shelf.lines.length}`],
    ["order", `To order ${toOrder}`],
    ["notvalued", `Not valued yet ${notValued}`],
  ]
  return (
    <>
    <PinnedActions shelf={shelf}>
      <Link className="iv-btn" href={href("/dashboard/count/setup")}>Sizes &amp; list</Link>
    </PinnedActions>
    <div className="iv-c">
    <div className="iv iv--shelf">
      <Fresh shelf={shelf} />
      <section className="iv-card" aria-label={`${shelf.name}, line by line`}>
        <div className="iv-card__h">
          <b>{shelf.name}, line by line</b>
          <span className="iv-mono">Tap a section</span>
        </div>
        <ShelfMap shelf={shelf} areas={data.areas} onPick={pick} />
        <Legend counts={shelf.counts} soonLabel={shelf.soonTitle} />
      </section>

      <div className="iv-chips" role="group" aria-label="Show">
        {chips.map(([id, label]) => (
          <button key={id} type="button" className="iv-chip" aria-pressed={show === id} onClick={() => setShow(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="iv-accs">
        {data.areas.map((a) => {
          const all = linesIn(shelf.lines, a.id)
          if (all.length === 0) return null
          const rows = all.filter((l) => matches(l, show))
          if (show !== "all" && rows.length === 0) return null
          const cov = shelfCoverage(all)
          const sub = [
            `${all.length} ${all.length === 1 ? "line" : "lines"}`,
            cov.counted === 0 ? "not counted" : cov.notValued > 0 ? `${cov.notValued} not valued yet` : "all valued",
            cov.counted > 0 && cov.notCounted > 0 ? `${cov.notCounted} not counted` : null,
          ].filter(Boolean).join(" · ")
          return (
            <details
              key={a.id}
              id={`iv-sec-${a.id}`}
              className="iv-acc"
              // A filter shows only what matches, so every section left is open.
              open={show !== "all" || open.has(a.id)}
              onToggle={(e) => { if (show === "all") toggle(a.id, e.currentTarget.open) }}
            >
              <summary>
                <b>{a.label}</b>
                {cov.dollars !== null ? <span className="v">{money(cov.dollars)}</span> : <span className="v v--none">No total yet</span>}
                <small>{sub}</small>
              </summary>
              <ul className="iv-rows">
                {rows.map((l) => <Row key={l.id} line={l} store={shelf.id} barDays={data.barDays} />)}
              </ul>
            </details>
          )
        })}
        {show !== "all" && (show === "order" ? toOrder : notValued) === 0 && (
          <p className="iv-quiet iv-card iv-pad">
            {show === "order" ? "Nothing on the last count has to be ordered." : "Every counted line has a value."}
          </p>
        )}
      </div>

    </div>
    </div>
    </>
  )
}

/** One line of the sheet. The whole row opens the item's own page. */
function Row({ line: l, store, barDays }: { line: ShelfLine; store: string; barDays: number }) {
  const href = useSurfaceHref()
  return (
    <li className="iv-it">
      <div className="iv-it__h">
        <b><ItemLink id={l.ingredientId} store={store} className="iv-open">{l.name}</ItemLink></b>
        <StatePill state={l.state}>{l.stateText}</StatePill>
      </div>
      {l.state !== "not_counted" && (l.typed || l.amount || l.dollars !== null || l.notValued) && (
        <div className="iv-it__c">
          <span>
            {l.typed ? <em>{l.typed}</em> : null}
            {l.typed && l.amount && l.notValuedWhy !== "size" ? " · " : null}
            {/* With a box that has no size, the converted amount is only part of the shelf: it is not shown as the shelf. */}
            {l.notValuedWhy !== "size" ? l.amount : null}
          </span>
          {l.dollars !== null
            ? <span className="v">{money(l.dollars)}</span>
            // One "Not valued yet" a row: the state pill says it for a box with no size.
            : l.notValuedWhy === "price" || l.notValuedWhy === "boxes" ? <NotYet>Not valued yet</NotYet> : null}
        </div>
      )}
      <DaysBar line={l} barDays={barDays} />
      {l.notValued && (
        <p className="iv-it__x">
          {l.notValued}.{" "}
          {l.notValuedWhy === "size" ? <Link className="iv-link" href={href("/dashboard/count/setup")}>Set sizes</Link> : null}
        </p>
      )}
      {l.note && <p className="iv-it__x">{l.note}.</p>}
      {l.from && <p className="iv-it__x">From the {l.from} count.</p>}
      {l.last && <p className="iv-it__x">Last count, {l.last.day}: {l.last.typed}.</p>}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Every store
// ---------------------------------------------------------------------------

function AllShelves({ data }: { data: ShelfData }) {
  const href = useSurfaceHref()
  const n = data.shelves.length
  const lines = data.shelves[0]?.lines ?? []
  return (
    <>
    <PinnedActions shelf={null}>
      <Link className="iv-btn" href={href("/dashboard/count/setup")}>Sizes &amp; list</Link>
    </PinnedActions>
    <div className="iv-c">
    <div className="iv iv--all">
      <p className="iv-say">
        {n} shelves, one block per line.
        <small>Blocks are in your sheet&apos;s order, section by section.</small>
      </p>
      <div className="iv-card"><Legend /></div>
      <div className="iv-stores">
        {data.shelves.map((s) => (
          <section key={s.id} className="iv-card iv-store" aria-label={s.name}>
            <div className="iv-store__h">
              <b>{s.name}</b>
              {!s.lastCount
                ? <span className="iv-pill iv-pill--mute">Not counted</span>
                : s.lastCount.stale
                  ? <span className="iv-pill iv-pill--warn">Old count</span>
                  : <span className="iv-pill iv-pill--good">Fresh</span>}
            </div>
            {s.lines.length > 0 ? <MiniMap shelf={s} areas={data.areas} /> : <p className="iv-quiet">No count list yet.</p>}
            <p className="iv-store__m">
              {s.skip ? "Skipping this week's count. " : ""}
              {freshSay(s)}{s.lastCount ? "." : ""}
            </p>
            <div className="iv-store__btns">
              <Link className="iv-btn iv-btn--sm" href={href(`/dashboard/count/shelf?store=${s.id}`)}>Open {s.name} shelf</Link>
            </div>
          </section>
        ))}
      </div>

      {lines.length > 0 && (
        <details className="iv-card iv-fold iv-wide-only">
          <summary>The {n} sheets side by side</summary>
          <div className="iv-sheetwrap">
            <table className="iv-sheet">
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  {data.shelves.map((s) => <th key={s.id} scope="col">{s.name}</th>)}
                </tr>
              </thead>
              {data.areas.map((a) => {
                const rows = linesIn(lines, a.id)
                if (rows.length === 0) return null
                return (
                  <tbody key={a.id}>
                    <tr className="iv-sheet__sec"><th scope="colgroup" colSpan={n + 1}>{a.label}</th></tr>
                    {rows.map((l) => (
                      <tr key={l.id}>
                        <th scope="row">{l.name}</th>
                        {data.shelves.map((s) => <SheetCell key={s.id} line={s.lines.find((x) => x.id === l.id) ?? null} />)}
                      </tr>
                    ))}
                  </tbody>
                )
              })}
            </table>
          </div>
          <p className="iv-note">
            &quot;Not counted&quot; is a blank on that store&apos;s last count, never a zero. Amounts use the sizes on file today.
          </p>
        </details>
      )}
    </div>
    </div>
    </>
  )
}

function SheetCell({ line: l }: { line: ShelfLine | null }) {
  if (!l || l.state === "not_counted") return <td className="dim">Not counted</td>
  const shown = l.typed ?? l.amount ?? "Counted"
  return (
    <td>
      <b>{shown}</b>{" "}
      {l.state === "out" ? <StatePill state="out">Out</StatePill> : l.notValuedWhy ? <NotYet>Not valued yet</NotYet> : null}
      {l.typed && l.amount && l.notValuedWhy !== "size" ? <small>{l.amount}</small> : null}
    </td>
  )
}
