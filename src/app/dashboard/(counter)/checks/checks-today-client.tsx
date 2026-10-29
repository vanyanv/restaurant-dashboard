"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Section, useCounterTransition, usePageChrome, useSurfaceHref } from "@/components/counter"
import { setStoreClosed } from "@/lib/counter/actions/checks"
import { shortStoreName } from "@/lib/checks/names"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { TodayData, TodaySections, CellView } from "@/lib/counter/adapters/checks"
import { CheckDetail, ChecksHead, Glyph, Legend, OutcomeLine, type Outcome } from "./checks-ui"

/**
 * Store checks — Today. One card per store with its Morning and Night check
 * live (tasks done, who is on it, when it closes), a week strip under each,
 * and the full timestamped log of whichever check is picked. Missed checks
 * from yesterday and today fold into one summary at the top instead of a
 * card each.
 */
export function ChecksTodayClient({ sections }: { sections: SectionSources<TodaySections> }) {
  usePageChrome({
    leaf: "Store checks",
    askSuggestions: ["Which store misses the most checks?", "Who did last night's check?"],
  })
  const { pending } = useCounterTransition()

  return (
    <>
      <ChecksHead sub="Morning and Night · LA time" />
      <Section bare title="Missed checks" data={sections.today} pending={pending}>
        {(d) => <Missed data={d} />}
      </Section>
      <Section title="Today" meta={(d) => d.dayLabel} data={sections.today} pending={pending} pad={false}>
        {(d) => <Stores data={d} />}
      </Section>
    </>
  )
}

function Missed({ data }: { data: TodayData }) {
  const href = useSurfaceHref()
  const m = data.missed
  if (!m) return null
  return (
    <div className="ck-sum" role="status">
      <div className="ck-spread">
        <h3>
          {m.count} check{m.count === 1 ? "" : "s"} missed since yesterday
        </h3>
        <Link className="btn" href={href("/dashboard/checks/history")}>
          Open History
        </Link>
      </div>
      <span className="ck-meta">{m.line}</span>
      <div className="ck-sumgrid" style={{ gridTemplateColumns: `minmax(90px,auto) repeat(${m.stores[0]?.cells.length ?? 0}, minmax(0,1fr))` }}>
        <span />
        {(m.stores[0]?.cells ?? []).map((c) => (
          <span key={`${c.day}-${c.kind}`} className="ck-mono" style={{ textAlign: "center" }}>
            {c.label}
          </span>
        ))}
        {m.stores.map((s) => (
          <SumRow key={s.id} name={shortStoreName(s.name)} cells={s.cells} />
        ))}
      </div>
    </div>
  )
}

function SumRow({ name, cells }: { name: string; cells: NonNullable<TodayData["missed"]>["stores"][number]["cells"] }) {
  return (
    <>
      <span>{name}</span>
      {cells.map((c) => (
        <span key={`${c.day}-${c.kind}`} style={{ display: "grid", justifyItems: "center" }}>
          <Glyph status={c.status} small title={`${name} · ${c.label}`} />
        </span>
      ))}
    </>
  )
}

type Pick = { storeId: string; day: string; kind: string }

function Stores({ data }: { data: TodayData }) {
  const [pick, setPick] = useState<Pick | null>(() => {
    const s = data.stores.find((x) => !x.preOpen)
    const c = s?.cells.find((x) => x?.live) ?? s?.cells.find(Boolean)
    return s && c ? { storeId: s.id, day: c.day, kind: c.kind } : null
  })
  const picked = (() => {
    if (!pick) return null
    const s = data.stores.find((x) => x.id === pick.storeId)
    const c = s?.week.find((w) => w.day === pick.day)?.cells.find((x) => x?.kind === pick.kind)
    const label = data.columns.find((x) => x.kind === pick.kind)?.label ?? ""
    return s && c ? { store: shortStoreName(s.name), label, cell: c } : null
  })()
  const isPicked = (storeId: string, c: CellView) =>
    pick?.storeId === storeId && pick.day === c.day && pick.kind === c.kind

  return (
    <>
      <div className="ck-split" style={{ padding: 0 }}>
        <div className="ck-stores">
          {data.stores.map((s) => (
            <div key={s.id} className={`ck-store${s.preOpen ? " ck-store--off" : ""}`}>
              <div className="ck-spread">
                <h3>{shortStoreName(s.name)}</h3>
                <span className="ck-meta">
                  {s.preOpen ? "Not open yet" : `7-day on time ${s.rate7 === null ? "—" : `${s.rate7}%`}`}
                </span>
              </div>
              {s.preOpen ? (
                <span className="ck-meta">
                  Checks are paused, so nothing counts as missed. They start on their own when the store is set to Open
                  in store settings.
                </span>
              ) : (
                <>
                  <div className="ck-pair">
                    {s.cells.map((c, i) =>
                      c ? (
                        <Tile
                          key={c.kind}
                          label={data.columns[i].label}
                          cell={c}
                          pressed={isPicked(s.id, c)}
                          onClick={() => setPick({ storeId: s.id, day: c.day, kind: c.kind })}
                        />
                      ) : (
                        <span key={data.columns[i].kind} className="ck-meta">
                          Not set up
                        </span>
                      ),
                    )}
                  </div>
                  <div className="ck-week" aria-label="This week, Morning then Night">
                    {s.week.map((w) => (
                      <div key={w.day}>
                        <span className="ck-mono">{w.top}</span>
                        <span className="pair">
                          {w.cells.map((c, i) =>
                            c ? (
                              <Glyph
                                key={c.kind}
                                status={c.status}
                                small
                                flagged={c.flags.length > 0}
                                pressed={isPicked(s.id, c)}
                                title={`${w.top} · ${data.columns[i].label} · ${c.label}`}
                                onClick={() => setPick({ storeId: s.id, day: c.day, kind: c.kind })}
                              />
                            ) : null,
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                  <ClosedToggle storeId={s.id} day={data.day} closed={s.closedToday} />
                </>
              )}
            </div>
          ))}
        </div>
        <div className="sec">
          {picked ? (
            <CheckDetail store={picked.store} label={picked.label} cell={picked.cell} />
          ) : (
            <div className="ck-drawer">
              <span className="ck-meta">Pick a check to see every task with its time and who did it.</span>
            </div>
          )}
        </div>
      </div>
      <div style={{ padding: "12px 14px", borderTop: "1px solid var(--line)" }}>
        <Legend />
      </div>
    </>
  )
}

function Tile({ label, cell, pressed, onClick }: { label: string; cell: CellView; pressed: boolean; onClick: () => void }) {
  const t = cell.tile
  return (
    <button type="button" className={`ck-tile${t.tone ? ` ck-tile--${t.tone}` : ""}`} aria-pressed={pressed} onClick={onClick}>
      <span className="ck-mono">{label}</span>
      <span className="ck-st" style={{ gap: 6 }}>
        <Glyph status={cell.status} small flagged={cell.flags.length > 0} />
        <b>{t.headline}</b>
      </span>
      {t.bar && (
        <span className="ck-bar" aria-hidden>
          <i style={{ width: `${Math.round((cell.progress ?? 0) * 100)}%` }} />
        </span>
      )}
      {t.meta && <span className="ck-meta">{t.meta}</span>}
      {t.sub && <span className="ck-meta">{t.sub}</span>}
    </button>
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
        {busy ? "Saving…" : closed ? "Closed today · reopen" : "Pause checks today (closed)"}
      </button>
      <OutcomeLine outcome={outcome} />
    </span>
  )
}
