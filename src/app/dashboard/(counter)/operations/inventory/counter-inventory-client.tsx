"use client"

import { useCallback, useMemo, useState, useTransition} from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  CostBar,
  DateControl,
  Lede,
  MoneyLines,
  Note,
  PageHead,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
  type SwitchableStore,
  SubNav,
} from "@/components/counter"
import { INVENTORY_TABS } from "@/lib/counter/nav"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import { recordInventoryAdjustment } from "@/lib/counter/actions/inventory"
import type {
  InventoryAction,
  InventoryAdjust,
  InventorySections,
} from "@/lib/counter/adapters/inventory"

/** The prototype's three button weights, chosen by the adapter, never here. */
const btnClass = (a: InventoryAction) =>
  a.primary ? "btn btn--primary" : a.quiet ? "btn btn--quiet" : "btn"

/**
 * Inventory, composed from `P.inventory.desk()`
 * (`docs/counter/counter-prototype.html:5732`) in the prototype's own order:
 *
 *   strip → the roster → the readiness bar → the split of a chart and the next
 *   count → what a count would settle.
 *
 * Every section keeps its shape and changes its subject, because there is no
 * par level in this schema, no shrink table, no adjustment ever logged, no
 * forecast model state, and no completed count. The adapter's docblock argues
 * each one and `docs/counter/measurements/2026-08-28-inventory.md` has the
 * table; this file renders what it is handed and prints the reason under each
 * section rather than beside it in a comment.
 *
 * ## The date control does not filter this page
 *
 * Deliberately, and it is the prototype's own decision — `P.inventory` has no
 * `nodate` flag but every figure it draws is a state of the pantry rather than
 * a window of trading. A count is the newest count; a definition is defined or
 * it is not. The control stays because the shell draws it on every page and a
 * page that silently dropped it would look broken; the delivered chart is the
 * one thing here with a window, and it is a fixed eight weeks as the prototype
 * writes it.
 */
export type CounterInventorySections = SectionSources<InventorySections>

const ROSTER_COLUMNS: Column[] = [
  { key: "item", label: "Ingredient" },
  { key: "unit", label: "Counted in" },
  { key: "cost", label: "Cost" },
  { key: "pack", label: "Pack" },
  { key: "counted", label: "Last counted" },
  { key: "ready", label: "Ready" },
]

const ASK_SUGGESTIONS = [
  "Which ingredients cannot be counted yet, and what is missing?",
  "How much has been delivered since the last count?",
  "Why is there no on-hand figure?",
]


/**
 * "ADJUST ON HAND" — the section the prototype ends on, and the one this page
 * never had.
 *
 * `P.inventory`'s last section is "Adjust on hand — when the count was right
 * and the number was not", and its callout carries the argument: an
 * unexplained variance goes to food cost and makes the plate look expensive;
 * an explained one goes to shrink and makes the waste visible.
 *
 * `InventoryAdjustment` has zero rows and nothing could write one, while FIVE
 * consumers read it — the on-hand integral, the waste root-cause forecast, the
 * per-store model context, the chat's `getRecentInventoryAdjustments`, and the
 * COGS adapter, which drops its waste line entirely and says so. Every pound
 * thrown away here has been landing in food cost with no cause on it.
 *
 * The quantity is positive and the reason carries the meaning. An adjustment
 * is "this much left the shelf without being sold"; stock APPEARING is a
 * delivery and belongs on an invoice, which is why the underlying action
 * rejects anything at or below zero rather than treating a negative as a
 * receipt.
 *
 * With no active store there is nothing to write against, so the button says
 * that rather than failing on press.
 */
function AdjustOnHand({ data }: { data: InventoryAdjust }) {
  const router = useRouter()
  const [saving, startSaving] = useTransition()
  const [ingredientId, setIngredientId] = useState("")
  const [qty, setQty] = useState("")
  const [reason, setReason] = useState("EXPIRY")
  const [note, setNote] = useState("")
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)

  const unit =
    data.candidates.find((c) => c.id === ingredientId)?.unit ?? ""

  const save = () => {
    const value = Number(qty.trim())
    if (data.storeId === null) return
    if (ingredientId === "") {
      setSaid({ ok: false, text: "Pick what was adjusted." })
      return
    }
    if (!Number.isFinite(value) || value <= 0) {
      setSaid({ ok: false, text: "How much left the shelf? It has to be more than zero." })
      return
    }
    setSaid(null)
    startSaving(async () => {
      const result = await recordInventoryAdjustment({
        storeId: data.storeId as string,
        ingredientId,
        qty: value,
        reason: reason as "THEFT" | "EXPIRY" | "SUPPLIER_RETURN" | "DAMAGE" | "OTHER",
        note: note.trim() === "" ? null : note.trim(),
      })
      if (!result.ok) {
        setSaid({ ok: false, text: `Not written: ${result.error}.` })
        return
      }
      setQty("")
      setNote("")
      setSaid({ ok: true, text: "Written to shrink." })
      // The on-hand model, the waste forecast and the COGS waste line all read
      // the row that was just written.
      router.refresh()
    })
  }

  return (
    <div className="sec__body">
      <div className="editrow" style={{ gridTemplateColumns: "1fr 110px 130px" }}>
        <select
          className="fld"
          value={ingredientId}
          aria-label="Ingredient adjusted"
          onChange={(e) => setIngredientId(e.target.value)}
        >
          <option value="">What was adjusted…</option>
          {data.candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          className="fld"
          type="text"
          inputMode="decimal"
          value={qty}
          placeholder={unit === "" ? "How much" : unit}
          aria-label="Quantity adjusted"
          onChange={(e) => setQty(e.target.value)}
        />
        <select
          className="fld"
          value={reason}
          aria-label="Reason"
          onChange={(e) => setReason(e.target.value)}
        >
          {data.reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <input
        className="fld"
        type="text"
        value={note}
        placeholder="What happened? (optional, but it is the part you read later)"
        aria-label="Note"
        style={{ marginTop: 7, width: "100%" }}
        onChange={(e) => setNote(e.target.value)}
      />

      <p className="callout" style={{ marginTop: 11 }}>
        {data.callout}
      </p>

      <div className="btnrow" style={{ marginTop: 11 }}>
        <button
          className="btn btn--primary"
          type="button"
          disabled={saving || data.storeId === null}
          onClick={save}
        >
          {data.storeId === null
            ? "No active store to adjust"
            : saving
              ? "Writing…"
              : "Save adjustment"}
        </button>
      </div>

      {said ? <Note tone={said.ok ? "good" : "bad"}>{said.text}</Note> : null}
    </div>
  )
}

export function CounterInventoryClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterInventorySections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  // `leaf` explicitly: this route runs deeper than its rail entry, and
  // `Topbar` would otherwise repeat the owning destination's own label.
  usePageChrome({ leaf: "Inventory", askSuggestions: ASK_SUGGESTIONS })

  const { pending, startTransition } = useCounterTransition()

  const push = useCallback(
    (next: Parameters<typeof writeCounterParams>[1]) => {
      const qs = writeCounterParams(params, next).toString()
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      })
    },
    [params, pathname, router, startTransition],
  )

  const { range, presetId, comparisonId } = counterParams
  const storeName =
    stores.find((s) => s.id === counterParams.storeId)?.name ?? "All stores"

  return (
    <>
      <PageHead title="Inventory" sub={`${storeName} · the state of the count`}>
        <DateControl
          presetId={presetId}
          comparisonId={comparisonId}
          range={range}
          onPreset={(id) => push({ presetId: id })}
          onComparison={(id) => push({ comparisonId: id })}
          onStep={(direction) => push({ range: stepRange(range, direction) })}
          onRange={(next) => push({ range: next })}
        />
      </PageHead>

      {/* The design's `VIEWS` bar for this family — see `INVENTORY_TABS` in
          `@/lib/counter/nav`. Without it these siblings are pages nothing
          links to; `.seg` is not a fidelity landmark, so it changes no count. */}
      <SubNav items={INVENTORY_TABS} label="Inventory" />

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <Section
        title="On hand"
        meta={(r) => r.meta}
        data={sections.roster}
        pending={pending}
        pad={false}
        askAbout="which ingredients cannot be counted yet"
      >
        {(r) => (
          <>
            <Table columns={ROSTER_COLUMNS} rows={r.rows} />
            {/* No `.sec__body` — `sec(..., tbl(...))` emits the table alone, so
                the note carries the body's own inset via `<Note flush>`. */}
            <Note flush>
              {r.note}
            </Note>
          </>
        )}
      </Section>

      <Section
        title="Coverage health"
        meta={(c) => c.meta}
        data={sections.readiness}
        pending={pending}
      >
        {(c) => (
          <>
            <CostBar bands={c.bands} />
            <Note>
              {c.note}
            </Note>
            <div className="btnrow" style={{ marginTop: 12 }}>
              {c.actions.map((a) => (
                <Link key={a.href} className={btnClass(a)} href={a.href}>
                  {a.label}
                </Link>
              ))}
            </div>
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="Delivered, 8 weeks"
          meta={(v) => v.meta}
          data={sections.delivered}
          pending={pending}
        >
          {(v) => <Chart {...v.chart} />}
        </Section>

        <Section
          title="Next count"
          meta={(n) => n.meta}
          data={sections.nextCount}
          pending={pending}
        >
          {(n) => (
            <>
              <Lede>
                {n.lead}
              </Lede>
              <div className="btnrow">
                {n.actions.map((a) => (
                  <Link key={a.href} className={btnClass(a)} href={a.href}>
                    {a.label}
                  </Link>
                ))}
              </div>
            </>
          )}
        </Section>
      </div>

      <Section
        title="What a count would settle"
        meta={(s) => s.meta}
        data={sections.settle}
        pending={pending}
        askAbout="how much has been delivered since the last count"
      >
        {(s) => (
          <>
            <MoneyLines rows={s.money} />
            <p className="callout" style={{ marginTop: 11 }}>
              {s.callout}
            </p>
            <div className="btnrow" style={{ marginTop: 11 }}>
              {s.actions.map((a) => (
                <Link key={a.href} className={btnClass(a)} href={a.href}>
                  {a.label}
                </Link>
              ))}
            </div>
          </>
        )}
      </Section>

      {/* `P.inventory`'s own last section. See `AdjustOnHand`. */}
      <Section
        title="Adjust on hand"
        meta={(a) => a.meta}
        data={sections.adjust}
        pending={pending}
        pad={false}
      >
        {(a) => <AdjustOnHand data={a} />}
      </Section>
    </>
  )
}
