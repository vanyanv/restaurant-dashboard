"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Section, useCounterTransition, usePageChrome } from "@/components/counter"
import {
  addCountItem,
  addTopSpendItems,
  moveCountItem,
  removeCountItem,
  saveCountItemSetup,
  type ActionResult,
} from "@/lib/counter/actions/count"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { SetupData, SetupItem, SetupSections } from "@/lib/counter/adapters/count"
import { COUNT_AREAS, fmtQty, resolveLayers, type LayerInput } from "@/lib/counter/count-layers"
import { CountHead, money, OutcomeLine, type Outcome } from "../count-ui"

/**
 * Count & waste — Setup. What is on the weekly count, in which area, in walk
 * order, and the layers each one is counted in: how it comes in first (a
 * case), then what is inside (chubs, packs), then loose or opened. Set once;
 * the count uses it every week. The same item can be on the walk twice, in
 * two areas — beef in the walk-in by the case, and pressed patties on the line.
 */
export function SetupClient({ sections }: { sections: SectionSources<SetupSections> }) {
  usePageChrome({ leaf: "Setup" })
  const { pending } = useCounterTransition()
  return (
    <>
      <CountHead sub="What you count, where it lives, and how it comes in" />
      <Section title="Count list" meta={(d) => `${d.items.length} stops`} data={sections.setup} pending={pending} pad={false}>
        {(d) => <Setup data={d} />}
      </Section>
    </>
  )
}

function useAction() {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [outcome, setOutcome] = useState<Outcome>(null)
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn()
      setOutcome(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error })
      if (r.ok) {
        after?.()
        router.refresh()
      }
    })
  return { busy, outcome, run }
}

function summary(it: SetupItem): string {
  return it.layers
    .map((l, i) => (i === it.layers.length - 1 && l.per === 1 && l.of === it.unit ? l.label : `${l.label} = ${fmtQty(l.qty)} ${l.of}`))
    .join(" · ")
}

function Setup({ data }: { data: SetupData }) {
  const { busy, outcome, run } = useAction()
  const [editing, setEditing] = useState<string | null>(null)
  const [addId, setAddId] = useState("")
  const [addArea, setAddArea] = useState<string>("walk_in")

  return (
    <div style={{ display: "grid" }}>
      <div className="cw-pad" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="cw-ed__row">
          <select className="cw__input" value={addId} onChange={(e) => setAddId(e.target.value)} aria-label="Ingredient to add" style={{ flex: "1 1 260px" }}>
            <option value="">Add an item…</option>
            {data.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.unit}){o.spend > 0 ? ` · ${money(o.spend)} in 60 days` : ""}
              </option>
            ))}
          </select>
          <select className="cw__input" value={addArea} onChange={(e) => setAddArea(e.target.value)} aria-label="Area">
            {COUNT_AREAS.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
          <button type="button" className="cw__btn cw__btn--primary" style={{ flex: "0 0 auto", minHeight: 44 }} disabled={busy || !addId} onClick={() => run(() => addCountItem({ ingredientId: addId, area: addArea }), () => setAddId(""))}>
            Add
          </button>
          {data.items.length === 0 && (
            <button type="button" className="cw__btn" style={{ flex: "0 0 auto", minHeight: 44 }} disabled={busy} onClick={() => run(() => addTopSpendItems(15))}>
              Start with my top 15 by spend
            </button>
          )}
        </div>
        <OutcomeLine outcome={outcome} />
        {data.items.length > 0 && (
          <p className="cw__sub">
            New items start counted loose. Press Edit to add how it comes in — a case, then what&apos;s inside — so the count can be done the way the shelf looks.
          </p>
        )}
      </div>
      {COUNT_AREAS.map((a) => {
        const rows = data.items.filter((i) => i.area === a.id)
        if (rows.length === 0) return null
        return (
          <div key={a.id} style={{ display: "grid" }}>
            <div className="cw__mono" style={{ padding: "12px 14px 6px", background: "var(--paper)", borderBottom: "1px solid var(--line)" }}>{a.label}</div>
            {rows.map((it, i) => (
              <div className="cw-set" key={it.id}>
                <div className="cw-set__name">
                  <b>{it.name}</b>
                  <small>{summary(it)}</small>
                </div>
                <div className="cw-set__btns">
                  <button type="button" aria-label={`Move ${it.name} up`} disabled={busy || i === 0} onClick={() => run(() => moveCountItem({ id: it.id, dir: "up" }))}>↑</button>
                  <button type="button" aria-label={`Move ${it.name} down`} disabled={busy || i === rows.length - 1} onClick={() => run(() => moveCountItem({ id: it.id, dir: "down" }))}>↓</button>
                  <button type="button" aria-expanded={editing === it.id} onClick={() => setEditing(editing === it.id ? null : it.id)}>{editing === it.id ? "Close" : "Edit"}</button>
                  <button type="button" disabled={busy} onClick={() => run(() => removeCountItem(it.id))}>Remove</button>
                </div>
                {editing === it.id && <Editor item={it} busy={busy} onSave={(area, layers) => run(() => saveCountItemSetup({ id: it.id, area, layers }), () => setEditing(null))} />}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

type Draft = { label: string; qty: string; of: string; quarters: boolean }

function Editor({ item, busy, onSave }: { item: SetupItem; busy: boolean; onSave: (area: string, layers: LayerInput[]) => void }) {
  const [area, setArea] = useState(item.area)
  const [rows, setRows] = useState<Draft[]>(() => item.layers.map((l) => ({ label: l.label, qty: fmtQty(l.qty).replace(/,/g, ""), of: l.of, quarters: Boolean(l.quarters) })))
  const layers: LayerInput[] = rows.map((r) => ({ label: r.label, qty: Number(r.qty), of: r.of, quarters: r.quarters }))
  const check = resolveLayers(layers, item.unit)
  const set = (i: number, patch: Partial<Draft>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className="cw-ed">
      <div className="cw-ed__row">
        <label>
          Area
          <select className="cw__input" value={area} onChange={(e) => setArea(e.target.value)}>
            {COUNT_AREAS.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </label>
        <span className="cw__sub">Recipes use {item.unit}. Biggest first: how it comes in, then what&apos;s inside, then loose.</span>
      </div>
      {rows.map((r, i) => {
        const lower = rows.slice(i + 1).map((x) => x.label.trim()).filter(Boolean)
        const choices = [...lower, ...item.units]
        return (
          <div className="cw-ed__row" key={i}>
            <span className="cw__mono" style={{ width: 92 }}>{i === 0 ? "How it comes" : i === rows.length - 1 ? "Loose" : "Inside it"}</span>
            <input className="cw__input" style={{ width: 170 }} value={r.label} aria-label="Layer name" placeholder="Case" onChange={(e) => set(i, { label: e.target.value })} />
            <span>holds</span>
            <input className="cw__input" style={{ width: 80 }} inputMode="decimal" value={r.qty} aria-label={`How many in one ${r.label}`} onChange={(e) => set(i, { qty: e.target.value })} />
            <select className="cw__input" value={choices.includes(r.of) ? r.of : ""} aria-label="Of what" onChange={(e) => set(i, { of: e.target.value })}>
              {!choices.includes(r.of) && <option value="">Pick…</option>}
              {choices.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <label>
              <input type="checkbox" checked={r.quarters} onChange={(e) => set(i, { quarters: e.target.checked })} />
              count in quarters
            </label>
            {rows.length > 1 && (
              <button type="button" className="cw__link" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Remove</button>
            )}
          </div>
        )
      })}
      <div className="cw-ed__row">
        {rows.length < 4 && (
          <button type="button" className="cw__link" onClick={() => setRows((rs) => [{ label: "Case", qty: "1", of: rs[0]?.label ?? item.unit, quarters: false }, ...rs])}>
            + Add a bigger layer on top
          </button>
        )}
        <span className={`cw__msg ${check.ok ? "cw__msg--ok" : "cw__msg--bad"}`}>
          {check.ok
            ? check.layers.map((l) => `1 ${l.label} = ${fmtQty(l.per)} ${item.unit}`).join(" · ")
            : check.error}
        </span>
      </div>
      <div className="cw-ed__row">
        <button type="button" className="cw__btn cw__btn--primary" style={{ flex: "0 0 auto", minHeight: 42 }} disabled={busy || !check.ok} onClick={() => onSave(area, layers)}>
          Save
        </button>
      </div>
    </div>
  )
}
