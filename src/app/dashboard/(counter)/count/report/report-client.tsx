"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Section, useCounterTransition, usePageChrome, useSurfaceHref } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { GapRow, ReportData } from "@/lib/counter/adapters/count"
import type { ReportPictureSections, ReportView } from "@/lib/counter/adapters/inventory-report"
import type { SwitcherSections } from "@/lib/counter/adapters/inventory-shelf"
import { gapVerdict, type GapCoverage, type GapHeadline } from "@/lib/counter/gap-picture"
import { barShares, moneyChange } from "@/lib/counter/waste-picture"
import { CountHead, money } from "../count-ui"
import { Bars, Hero, ItemLink, TwoBars, VerdictPill, changeSay, q, type BarRow } from "../picture-ui"

/**
 * Inventory — Report. The picture first: what went missing between two
 * counts, how much of the list that covers, and each item that is off as two
 * bars (should have, counted), biggest gap first. The working — last count +
 * delivered − what sales used − what was logged = should have — is folded
 * under it, with how often each item is ordered. With every store picked it
 * is the same figure per store. One client for the desk and the phone.
 */
export function ReportClient({ sections }: { sections: SectionSources<ReportPictureSections & SwitcherSections> }) {
  usePageChrome({ leaf: "Report" })
  const { pending } = useCounterTransition()
  return (
    <>
      <CountHead sub="What should be on the shelf, what was, and where the difference went" switcher={sections.switcher} allView />
      <Section bare title="Report" data={sections.report} pending={pending}>
        {(d) => (d ? <div className="iv-c">{d.one ? <OneStore data={d.one} /> : <AllStores data={d} />}</div> : null)}
      </Section>
    </>
  )
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** A "went missing" figure, or the words for why there is none. Never $0 for an unknown. */
function missingFigure(h: GapHeadline | null): { figure: string; words: boolean } {
  if (!h || h.items === 0) return { figure: "Nothing to compare", words: true }
  if (h.missingDollars === null) return { figure: "Not valued yet", words: true }
  return { figure: money(h.missingDollars), words: false }
}

// ---------------------------------------------------------------------------
// One store
// ---------------------------------------------------------------------------

function OneStore({ data }: { data: ReportData }) {
  const pathname = usePathname() ?? ""
  const href = useSurfaceHref()
  const walk = href(`/dashboard/count/walk?store=${data.store.id}`)
  return (
    <div className="iv-stack">
      {data.counts.length > 1 && (
        <nav className="iv-chips" aria-label="Count">
          {data.counts.slice(0, 8).map((c) => (
            <Link
              key={c.id}
              className="iv-chip"
              aria-current={data.current?.id === c.id ? "true" : undefined}
              href={`${pathname}?${new URLSearchParams({ store: data.store.id, count: c.id })}`}
            >
              {c.label}
            </Link>
          ))}
        </nav>
      )}

      {!data.current || !data.previous ? (
        <section className="iv-card iv-lead" aria-label="Went missing">
          <div className="iv-lead__n iv-lead__n--text"><strong>Needs two counts</strong></div>
          <p className="iv-say">
            {!data.current
              ? `${data.store.name} has no finished count yet.`
              : data.counts.length > 1
                ? `The ${data.current.label} count is the first one at ${data.store.name}, so it has nothing before it to compare with.`
                : `${data.store.name} has one finished count, from ${data.current.label}.`}
            <small>
              {!data.current
                ? "The first count is the starting point. The second one shows what should have been there and what went missing."
                : "It is the starting point. The next finished count is compared against it, and this page fills in. Until then there is no dollar figure here."}
            </small>
          </p>
          <Link className="iv-btn iv-btn--ink" href={walk}>Count {data.store.name}</Link>
        </section>
      ) : (
        <Compared data={data} from={data.previous.label} to={data.current.label} />
      )}

      <details className="iv-card iv-fold">
        <summary>How often you order <span>8 weeks of invoices at {data.store.name}</span></summary>
        <Orders data={data} />
      </details>
    </div>
  )
}

function coverageSay(c: GapCoverage): string {
  const parts: string[] = []
  if (c.noSize > 0) parts.push(`${c.noSize} ${c.noSize === 1 ? "has" : "have"} a box with no size yet.`)
  if (c.notOnThis > 0) parts.push(`${c.notOnThis} ${c.notOnThis === 1 ? "was" : "were"} not on this count.`)
  if (c.notOnLast > 0) parts.push(`${c.notOnLast} had no whole count before this one to start from.`)
  return parts.join(" ")
}

/**
 * The rows that are off. What is short leads, because the headline is what
 * went missing: biggest shortage in dollars first, a shortage with no price
 * after the priced ones, then what is extra, biggest first.
 */
function offRows(rows: GapRow[]): GapRow[] {
  const rank = (r: GapRow) => (gapVerdict(r) === "short" ? (r.missingDollars === null ? 1 : 0) : 2)
  return rows
    .filter((r) => gapVerdict(r) !== "match")
    .sort((a, b) => rank(a) - rank(b) || Math.abs(b.missingDollars ?? 0) - Math.abs(a.missingDollars ?? 0))
}

function Compared({ data, from, to }: { data: ReportData; from: string; to: string }) {
  const h = data.headline
  const { figure, words } = missingFigure(h)
  const top = data.rows.filter((r) => (r.missingDollars ?? 0) > 0).slice(0, 3).map((r) => r.name)
  const change = h && data.before ? moneyChange({ entries: h.items, dollars: h.missingDollars }, { entries: data.before.headline.items, dollars: data.before.headline.missingDollars }) : null
  const off = offRows(data.rows)
  const matching = data.rows.length - off.length
  const c = data.coverage
  const apart = data.theftDollars + data.returnDollars + data.otherDollars
  return (
    <>
      <div className="iv-rep">
        <div className="iv-rep__hero">
        <Hero
          label={`Went missing · ${from} → ${to}`}
          figure={figure}
          words={words}
          aside={data.before ? changeSay(change, `the counts before (${data.before.from} → ${data.before.to})`) : undefined}
        >
          <p className="iv-cover-t">
            {!h || h.items === 0
              ? `No item was counted on both ${from} and ${to}, so there is nothing to compare yet.`
              : h.missingDollars === null
                ? `${plural(h.items, "item")} compared, and none has a price on file yet, so the gap has no dollar figure.`
                : h.missingDollars > 0
                  ? `Food that should have been on the shelf and was not, and that nobody logged.${top.length ? ` Most of it is ${top.join(", ")}.` : ""}`
                  : "Nothing went missing that wasn't logged."}
            {h && h.missingDollars !== null && h.unpriced > 0 ? ` ${plural(h.unpriced, "compared item")} with no price ${h.unpriced === 1 ? "is" : "are"} not in the figure.` : ""}
          </p>
          {c && c.lines > 0 && (
            <>
              <span className="iv-cover" aria-hidden="true">
                {c.compared > 0 ? <i style={{ flexGrow: c.compared }} /> : null}
                {c.noSize > 0 ? <i className="ny" style={{ flexGrow: c.noSize }} /> : null}
                {c.notOnThis + c.notOnLast > 0 ? <i className="nc" style={{ flexGrow: c.notOnThis + c.notOnLast }} /> : null}
              </span>
              <p className="iv-cover-t">
                <b>{c.compared} of {plural(c.lines, "line")} compared.</b> {coverageSay(c)}
              </p>
            </>
          )}
        </Hero>
        </div>

        <section className="iv-card iv-rep__items" aria-label="Item by item">
          <div className="iv-card__h">
            <b>Should have, and counted</b>
            <span className="iv-mono">what is short first</span>
          </div>
          {data.rows.length === 0 ? (
            <p className="iv-quiet iv-pad">No item was counted both times, so there is nothing to compare yet.</p>
          ) : (
            <ul className="iv-list iv-list--two">
              {off.map((r) => (
                <li key={r.ingredientId} className="iv-it">
                  <div className="iv-it__h">
                    <b><ItemLink id={r.ingredientId} store={data.store.id} className="iv-open">{r.name}</ItemLink></b>
                    <VerdictPill verdict={gapVerdict(r)} missing={r.missing} unit={r.unit} />
                  </div>
                  <TwoBars should={r.should} counted={r.counted} unit={r.unit} />
                  <p className="iv-it__x">
                    {r.missingDollars === null
                      ? "No price on file, so no dollars."
                      : r.missing > 0 ? `${money(r.missingDollars)} that nobody logged.` : `${money(-r.missingDollars)} more than the numbers say.`}
                    {r.partial ? " Some deliveries need a case size, so “should have” may read low." : ""}
                  </p>
                </li>
              ))}
              {matching > 0 && (
                <li className="iv-it">
                  <div className="iv-it__h">
                    <b>{off.length > 0 ? `${plural(matching, "more item")}` : plural(matching, "item")}</b>
                    <span className="iv-pill iv-pill--good">{matching === 1 ? "Matches" : "Match"}</span>
                  </div>
                  <p className="iv-it__x">Counted within 5% of what the numbers say. They are in the working below.</p>
                </li>
              )}
            </ul>
          )}
        </section>

      <div className="iv-tri iv-rep__tiles">
        <div className="iv-card iv-tile">
          <span className="iv-mono">Extra on the shelf</span>
          {!h || h.items === 0
            ? <strong className="txt">Nothing to compare</strong>
            : h.missingDollars === null
              ? <strong className="txt">Not valued yet</strong>
              : <strong>{money(data.extraDollars)}</strong>}
          <span>More counted than the numbers say, often a delivery whose invoice hasn&apos;t come in. Never netted against what went missing.</span>
        </div>
        <div className="iv-card iv-tile">
          <span className="iv-mono">Waste you logged</span>
          {data.wasteEntries === 0
            ? <strong className="txt">Nothing logged</strong>
            : data.wasteUnpriced === data.wasteEntries
              ? <strong className="txt">Not valued yet</strong>
              : <strong>{money(data.wasteDollars)}</strong>}
          <span>
            {plural(data.wasteEntries, "entry", "entries")} between the counts, on the items compared.
            {data.wasteUnpriced > 0 && data.wasteUnpriced < data.wasteEntries ? ` ${data.wasteUnpriced} without a price not added in.` : ""}
          </span>
        </div>
        <div className="iv-card iv-tile">
          <span className="iv-mono">Theft · sent back · other</span>
          {data.apartEntries === 0
            ? <strong className="txt">Nothing logged</strong>
            : data.apartUnpriced === data.apartEntries
              ? <strong className="txt">Not valued yet</strong>
              : <strong>{money(apart)}</strong>}
          <span>
            {data.apartEntries === 0
              ? "Kept apart from waste."
              : `Theft ${money(data.theftDollars)} · sent back ${money(data.returnDollars)} · other ${money(data.otherDollars)}.${data.apartUnpriced > 0 && data.apartUnpriced < data.apartEntries ? ` ${data.apartUnpriced} without a price not added in.` : ""}`}
          </span>
        </div>
      </div>
      </div>

      {data.rows.length > 0 && (
        <details className="iv-card iv-fold">
          <summary>Show the working <span>One row per item: last count, delivered, sold, logged</span></summary>
          <Working data={data} />
          <p>
            Every row adds across: last count + delivered − sales used − waste − theft, sent back and other = should have. The figures above are those rows summed{data.offReportEntries > 0 ? `; ${plural(data.offReportEntries, "more entry", "more entries")} (${money(data.offReportDollars)}) ${data.offReportEntries === 1 ? "was" : "were"} logged against items not compared, so ${data.offReportEntries === 1 ? "it is" : "they are"} on no row` : ""}. &quot;Sales used&quot; is every item sold times its recipe. Extras and &quot;no cheese&quot; changes aren&apos;t in it yet, so a small gap on cheese or sauce is expected. Shortages and extras are never netted against each other.
          </p>
        </details>
      )}
    </>
  )
}

function Working({ data }: { data: ReportData }) {
  return (
    <div className="cw-wrap">
      <table className="cw-tbl cw-tbl--cards cw-tbl--wide">
        <thead>
          <tr>
            <th>Item</th>
            <th>Last count</th>
            <th>+ Delivered</th>
            <th>− Sales used</th>
            <th>− Waste</th>
            <th>− Theft, sent back, other</th>
            <th>= Should have</th>
            <th>You counted</th>
            <th>Missing</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => {
            const v = gapVerdict(r)
            return (
              <tr key={r.ingredientId}>
                <td>
                  <b>{r.name}</b>
                  {r.partial ? <><br /><small style={{ color: "var(--ink-2)" }}>Some deliveries need a case size</small></> : null}
                </td>
                <td data-label="Last count">{q(r.last)} {r.unit}</td>
                <td data-label="+ Delivered">{q(r.delivered)}</td>
                <td data-label="− Sales used">{q(r.used)}</td>
                <td data-label="− Waste">{q(r.waste)}</td>
                <td data-label="− Theft, sent back, other">{q(r.theft + r.returned + r.other)}</td>
                <td data-label="= Should have">{q(r.should)}</td>
                <td data-label="You counted">{q(r.counted)}</td>
                <td data-label="Missing" className={v === "match" ? "ok" : v === "short" ? "miss" : ""}>
                  {v === "match"
                    ? "✓ matches"
                    : v === "short"
                      ? `${q(r.missing)} ${r.unit}${r.missingDollars != null ? ` · ${money(r.missingDollars)}` : ""}`
                      : `${q(-r.missing)} ${r.unit} extra`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Orders({ data }: { data: ReportData }) {
  if (data.orders.length === 0) {
    return <p>No invoices for {data.store.name} in the last 8 weeks.</p>
  }
  return (
    <div className="cw-wrap">
      <table className="cw-tbl cw-tbl--cards">
        <thead>
          <tr>
            <th>Item</th>
            <th>Vendor</th>
            <th>Orders</th>
            <th>Usually</th>
            <th>Usual amount</th>
            <th>Every</th>
            <th>Last delivery</th>
          </tr>
        </thead>
        <tbody>
          {data.orders.map((o) => (
            <tr key={o.ingredientId}>
              <td><b>{o.name}</b></td>
              <td data-label="Vendor">{o.vendor}</td>
              <td data-label="Orders">{o.orders}</td>
              <td data-label="Usually">{o.usually}</td>
              <td data-label="Usual amount">{o.amount}</td>
              <td data-label="Every">{o.every}</td>
              <td data-label="Last delivery">{o.last}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Every store
// ---------------------------------------------------------------------------

function AllStores({ data }: { data: ReportView }) {
  const n = data.byStore.length
  const waiting = data.byStore.filter((s) => s.gap === null).map((s) => s.name)
  const shares = barShares(data.byStore.map((s) => s.gap?.missingDollars ?? null))
  const rows: BarRow[] = data.byStore.map((s, i) => {
    const g = s.gap
    const { figure } = missingFigure(g)
    return {
      key: s.id,
      label: s.name,
      share: shares[i],
      none: !g || g.missingDollars === null,
      value: !g ? "Needs two counts" : figure,
      sub: !g
        ? "One finished count or none, so there is nothing to compare yet."
        : `${g.from} → ${g.to}, ${plural(g.items, "item")} compared${g.unpriced > 0 && g.missingDollars !== null ? `, ${g.unpriced} without a price not included` : ""}.`,
    }
  })
  return (
    <div className="iv-stack">
      <div className="iv-cols">
        <Hero
          label={`Went missing · latest two counts · ${data.total.stores} of ${n} stores`}
          figure={data.total.dollars !== null ? money(data.total.dollars) : waiting.length === n ? "Needs two counts" : "Not valued yet"}
          words={data.total.dollars === null}
          aside={data.total.dollars !== null ? "nobody logged where it went" : undefined}
        >
          <p className="iv-cover-t">
            Each store is compared between its own two most recent finished counts, so the dates differ.
            {waiting.length > 0 ? ` ${waiting.join(" and ")} ${waiting.length === 1 ? "needs" : "need"} two counts and ${waiting.length === 1 ? "is" : "are"} not in the figure.` : ""}
          </p>
        </Hero>
        <section className="iv-card" aria-label="Went missing, by store">
          <div className="iv-card__h">
            <b>Went missing, by store</b>
            <span className="iv-mono">latest two counts</span>
          </div>
          <Bars rows={rows} label="Went missing, by store" />
          <p className="iv-note">Pick a store above for the item-by-item picture and the working.</p>
        </section>
      </div>
    </div>
  )
}
