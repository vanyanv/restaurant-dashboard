"use client"

import { Fragment, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Section, useCounterTransition, usePageChrome, useSurfaceHref } from "@/components/counter"
import { setStoreClosed } from "@/lib/counter/actions/checks"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { TodayData, TodaySections, CellView } from "@/lib/counter/adapters/checks"
import { ChecksHead, Glyph, Legend, OutcomeLine, Thumbs, type Outcome } from "./checks-ui"

/**
 * Store checks — Today. Three stores by three checks. Each cell answers, in
 * order: did it happen, when and by whom, what does it look like. Missed
 * checks from today and yesterday sit above the grid.
 */
export function ChecksTodayClient({ sections }: { sections: SectionSources<TodaySections> }) {
  usePageChrome({
    leaf: "Store checks",
    askSuggestions: ["Which store misses the most checks?", "Who did tonight's closing check?"],
  })
  const { pending } = useCounterTransition()

  return (
    <>
      <ChecksHead sub="Morning, transition and evening checks · LA time" />
      <Section bare title="Missed checks" data={sections.today} pending={pending}>
        {(d) => <Alerts data={d} />}
      </Section>
      <Section title="Today" meta={(d) => d.dayLabel} data={sections.today} pending={pending} pad={false}>
        {(d) => <Matrix data={d} />}
      </Section>
    </>
  )
}

function Alerts({ data }: { data: TodayData }) {
  const href = useSurfaceHref()
  if (data.alerts.length === 0) return null
  return (
    <div className="ck-alerts">
      {data.alerts.map((a) => (
        <div className="ck-alert" key={`${a.storeId}-${a.kind}-${a.day}`}>
          <Glyph status="missed" />
          <span>
            <b>{a.text}</b> <span className="ck-meta">{a.detail}</span>
          </span>
          <Link className="btn" href={href(`/dashboard/checks/history?store=${a.storeId}`)}>
            Open in History
          </Link>
        </div>
      ))}
    </div>
  )
}

function Matrix({ data }: { data: TodayData }) {
  return (
    <>
      <div className="ck-matrix">
        <div className="ck-h" />
        {data.columns.map((c) => (
          <div className="ck-h" key={c.kind}>
            <b>{c.label}</b>
            <span className="ck-mono">{c.window}</span>
          </div>
        ))}
        {data.stores.map((s) => (
          <Fragment key={s.id}>
            <div className="ck-s">
              <b>{s.name}</b>
              <span className="ck-mono">
                7-day on time {s.rate7 === null ? "—" : `${s.rate7}%`}
              </span>
              <ClosedToggle storeId={s.id} day={data.day} closed={s.closedToday} />
            </div>
            {s.cells.map((c, i) => (
              <div className="ck-c" key={data.columns[i].kind}>
                {c ? <Cell cell={c} store={s.name} /> : <span className="ck-meta">Not set up</span>}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
      <div style={{ padding: "12px 14px", borderTop: "1px solid var(--line)" }}>
        <Legend />
      </div>
    </>
  )
}

function Cell({ cell, store }: { cell: CellView; store: string }) {
  return (
    <>
      <div className="ck-st">
        <Glyph status={cell.status} flagged={cell.flags.length > 0} />
        {cell.label}
      </div>
      {cell.progress !== null && (
        <div className="ck-bar" aria-hidden>
          <i style={{ width: `${Math.round(cell.progress * 100)}%` }} />
        </div>
      )}
      {cell.meta && <div className="ck-meta">{cell.meta}</div>}
      {cell.started && <div className="ck-meta">{cell.started}</div>}
      {(cell.photos.length > 0 || cell.flags.length > 0) && (
        <div className="ck-thumbs">
          <Thumbs photos={cell.photos} caption={`${store} · ${cell.submittedAt ?? ""}`} />
          {cell.flags.length > 0 && (
            <span className="ck-flagtxt" title={cell.flags.map((f) => `${f.item}: ${f.note}`).join("\n")}>
              {cell.flags.length} flagged
            </span>
          )}
        </div>
      )}
      {cell.flags.map((f) => (
        <div className="ck-meta" key={f.item}>
          <b>{f.item}:</b> {f.note}
        </div>
      ))}
    </>
  )
}

function ClosedToggle({ storeId, day, closed }: { storeId: string; day: string; closed: boolean }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [outcome, setOutcome] = useState<Outcome>(null)
  return (
    <span className="ck-row">
      <button
        type="button"
        className="ck-link"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await setStoreClosed({ storeId, day, closed: !closed })
            if (!r.ok) setOutcome({ ok: false, text: r.error })
            else {
              setOutcome(null)
              router.refresh()
            }
          })
        }
      >
        {busy ? "Saving…" : closed ? "Closed today · reopen" : "Mark closed today"}
      </button>
      <OutcomeLine outcome={outcome} />
    </span>
  )
}
