"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Section, useCounterTransition, usePageChrome } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { ReportData, ReportSections } from "@/lib/counter/adapters/count"
import { fmtQty } from "@/lib/counter/count-layers"
import { CountHead, money, StoreChips } from "../count-ui"

/**
 * Count & waste — Report. For each item counted this time and last time:
 * last count + delivered − what sales used − logged waste = what should be on
 * the shelf. The gap to what was counted is food that went somewhere nobody
 * wrote down. Below it, how often each item is ordered, from invoices.
 */
export function ReportClient({ sections }: { sections: SectionSources<ReportSections> }) {
  usePageChrome({ leaf: "Report" })
  const { pending } = useCounterTransition()
  return (
    <>
      <CountHead sub="Where the food went, and how often you order it" />
      <Section title="Should have vs counted" meta={(d) => (d?.current ? `${d.store.name} · ${d.current.label}` : d?.store.name ?? "")} data={sections.report} pending={pending} pad={false}>
        {(d) => (d ? <Gap data={d} /> : null)}
      </Section>
      <Section title="How often you order" meta={() => "Last 8 weeks, from invoices"} data={sections.report} pending={pending} pad={false}>
        {(d) => (d ? <Orders data={d} /> : null)}
      </Section>
    </>
  )
}

function q(n: number): string {
  return fmtQty(Math.round(n * 10) / 10)
}

function Gap({ data }: { data: ReportData }) {
  const router = useRouter()
  return (
    <div style={{ display: "grid" }}>
      <div className="cw-pad" style={{ borderBottom: "1px solid var(--line)" }}>
        <StoreChips stores={data.stores} current={data.store.id} path="/dashboard/count/report" />
        {data.counts.length > 1 && (
          <div className="cw__chips" role="group" aria-label="Count">
            {data.counts.slice(0, 8).map((c) => (
              <button
                key={c.id}
                type="button"
                className="cw__chip"
                aria-pressed={data.current?.id === c.id}
                onClick={() => router.push(`/dashboard/count/report?store=${data.store.id}&count=${c.id}`)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {!data.current ? (
        <div className="cw-pad">
          <p className="cw__sub">No finished count for {data.store.name} yet. Finish one and it becomes the starting point; the second count makes the first report.</p>
          <div className="cw__foot" style={{ maxWidth: 360 }}>
            <Link className="cw__btn cw__btn--primary" href={`/dashboard/count?store=${data.store.id}`}>Start the count</Link>
          </div>
        </div>
      ) : !data.previous ? (
        <div className="cw-pad">
          <p className="cw__sub">
            The {data.current.label} count is the starting point for {data.store.name}. The next finished count is compared against it, and this page fills in.
          </p>
        </div>
      ) : (
        <>
          <div className="cw-figs">
            <div className="cw-fig">
              <span className="cw__mono">Missing, nobody logged it</span>
              <b className={data.missingDollars > 0 ? "miss" : ""}>{money(data.missingDollars)}</b>
              <span>Should have been there, wasn&apos;t, and no waste entry</span>
            </div>
            <div className="cw-fig">
              <span className="cw__mono">Waste you logged</span>
              <b>{money(data.wasteDollars)}</b>
              <span>{data.wasteEntries} {data.wasteEntries === 1 ? "entry" : "entries"} since {data.previous.label}</span>
            </div>
            <div className="cw-fig">
              <span className="cw__mono">Compared</span>
              <b>{data.rows.length} items</b>
              <span>Counted on {data.previous.label} and {data.current.label}</span>
            </div>
          </div>
          {data.rows.length === 0 ? (
            <p className="cw__sub" style={{ padding: 14 }}>No item was counted both times, so there is nothing to compare yet.</p>
          ) : (
            <div className="cw-wrap">
              <table className="cw-tbl">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Last count</th>
                    <th>+ Delivered</th>
                    <th>− Sales used</th>
                    <th>− Logged waste</th>
                    <th>= Should have</th>
                    <th>You counted</th>
                    <th>Missing</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const off = Math.abs(r.missing) < Math.max(0.05 * Math.max(r.should, r.counted), 0.01)
                    return (
                      <tr key={r.name}>
                        <td>
                          <b>{r.name}</b>
                          {r.partial ? <><br /><small style={{ color: "var(--ink-2)" }}>Some deliveries need a case size</small></> : null}
                        </td>
                        <td>{q(r.last)} {r.unit}</td>
                        <td>{q(r.delivered)}</td>
                        <td>{q(r.used)}</td>
                        <td>{q(r.waste)}</td>
                        <td>{q(r.should)}</td>
                        <td>{q(r.counted)}</td>
                        <td className={off ? "ok" : r.missing > 0 ? "miss" : ""}>
                          {off
                            ? "✓ matches"
                            : r.missing > 0
                              ? `${q(r.missing)} ${r.unit}${r.missingDollars != null ? ` · ${money(r.missingDollars)}` : ""}`
                              : `${q(-r.missing)} ${r.unit} extra`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="cw__sub" style={{ padding: 14, borderTop: "1px solid var(--line)" }}>
            &quot;Sales used&quot; is every item sold times its recipe. Extras and &quot;no cheese&quot; changes aren&apos;t in it yet, so a small gap on cheese or sauce is expected. &quot;Extra&quot; means more on the shelf than the numbers say, usually a delivery whose invoice hasn&apos;t come in.
          </p>
        </>
      )}
    </div>
  )
}

function Orders({ data }: { data: ReportData }) {
  if (data.orders.length === 0) {
    return <p className="cw__sub" style={{ padding: 14 }}>No invoices for {data.store.name} in the last 8 weeks.</p>
  }
  return (
    <div className="cw-wrap">
      <table className="cw-tbl">
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
            <tr key={o.name}>
              <td><b>{o.name}</b></td>
              <td>{o.vendor}</td>
              <td>{o.orders}</td>
              <td>{o.usually}</td>
              <td>{o.amount}</td>
              <td>{o.every}</td>
              <td>{o.last}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
