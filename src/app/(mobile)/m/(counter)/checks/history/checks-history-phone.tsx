"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Section, useCounterTransition, usePageChrome, useSurfaceHref } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { CellView, HistoryData, HistorySections } from "@/lib/counter/adapters/checks"
import { CheckDetail, PhoneView } from "@/app/dashboard/(counter)/checks/checks-plain-ui"
import { ChecksHead, Glyph, StorePicker } from "@/app/dashboard/(counter)/checks/checks-ui"
import { useUrlFlag } from "@/components/counter/keep/use-url-param"

/**
 * Store checks on a phone — History. The desk's grid is 30 columns wide, so
 * the phone reads it the other way: one card per day, newest first, a row per
 * store and check. "Only misses" keeps the checks that went wrong. Tapping a
 * row opens that check full screen.
 */
export function ChecksHistoryPhone({ sections }: { sections: SectionSources<HistorySections> }) {
  usePageChrome({ leaf: "History", askSuggestions: ["Which check gets missed most?"] })
  const { pending } = useCounterTransition()
  return (
    <>
      <ChecksHead sub="Every check, by day" />
      <Section title="History" meta={(d) => `Last ${d.range} days`} data={sections.history} pending={pending} pad={false}>
        {(d) => <Days data={d} />}
      </Section>
    </>
  )
}

const RANGES = [7, 14, 30] as const

type Entry = { key: string; store: string; label: string; cell: CellView }

function Days({ data }: { data: HistoryData }) {
  const router = useRouter()
  const href = useSurfaceHref()
  const [onlyMisses, setOnlyMisses] = useUrlFlag("misses")
  // The key, not the entry: a photo sent back refreshes the data, and the
  // open check should show it.
  const [openKey, setOpenKey] = useState<string | null>(null)
  const setRange = (r: number) => {
    const q = new URLSearchParams()
    q.set("range", String(r))
    if (data.storeId) q.set("store", data.storeId)
    router.push(href(`/dashboard/checks/history?${q.toString()}`))
  }
  const days = data.days
    .map((d, col) => {
      const entries: Entry[] = data.rows
        .map((r) => ({ key: `${r.storeId}-${r.kind}-${d.day}`, store: r.store, label: r.label, cell: r.cells[col] }))
        .filter((e) => (e.cell.counted || e.cell.live) && (!onlyMisses || e.cell.problem))
      return { ...d, entries, misses: data.rows.filter((r) => r.cells[col].problem).length }
    })
    .reverse()
  const shown = days.filter((d) => d.entries.length > 0)
  const open = openKey ? (days.flatMap((d) => d.entries).find((e) => e.key === openKey) ?? null) : null

  return (
    <div className="ckp-hist">
      <p className="ck-plain__say">{data.sentence}</p>
      <div className="ckp-scroll">
        <StorePicker stores={data.stores} current={data.storeId} path="/dashboard/checks/history" allLabel="All stores" extra={`range=${data.range}`} />
      </div>
      <div className="ck-spread">
        <div className="seg" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={data.range === r} onClick={() => setRange(r)}>
              {r} days
            </button>
          ))}
        </div>
        <label className="ckp-check">
          <input type="checkbox" checked={onlyMisses} onChange={(e) => setOnlyMisses(e.target.checked)} />
          Only misses
        </label>
      </div>
      {shown.length === 0 && (
        <p className="ck-meta">{onlyMisses ? `Nothing went wrong in the last ${data.range} days.` : "No check was due."}</p>
      )}
      {shown.map((d) => (
        <div key={d.day} className="ckp-day">
          <div className="ckp-day__head">
            <b>
              {d.top} {d.bottom}
            </b>
            <span className="ck-meta">{d.misses === 0 ? "All done" : `${d.misses} went wrong`}</span>
          </div>
          <ul>
            {d.entries.map((e) => (
              <li key={e.key}>
                <button type="button" className="ckp-row" onClick={() => setOpenKey(e.key)}>
                  <Glyph status={e.cell.status} flagged={e.cell.flags.length > 0} />
                  <span className="ckp-row__main">
                    <b>
                      {data.storeId ? e.label : `${e.store} · ${e.label}`}
                    </b>
                    <span className="ck-meta">
                      {e.cell.label}
                      {e.cell.total > 0 ? ` · ${e.cell.done} of ${e.cell.total} tasks` : ""}
                    </span>
                  </span>
                  <span className="ckp-row__go" aria-hidden>
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {data.topFlags.length > 0 && (
        <details className="ckp-more">
          <summary>Most flagged · {data.range} days</summary>
          <ul className="ckp-flags">
            {data.topFlags.map((f) => (
              <li key={`${f.store}-${f.item}`}>
                <span>
                  {f.item}
                  {data.storeId ? "" : <span className="ck-meta"> · {f.store}</span>}
                </span>
                <b>{f.count}×</b>
              </li>
            ))}
          </ul>
        </details>
      )}
      {open && (
        <PhoneView title={`${open.store} · ${open.label}`} onBack={() => setOpenKey(null)}>
          <CheckDetail store={open.store} label={open.label} cell={open.cell} />
        </PhoneView>
      )}
    </div>
  )
}
