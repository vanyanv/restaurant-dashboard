"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { deleteWaste, logWaste } from "@/lib/counter/actions/count"
import type { WasteData } from "@/lib/counter/adapters/count"
import { WASTE_REASONS, fmtQty, showQty, type WasteReason } from "@/lib/counter/count-layers"
import { money, OutcomeLine, StoreChips, type Outcome } from "./count-ui"

/**
 * The waste log: what, how much, why. Ten seconds, any time of day. The
 * amount can be in any layer the item is counted in (a chub, a lb, a slice);
 * it is saved in the recipe unit, which is what the report subtracts before
 * it works out what went missing without a reason.
 */
export function WasteLog({ data, base }: { data: WasteData; base: "/dashboard/count" | "/m/count" }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [pick, setPick] = useState<string | null>(null)
  const [layer, setLayer] = useState(0)
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState<WasteReason | null>(null)
  const [note, setNote] = useState("")
  const [filter, setFilter] = useState("")

  const item = data.items.find((i) => i.ingredientId === pick) ?? null
  const unit = item?.layers[layer] ?? null
  const qty = Number(amount.replace(",", "."))
  const valid = item && unit && Number.isFinite(qty) && qty > 0 && reason
  const shown = filter.trim()
    ? data.items.filter((i) => i.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : data.items

  const save = () => {
    if (!valid) {
      setOutcome({ ok: false, text: "Pick what, how much and why" })
      return
    }
    start(async () => {
      const r = await logWaste({ storeId: data.store.id, ingredientId: item.ingredientId, qty: qty * unit.per, reason, note: note.trim() || undefined })
      setOutcome(r.ok ? { ok: true, text: `Saved: ${item.name}, ${fmtQty(qty)} × ${unit.label}` } : { ok: false, text: r.error })
      if (r.ok) {
        setPick(null)
        setAmount("")
        setReason(null)
        setNote("")
        setLayer(0)
        router.refresh()
      }
    })
  }

  const undo = (id: string) =>
    start(async () => {
      const r = await deleteWaste(id)
      setOutcome(r.ok ? { ok: true, text: "Removed" } : { ok: false, text: r.error })
      if (r.ok) router.refresh()
    })

  if (data.items.length === 0) {
    return (
      <div className="cw">
        <p className="cw__sub">Waste is logged against the items on your count list, and that list is empty.</p>
        <Link className="cw__btn cw__btn--primary" href="/dashboard/count/setup">Set up the count list</Link>
      </div>
    )
  }

  return (
    <div className="cw">
      <StoreChips stores={data.stores} current={data.store.id} path={`${base}/waste`} />
      <div className="cw__area">
        <span className="cw__mono" id="cw-what">What</span>
        {data.items.length > 12 && (
          <input className="cw__input" placeholder="Find an item" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find an item" />
        )}
        <div className="cw__chips" role="group" aria-labelledby="cw-what">
          {shown.map((i) => (
            <button
              key={i.ingredientId}
              type="button"
              className="cw__chip"
              aria-pressed={pick === i.ingredientId}
              onClick={() => {
                setPick(i.ingredientId)
                setLayer(0)
              }}
            >
              {i.name}
            </button>
          ))}
        </div>
      </div>

      {item && (
        <div className="cw__area">
          <span className="cw__mono">How much</span>
          <div className="cw__card">
            <div className="cw__fld">
              <label className="cw__lb" htmlFor="cw-waste-amt">
                {unit?.label}
                <small>
                  {unit && unit.per !== 1 ? `${showQty(unit.per, item.unit)} each` : item.unit}
                  {item.cost != null && unit && qty > 0 ? ` · ${money(qty * unit.per * item.cost)}` : ""}
                </small>
              </label>
              <button type="button" className="cw__step" aria-label="Less" onClick={() => setAmount(fmtQty(Math.max(0, (Number(amount) || 0) - (unit?.quarters ? 0.25 : 1))).replace(/,/g, ""))}>−</button>
              <input id="cw-waste-amt" className="cw__qty" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <button type="button" className="cw__step" aria-label="More" onClick={() => setAmount(fmtQty((Number(amount) || 0) + (unit?.quarters ? 0.25 : 1)).replace(/,/g, ""))}>+</button>
            </div>
          </div>
          {item.layers.length > 1 && (
            <div className="cw__chips" role="group" aria-label="Counted in">
              {item.layers.map((l, i) => (
                <button key={l.label} type="button" className="cw__chip" aria-pressed={layer === i} onClick={() => setLayer(i)}>
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="cw__area">
        <span className="cw__mono" id="cw-why">Why</span>
        <div className="cw__chips" role="group" aria-labelledby="cw-why">
          {WASTE_REASONS.map((r) => (
            <button key={r.id} type="button" className="cw__chip" aria-pressed={reason === r.id} onClick={() => setReason(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        <input className="cw__input" placeholder="Note (optional)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
      </div>

      <OutcomeLine outcome={outcome} />
      <div className="cw__foot">
        <Link className="cw__btn" href={`${base}?store=${data.store.id}`}>Back to the count</Link>
        <button type="button" className="cw__btn cw__btn--primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save waste"}
        </button>
      </div>

      <div className="cw__area">
        <span className="cw__mono">
          Last 7 days · {data.recent.length} {data.recent.length === 1 ? "entry" : "entries"} · {money(data.weekDollars)}
        </span>
        {data.recent.length === 0 ? (
          <p className="cw__sub">Nothing logged this week.</p>
        ) : (
          <div className="cw__card">
            {data.recent.map((w) => (
              <div className="cw__row" key={w.id} style={{ cursor: "default" }}>
                <b>
                  {w.name}
                  <br />
                  <small style={{ fontWeight: 400, color: "var(--ink-2)" }}>
                    {w.amount} · {w.reason} · {w.when}
                    {w.note ? ` · ${w.note}` : ""}
                  </small>
                </b>
                <span>{w.dollars != null ? money(w.dollars) : ""}</span>
                <button type="button" className="cw__link" disabled={busy} onClick={() => undo(w.id)} aria-label={`Remove ${w.name} waste entry`}>
                  Undo
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
