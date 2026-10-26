"use client"

import { Fragment, useState } from "react"
import { useRouter } from "next/navigation"
import { Section, useCounterTransition, usePageChrome } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { CellView, HistoryData, HistorySections } from "@/lib/counter/adapters/checks"
import { ChecksHead, Glyph, Legend, Lightbox, photoSrc, StorePicker, type PhotoRef } from "../checks-ui"

/**
 * Store checks — History. Nine rows (store × check) by day. Clicking a square
 * opens who did it, when, the photos and what was flagged. The right edge is
 * the on-time rate for the range; below the detail, the items crew flag most.
 */
export function ChecksHistoryClient({ sections }: { sections: SectionSources<HistorySections> }) {
  usePageChrome({ leaf: "History", askSuggestions: ["Which check gets missed most?"] })
  const { pending } = useCounterTransition()
  return (
    <>
      <ChecksHead sub="Every check, by day" />
      <Section title="History" meta={(d) => `Last ${d.range} days`} data={sections.history} pending={pending} pad={false}>
        {(d) => <History data={d} />}
      </Section>
    </>
  )
}

const RANGES = [7, 14, 30] as const

function History({ data }: { data: HistoryData }) {
  const router = useRouter()
  const [sel, setSel] = useState<{ row: number; col: number } | null>(() => firstInteresting(data))
  const row = sel ? data.rows[sel.row] : null
  const cell = row && sel ? row.cells[sel.col] : null
  const setRange = (r: number) => {
    const q = new URLSearchParams()
    q.set("range", String(r))
    if (data.storeId) q.set("store", data.storeId)
    router.push(`/dashboard/checks/history?${q.toString()}`)
  }
  const cols = `auto auto repeat(${data.days.length}, 26px) auto`

  return (
    <div style={{ display: "grid", gap: 14, padding: 14 }}>
      <div className="ck-spread">
        <StorePicker
          stores={data.stores}
          current={data.storeId}
          path="/dashboard/checks/history"
          allLabel="All stores"
          extra={`range=${data.range}`}
        />
        <div className="seg" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={data.range === r} onClick={() => setRange(r)}>
              {r} days
            </button>
          ))}
        </div>
      </div>
      <div className="ck-split">
        <div className="sec">
          <div className="ck-hist">
            <div className="ck-hgrid" style={{ gridTemplateColumns: cols }}>
              <span />
              <span />
              {data.days.map((d) => (
                <span key={d.day} className={`ck-day${d.weekend ? " we" : ""}`}>
                  {d.top}
                  <br />
                  {d.bottom}
                </span>
              ))}
              <span className="ck-day" style={{ textAlign: "right" }}>
                On time
              </span>
              {data.rows.map((r, ri) => (
                <Fragment key={`${r.storeId}-${r.kind}`}>
                  {r.first && ri > 0 && <span className="ck-sep" />}
                  <span className="ck-sname">{r.first ? r.store : ""}</span>
                  <span className="ck-cname">{r.label}</span>
                  {r.cells.map((c, ci) => (
                    <Glyph
                      key={c.day}
                      status={c.status}
                      flagged={c.flags.length > 0}
                      pressed={sel?.row === ri && sel?.col === ci}
                      title={`${r.store} · ${r.label} · ${data.days[ci].day} · ${c.label}`}
                      onClick={() => setSel({ row: ri, col: ci })}
                    />
                  ))}
                  <span className={`ck-rate ${rateTone(r.rate)}`}>{r.rate === null ? "—" : `${r.rate}%`}</span>
                </Fragment>
              ))}
            </div>
          </div>
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
            <Legend />
          </div>
        </div>
        <div className="sec">
          {row && cell ? <Detail store={row.store} label={row.label} cell={cell} /> : (
            <div className="ck-drawer"><span className="ck-meta">Pick a square to see that check.</span></div>
          )}
          {data.topFlags.length > 0 && <TopFlags data={data} />}
        </div>
      </div>
    </div>
  )
}

function firstInteresting(data: HistoryData): { row: number; col: number } | null {
  for (let col = data.days.length - 1; col >= 0; col--) {
    for (let row = 0; row < data.rows.length; row++) {
      const s = data.rows[row].cells[col].status
      if (s === "missed" || s === "late") return { row, col }
    }
  }
  return null
}

function rateTone(rate: number | null): string {
  if (rate === null) return ""
  if (rate >= 90) return "ck-tone-good"
  if (rate >= 80) return "ck-tone-warn"
  return "ck-tone-bad"
}

function Detail({ store, label, cell }: { store: string; label: string; cell: CellView }) {
  const [open, setOpen] = useState<PhotoRef | null>(null)
  const caption = `${store} · ${label} · ${cell.day}`
  return (
    <div className="ck-drawer">
      <div>
        <div className="ck-mono">
          {store} · {label}
        </div>
        <h3>{new Date(`${cell.day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })}</h3>
      </div>
      <div className="ck-st">
        <Glyph status={cell.status} flagged={cell.flags.length > 0} />
        {cell.label}
      </div>
      <dl className="ck-kv">
        {cell.submittedAt && (<><dt>Submitted</dt><dd>{cell.submittedAt}</dd></>)}
        <dt>Due</dt>
        <dd>{cell.dueLabel}</dd>
        {cell.startedAt && (<><dt>Started</dt><dd>{cell.startedAt}</dd></>)}
        {cell.meta && !cell.submittedAt && (<><dt>Note</dt><dd>{cell.meta}</dd></>)}
        {cell.by && (<><dt>By</dt><dd>{cell.by}</dd></>)}
      </dl>
      {cell.photos.length > 0 && (
        <div className="ck-big">
          {cell.photos.map((p) => (
            <button key={p.id} type="button" onClick={() => setOpen(p)} aria-label={`Open ${p.section} photo`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- private, session-gated image route */}
              <img src={photoSrc(p.id)} alt="" loading="lazy" />
              <span className="ck-mono">{p.section}</span>
            </button>
          ))}
        </div>
      )}
      {cell.flags.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 4 }}>
          {cell.flags.map((f) => (
            <li key={f.item} className="ck-meta">
              <b className="ck-tone-warn">Flagged</b> {f.item}: “{f.note}”
            </li>
          ))}
        </ul>
      )}
      {open && <Lightbox photo={open} caption={caption} onClose={() => setOpen(null)} />}
    </div>
  )
}

function TopFlags({ data }: { data: HistoryData }) {
  const max = Math.max(...data.topFlags.map((f) => f.count))
  return (
    <div className="ck-drawer" style={{ borderTop: "1px solid var(--line)" }}>
      <span className="ck-mono">Most flagged · {data.range} days</span>
      {data.topFlags.map((f) => (
        <div className="ck-hbar" key={`${f.store}-${f.item}`}>
          <span>
            {f.item}
            {data.storeId ? "" : <span className="ck-meta"> · {f.store}</span>}
          </span>
          <span className="ck-bar">
            <i style={{ width: `${(f.count / max) * 100}%` }} />
          </span>
          <span>{f.count}×</span>
        </div>
      ))}
    </div>
  )
}
