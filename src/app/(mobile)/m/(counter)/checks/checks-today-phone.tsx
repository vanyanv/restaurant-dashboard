"use client"

import { useState } from "react"
import { Section, useCounterTransition, usePageChrome } from "@/components/counter"
import { shortStoreName } from "@/lib/checks/names"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { CellView, TodayData, TodaySections } from "@/lib/counter/adapters/checks"
import { CheckDetail, PhoneView, PlainHead } from "@/app/dashboard/(counter)/checks/checks-plain-ui"
import { ChecksHead, Glyph, Legend } from "@/app/dashboard/(counter)/checks/checks-ui"
import { ClosedToggle, Missed, PauseLink, PausedNote, Tile, tileLabel } from "@/app/dashboard/(counter)/checks/checks-today-client"
import { useUrlParam } from "@/components/counter/keep/use-url-param"

/**
 * Store checks on a phone — Today. The same adapter as the desk page, laid out
 * for one thumb: the sentence and yesterday's figure, the misses folded into
 * one card, then a card per store with its Morning and Night tile and the
 * week under it. Tapping any check opens it full screen, Back closes it.
 * A paused store is one line with Resume; store tools fold under "More".
 */
export function ChecksTodayPhone({ sections }: { sections: SectionSources<TodaySections> }) {
  usePageChrome({
    leaf: "Store checks",
    askSuggestions: ["Which store misses the most checks?", "Who did last night's check?"],
  })
  const { pending } = useCounterTransition()
  return (
    <>
      <ChecksHead sub="Morning and Night · LA time" />
      <Section bare title="Store checks, made plain" data={sections.today} pending={pending}>
        {(d) => (
          <PlainHead
            sentence={d.plain.sentence}
            figure={d.plain.share ? `${d.plain.share.pct}%` : null}
            figureLabel={d.plain.share ? `${d.plain.shareLabel} · ${d.plain.share.done} of ${d.plain.share.total}` : "Nothing was due yesterday"}
            delta={d.plain.delta}
            deltaLabel={d.plain.deltaLabel}
          />
        )}
      </Section>
      <Section bare title="Missed checks" data={sections.today} pending={pending}>
        {(d) => <Missed data={d} />}
      </Section>
      <Section title="Today" meta={(d) => d.dayLabel} data={sections.today} pending={pending} pad={false}>
        {(d) => <Stores data={d} />}
      </Section>
    </>
  )
}

type Pick = { storeId: string; day: string; kind: string }

/** A check pick in the URL: `?check=<storeId>~<day>~<kind>`. */
function encodePick(p: Pick | null): string {
  return p ? `${p.storeId}~${p.day}~${p.kind}` : ""
}
function decodePick(raw: string): Pick | null {
  const [storeId, day, kind] = raw.split("~")
  return storeId && day && kind ? { storeId, day, kind } : null
}

function Stores({ data }: { data: TodayData }) {
  // The open check lives in the URL so leaving and coming back keeps it.
  const [rawPick, setRawPick] = useUrlParam("check", "")
  const pick = decodePick(rawPick)
  const setPick = (p: Pick | null) => setRawPick(encodePick(p))
  const picked = (() => {
    if (!pick) return null
    const s = data.stores.find((x) => x.id === pick.storeId)
    const c = s?.week.find((w) => w.day === pick.day)?.cells.find((x) => x?.kind === pick.kind)
    const label = data.columns.find((x) => x.kind === pick.kind)?.label ?? ""
    return s && c ? { store: shortStoreName(s.name), label, cell: c } : null
  })()
  const open = (storeId: string, c: CellView) => setPick({ storeId, day: c.day, kind: c.kind })

  return (
    <div className="ckp-stores">
      {data.stores.map((s) => (
        <div key={s.id} className={`ck-store${s.preOpen ? " ck-store--off" : ""}`}>
          <div className="ck-storehead">
            <h3>{shortStoreName(s.name)}</h3>
            <span className="ck-meta">
              {s.preOpen ? "Not open yet" : s.rate7 === null ? "7-day on time · nothing due yet" : `7-day on time · ${s.rate7}%`}
            </span>
          </div>
          {s.preOpen ? (
            <span className="ck-meta">Checks start on their own when the store is set to Open in store settings.</span>
          ) : s.paused ? (
            <PausedNote storeId={s.id} since={s.paused} />
          ) : (
            <>
              <div className="ck-pair">
                {s.cells.map((c, i) =>
                  c ? (
                    <Tile key={c.kind} label={tileLabel(data, s, c, data.columns[i].label)} cell={c} pressed={false} onClick={() => open(s.id, c)} />
                  ) : (
                    <span key={data.columns[i].kind} className="ck-meta">
                      Not set up
                    </span>
                  ),
                )}
              </div>
              <div className="ck-week ckp-week" aria-label="This week, Morning then Night">
                {s.week.map((w) => (
                  <div key={w.day}>
                    <span className="ck-mono">{w.top}</span>
                    <span className="pair">
                      {w.cells.map((c, i) =>
                        c ? (
                          <Glyph
                            key={c.kind}
                            status={c.status}
                            flagged={c.flags.length > 0}
                            title={`${w.top} · ${data.columns[i].label} · ${c.label}`}
                            onClick={() => open(s.id, c)}
                          />
                        ) : null,
                      )}
                    </span>
                  </div>
                ))}
              </div>
              <details className="ckp-more">
                <summary>More for {shortStoreName(s.name)}</summary>
                <span className="ck-row">
                  <ClosedToggle storeId={s.id} day={data.day} closed={s.closedToday} />
                  <PauseLink storeId={s.id} />
                </span>
              </details>
            </>
          )}
        </div>
      ))}
      <div style={{ padding: "4px 2px" }}>
        <Legend />
      </div>
      {picked && (
        <PhoneView title={`${picked.store} · ${picked.label}`} onBack={() => setPick(null)}>
          <CheckDetail store={picked.store} label={picked.label} cell={picked.cell} />
        </PhoneView>
      )}
    </div>
  )
}
