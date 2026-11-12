"use client"

import { CheckDetail } from "../checks-plain-ui"
import { Fragment, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Section, useCounterTransition, usePageChrome, useSurfaceHref } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { HistoryData, HistorySections } from "@/lib/counter/adapters/checks"
import { ChecksHead, Glyph, Legend, StorePicker } from "../checks-ui"

/**
 * Store checks — History. One row per store and check, by day. Clicking a square
 * opens that check full width under the grid (what wasn't done, the photos one
 * at a time, when it happened), with Previous / Next problem to walk the bad
 * ones. The right edge is the on-time rate; the items crew flag most are on Report.
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
  const detailRef = useRef<HTMLDivElement>(null)
  const [onlyProblems, setOnlyProblems] = useState(false)
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
  // Squares big enough to carry the missed count; 30 days still fits the desk width.
  const size = data.days.length <= 7 ? 40 : data.days.length <= 14 ? 34 : 26
  const cols = `auto auto repeat(${data.days.length}, ${size}px) auto`
  // Every check that went wrong, oldest first, for Previous / Next problem.
  const problems = useMemo(() => {
    const out: Array<{ row: number; col: number }> = []
    data.days.forEach((_, col) => data.rows.forEach((r, row) => r.cells[col].problem && out.push({ row, col })))
    return out
  }, [data])
  const at = sel ? problems.findIndex((p) => p.row === sel.row && p.col === sel.col) : -1
  const step = (dir: 1 | -1) => {
    if (problems.length === 0) return
    let next: number
    if (at >= 0) next = (at + dir + problems.length) % problems.length
    else {
      // From a clean square, go to the nearest problem in that direction by day.
      const col = sel?.col ?? 0
      next = dir === 1 ? problems.findIndex((p) => p.col > col) : findLastIndex(problems, (p) => p.col < col)
      if (next < 0) next = dir === 1 ? 0 : problems.length - 1
    }
    setSel(problems[next])
  }
  const pick = (next: { row: number; col: number }) => {
    setSel(next)
    detailRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  return (
    <div style={{ display: "grid", gap: 14, padding: 14 }}>
      <p className="ck-plain__say" style={{ margin: 0 }}>{data.sentence}</p>
      <div className="ck-spread">
        <StorePicker
          stores={data.stores}
          current={data.storeId}
          path="/dashboard/checks/history"
          allLabel="All stores"
          extra={`range=${data.range}`}
        />
        <span className="ck-row">
          <button
            type="button"
            className="btn btn--quiet"
            aria-pressed={onlyProblems}
            disabled={problems.length === 0}
            onClick={() => setOnlyProblems((v) => !v)}
          >
            {onlyProblems ? "✓ Only problems" : "Only problems"}
          </button>
          <div className="seg" role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button key={r} type="button" aria-pressed={data.range === r} onClick={() => setRange(r)}>
                {r} days
              </button>
            ))}
          </div>
        </span>
      </div>
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
                    size={size}
                    count={c.missed.length}
                    dim={onlyProblems && !c.problem}
                    flagged={c.flags.length > 0}
                    pressed={sel?.row === ri && sel?.col === ci}
                    title={`${r.store} · ${r.label} · ${data.days[ci].day} · ${c.label}${c.missed.length ? ` · ${c.missed.length} missed` : ""}`}
                    onClick={() => pick({ row: ri, col: ci })}
                  />
                ))}
                <span className={`ck-rate ${rateTone(r.rate)}`}>{r.rate === null ? "—" : `${r.rate}%`}</span>
              </Fragment>
            ))}
          </div>
        </div>
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", display: "grid", gap: 6 }}>
          <Legend />
          <span className="ck-meta">A number in a square is how many tasks were missed.</span>
        </div>
      </div>
      <div className="sec" ref={detailRef} style={{ scrollMarginTop: 16 }}>
        {row && cell ? (
          <CheckDetail
            key={`${sel?.row}-${sel?.col}`}
            wide
            store={row.store}
            label={row.label}
            cell={cell}
            actions={
              <span className="ck-row">
                <button type="button" className="btn btn--quiet" disabled={problems.length === 0} onClick={() => step(-1)}>
                  ‹ Previous problem
                </button>
                <button type="button" className="btn btn--quiet" disabled={problems.length === 0} onClick={() => step(1)}>
                  Next problem ›
                </button>
              </span>
            }
          />
        ) : (
          <div className="ck-drawer">
            <span className="ck-meta">
              {problems.length === 0 ? "Nothing went wrong in these days. Pick any square to see that check." : "Pick a square to see that check."}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function findLastIndex<T>(xs: T[], f: (x: T) => boolean): number {
  for (let i = xs.length - 1; i >= 0; i--) if (f(xs[i])) return i
  return -1
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
      if (data.rows[row].cells[col].problem) return { row, col }
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
