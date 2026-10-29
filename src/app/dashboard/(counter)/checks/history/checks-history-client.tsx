"use client"

import { Fragment, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Section, useCounterTransition, usePageChrome, useSurfaceHref } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { HistoryData, HistorySections } from "@/lib/counter/adapters/checks"
import { CheckDetail, ChecksHead, Glyph, Legend, StorePicker } from "../checks-ui"

/**
 * Store checks — History. One row per store and check, by day. Clicking a square
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
  const href = useSurfaceHref()
  const params = useSearchParams()
  const [sel, setSel] = useState<{ row: number; col: number } | null>(
    // A link from the check email names the day and check to open.
    () => linked(data, params.get("day"), params.get("kind")) ?? firstInteresting(data),
  )
  const row = sel ? data.rows[sel.row] : null
  const cell = row && sel ? row.cells[sel.col] : null
  const setRange = (r: number) => {
    const q = new URLSearchParams()
    q.set("range", String(r))
    if (data.storeId) q.set("store", data.storeId)
    router.push(href(`/dashboard/checks/history?${q.toString()}`))
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
          {row && cell ? <CheckDetail store={row.store} label={row.label} cell={cell} /> : (
            <div className="ck-drawer"><span className="ck-meta">Pick a square to see that check.</span></div>
          )}
          {data.topFlags.length > 0 && <TopFlags data={data} />}
        </div>
      </div>
    </div>
  )
}

function linked(data: HistoryData, day: string | null, kind: string | null): { row: number; col: number } | null {
  if (!day || !kind) return null
  const col = data.days.findIndex((d) => d.day === day)
  const row = data.rows.findIndex((r) => r.kind === kind && (!data.storeId || r.storeId === data.storeId))
  return col >= 0 && row >= 0 ? { row, col } : null
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
