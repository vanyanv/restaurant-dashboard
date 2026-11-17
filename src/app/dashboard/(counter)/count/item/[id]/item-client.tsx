"use client"

import Link from "next/link"
import { Section, useCounterTransition, usePageChrome, useSurfaceHref } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { ItemOne, ItemSections, ItemStoreBar, ItemView } from "@/lib/counter/adapters/inventory-item"
import { areaLabel } from "@/lib/counter/count-layers"
import { barShares } from "@/lib/counter/waste-picture"
import { CountHead, StoreSwitch, money } from "../../count-ui"
import { Bars, Hero, Ledger, NotYetBox, TwoBars, VerdictPill, q, type BarRow } from "../../picture-ui"
import { DaysBar, StatePill } from "../../shelf-ui"

/**
 * Inventory — one item. Everything the other tabs say about one line of the
 * count list, on one page: its state and what was typed, how long it lasts,
 * what went missing since the last count, the same item at every store, and
 * how it is ordered. A line with a box that has no size gets the calm version:
 * what was typed, why there is no amount yet, and the one button that fixes
 * it. One client for the desk and the phone.
 */
export function ItemClient({ sections }: { sections: SectionSources<ItemSections> }) {
  usePageChrome({ leaf: "Item" })
  const { pending } = useCounterTransition()
  return (
    <>
      <CountHead sub="One line of the count list" />
      <Section bare title="Item" data={sections.item} pending={pending}>
        {(d) =>
          d ? (
            <>
              <StoreSwitch data={d} allView />
              <div className="iv-c">
                {!d.item ? <NotOnList /> : d.one ? <OneStore data={d} item={d.item} one={d.one} /> : <AllStores data={d} item={d.item} />}
              </div>
            </>
          ) : null
        }
      </Section>
    </>
  )
}

type Item = NonNullable<ItemView["item"]>

function NotOnList() {
  const href = useSurfaceHref()
  return (
    <NotYetBox title="Not on the count list">
      <p>This item is not on your count list, or it was taken off it.</p>
      <Link className="iv-btn iv-btn--sm" href={href("/dashboard/count/shelf")}>Open Shelf</Link>
    </NotYetBox>
  )
}

function storeRows(stores: ItemStoreBar[]): BarRow[] {
  const shares = barShares(stores.map((s) => s.qty))
  return stores.map((s, i) => {
    const value = s.amount ?? (s.why === "not_counted" ? "Not counted" : "Not valued yet")
    return {
      key: s.id,
      label: s.name,
      share: shares[i],
      none: s.qty === null,
      value,
      sub: s.why === "not_counted"
        // The shelf's own words: with the skip on, this week's count is left out, not missing.
        ? s.skip
          ? "Skipping this week's count: not on a count from before the last 7 days. A blank, not a zero."
          : "Never on a finished count here. A blank, not a zero."
        // The state, unless the figure beside the bar already says it.
        : [s.stateText === value ? null : s.stateText, s.typed, s.day ? `counted ${s.day}` : null, s.skip ? "skipping this week's count" : null].filter(Boolean).join(" · "),
    }
  })
}

function Stores({ data, item }: { data: ItemView; item: Item }) {
  // No unit in the heading: each bar prints its own amount in the unit it is shown in
  // (oz reads as lb), and the bar lengths are all from the item's one recipe unit.
  const n = data.byStore.length
  if (n < 2) return null
  return (
    <section className="iv-card" aria-label={`Same item, ${n} stores`}>
      <div className="iv-card__h">
        <b>Same item, {n} stores</b>
        <span className="iv-mono">latest count</span>
      </div>
      <Bars rows={storeRows(data.byStore)} label={`${item.name} at each store`} />
      <p className="iv-note">Each store&apos;s own latest count. The bars share one scale; a store with a box that has no size has no bar.</p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// One store
// ---------------------------------------------------------------------------

function OneStore({ data, item, one }: { data: ItemView; item: Item; one: ItemOne }) {
  const href = useSurfaceHref()
  const first = one.lines[0]
  const state = first?.state ?? "not_counted"
  return (
    <div className="inv-stack">
      <Link className="iv-back" href={href(`/dashboard/count/shelf?store=${one.store.id}`)}>‹ Shelf · {one.store.name}</Link>
      <div className="iv-title">
        <div className="iv-title__h">
          <h2>{item.name}</h2>
          <StatePill state={state}>{first?.stateText ?? "Not counted"}</StatePill>
        </div>
        <span className="iv-mono">{item.areas} · {one.store.name}</span>
        {item.fullName !== item.name ? <span className="iv-quiet">{item.fullName}</span> : null}
      </div>
      <div className="iv-cols iv-cols--even">
        <div className="inv-stack">
          <Counted data={data} one={one} />
          <Since one={one} />
        </div>
        <div className="inv-stack">
          <Stores data={data} item={item} />
          <Ordering one={one} />
        </div>
      </div>
    </div>
  )
}

/** The count itself: the amount and what it is worth, or the calm "not yet". */
function Counted({ data, one }: { data: ItemView; one: ItemOne }) {
  const href = useSurfaceHref()
  const lines = one.lines
  const first = lines[0]
  const many = lines.length > 1
  const areaOf = (id: string) => (many ? ` (${areaLabel(id)})` : "")

  if (!first || first.state === "not_counted") {
    return (
      <NotYetBox title={one.skip ? `Not on a count ${one.store.name} is reading` : `Not counted at ${one.store.name} yet`}>
        <p>
          {one.skip ? "Skip this week's count is on, so counts from the last 7 days are left out, here and on the draft order. " : ""}
          {first?.note ? `${first.note}. ` : ""}A blank is not a zero, so there is no amount, no dollars and nothing to order from yet.
        </p>
        <Link className="iv-btn iv-btn--sm iv-btn--ink" href={href(`/dashboard/count/walk?store=${one.store.id}`)}>Count {one.store.name}</Link>
      </NotYetBox>
    )
  }

  const unsized = lines.filter((l) => l.notValuedWhy === "size")
  const recount = lines.some((l) => l.notValuedWhy === "boxes")
  const days = lines.find((l) => l.daysLeft !== null) ?? null
  const notes = [...new Set(lines.map((l) => l.note).filter(Boolean))]
  const typedLines = lines.filter((l) => l.typed)
  const lastLines = lines.filter((l) => l.last)

  const typed = (
    <>
      {typedLines.map((l) => (
        <p key={l.id} className="iv-cover-t"><b>{l.typed}</b>{areaOf(l.area)}{l.from ? `, from the ${l.from} count` : ""}</p>
      ))}
      {lastLines.map((l) => (
        <p key={l.id} className="iv-cover-t">Last count, {l.last!.day}: {l.last!.typed}{areaOf(l.area)}</p>
      ))}
    </>
  )
  const lasting = days ? (
    <>
      <DaysBar line={days} barDays={data.barDays} />
      {one.perDay ? <p className="iv-cover-t">At about {one.perDay} a day, from what sold.</p> : null}
    </>
  ) : null
  const said = [
    ...(one.skip ? [`Skip this week's count is on, so this is read from the ${one.counted} count`] : []),
    ...notes,
  ].map((n) => <p key={n} className="iv-cover-t">{n}.</p>)

  // A box with no size: no amount, no dollars. Say what was typed and what fixes it.
  if (unsized.length > 0 || recount) {
    return (
      <NotYetBox title="Not valued yet">
        <span className="iv-mono">Counted {one.counted}</span>
        {typed}
        <p>
          {unsized.length > 0
            ? `No amount, dollars or days left from this count until every box has a size. ${[...new Set(unsized.map((l) => l.notValued))].join(". ")}.`
            : "A size or a box was changed after this count, so what was typed can't be turned into an amount. Count it again and it is valued."}
        </p>
        {lasting}
        {said}
        {unsized.length > 0
          ? <Link className="iv-btn iv-btn--sm" href={href("/dashboard/count/setup")}>Set sizes</Link>
          : <Link className="iv-btn iv-btn--sm" href={href(`/dashboard/count/walk?store=${one.store.id}`)}>Count {one.store.name}</Link>}
      </NotYetBox>
    )
  }

  return (
    <Hero
      label={`Counted ${one.counted}`}
      figure={one.amount ?? first.typed ?? "Counted"}
      words={one.amount === null}
      aside={one.worth !== null ? <>worth about <b>{money(one.worth)}</b></> : first.notValued ? `${first.notValued}, so no dollars` : undefined}
    >
      {typed}
      {one.sizes.length > 0 ? <p className="iv-cover-t">{one.sizes.join(" · ")}</p> : null}
      {lasting}
      {said}
    </Hero>
  )
}

/** "Since the last count": the Report's own row for this item, as two bars. */
function Since({ one }: { one: ItemOne }) {
  const g = one.gap
  if (!g) {
    return one.gapWhy === "one_count" ? (
      <NotYetBox title="Needs two counts">
        <p>{one.store.name} needs two finished counts before anything can be compared. The next count shows what should have been there and what went missing.</p>
      </NotYetBox>
    ) : (
      <NotYetBox title="Not compared on the last two counts">
        <p>This item was not on both of the two most recent counts at {one.store.name} with every box sized, so there is no &ldquo;should have&rdquo; for it yet.</p>
      </NotYetBox>
    )
  }
  const r = g.row
  const apart = r.theft + r.returned
  return (
    <section className="iv-card" aria-label="Since the last count">
      <div className="iv-card__h">
        <b>Since the last count</b>
        <VerdictPill verdict={g.verdict} missing={r.missing} unit={r.unit} />
      </div>
      <div className="iv-pad inv-stack">
        <TwoBars should={r.should} counted={r.counted} unit={r.unit} />
        <p className="iv-cover-t">
          {g.from} → {g.to}.{" "}
          {g.verdict === "match"
            ? "The count agrees with the numbers, within 5%."
            : g.verdict === "short"
              ? r.missingDollars !== null ? <><b>{money(r.missingDollars)}</b> that nobody logged.</> : "No price on file, so no dollars."
              : r.missingDollars !== null ? <><b>{money(-r.missingDollars)}</b> more than the numbers say, often a delivery not invoiced yet.</> : "More than the numbers say. No price on file, so no dollars."}
          {r.partial ? " Some deliveries need a case size, so “should have” may read low." : ""}
        </p>
      </div>
      <details className="iv-working">
        <summary>How &ldquo;should have&rdquo; is worked out</summary>
        <Ledger
          rows={[
            { label: `Counted ${g.from}`, value: `${q(r.last)} ${r.unit}` },
            { label: "+ Delivered", value: `${q(r.delivered)} ${r.unit}` },
            { label: "− Sold, by the recipes", value: `${q(r.used)} ${r.unit}` },
            { label: "− Thrown out, logged", value: `${q(r.thrown)} ${r.unit}` },
            ...(apart !== 0 ? [{ label: "− Theft, sent back", value: `${q(apart)} ${r.unit}` }] : []),
            { label: "Should be there", value: `${q(r.should)} ${r.unit}`, sum: true },
            { label: `Counted ${g.to}`, value: `${q(r.counted)} ${r.unit}` },
          ]}
        />
      </details>
    </section>
  )
}

function Ordering({ one }: { one: ItemOne }) {
  const href = useSurfaceHref()
  const o = one.ordering
  const line = one.lines.find((l) => l.order) ?? one.lines[0] ?? null
  const vendor = o?.vendor || line?.vendor || null
  return (
    <section className="iv-card" aria-label="Ordering">
      <div className="iv-card__h">
        <b>Ordering</b>
        <Link className="iv-link" href={href(`/dashboard/count/orders?store=${one.store.id}`)}>Open in Order ›</Link>
      </div>
      <dl className="iv-kv">
        <dt>Vendor</dt>
        <dd>{vendor ?? "No invoice yet"}</dd>
        {o ? (
          <>
            <dt>Usually arrives</dt>
            <dd>{o.usually}</dd>
            <dt>Usual amount</dt>
            <dd>{o.amount}</dd>
            <dt>How often</dt>
            <dd>{o.every === "Once" ? "Once in 8 weeks" : o.every === "Daily" ? "Daily" : `Every ${o.every}`}</dd>
            <dt>Last delivery</dt>
            <dd>{o.last}</dd>
          </>
        ) : null}
        <dt>Draft for next order</dt>
        <dd>{line?.order ? `${line.order}${line.when ? ` · ${line.when}` : ""}` : "Nothing on the draft"}</dd>
      </dl>
      {!o ? <p className="iv-note">No invoice for this item at {one.store.name} in the last 8 weeks, so there is no usual day or amount yet.</p> : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Every store
// ---------------------------------------------------------------------------

function AllStores({ data, item }: { data: ItemView; item: Item }) {
  const href = useSurfaceHref()
  const n = data.byStore.length
  const counted = data.byStore.filter((s) => s.why !== "not_counted").length
  return (
    <div className="inv-stack">
      <Link className="iv-back" href={href("/dashboard/count/shelf")}>‹ Shelf</Link>
      <div className="iv-title">
        <div className="iv-title__h"><h2>{item.name}</h2></div>
        <span className="iv-mono">{item.areas} · all {n} stores</span>
        {item.fullName !== item.name ? <span className="iv-quiet">{item.fullName}</span> : null}
      </div>
      <div className="iv-cols">
        <Hero
          label={data.across ? `On the shelf · ${data.across.stores} of ${n} stores` : `On the shelf · ${n} stores`}
          figure={data.across ? data.across.amount : counted === 0 ? "Not counted yet" : "Not valued yet"}
          words={!data.across}
          aside={data.across ? "each store's own latest count, added up" : undefined}
        >
          <p className="iv-cover-t">
            {data.across
              ? data.across.stores < n ? "Stores that have not counted it, or have a box with no size, are not added in." : "Every store has a whole count of it."
              : counted === 0
                ? data.byStore.some((s) => s.skip) ? "No store has this item on a count the page is reading: Skip this week's count is on." : "No store has this item on a finished count yet."
                : "Counted, but a box has no size yet, so there is no amount to add up."}
            {" "}Pick a store above for days left, what went missing and how it is ordered.
          </p>
        </Hero>
        <Stores data={data} item={item} />
      </div>
    </div>
  )
}
