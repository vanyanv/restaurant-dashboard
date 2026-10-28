"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSurfaceHref } from "@/components/counter"
import { finishCount, saveCountItem, startCount } from "@/lib/counter/actions/count"
import type { WalkData, WalkItem } from "@/lib/counter/adapters/count"
import { COUNT_AREAS, describeShelf, fmtQty, hasAnyValue, shelfTotal, showQty } from "@/lib/counter/count-layers"
import { money, OutcomeLine, StoreChips, type Outcome } from "./count-ui"

/**
 * The weekly count, one stop at a time. A list of every item in walk order
 * (walk-in, freezer, dry storage, line); tap one and count it in its layers,
 * biggest first — cases, then what's inside, then loose. Each item saves when
 * you move on, so a reload or a dead battery loses nothing already counted.
 * Finishing closes the count, and that is what next week's report measures
 * against.
 *
 * `base` is the page this sits on (`/dashboard/count` or `/m/count`), so the
 * store chips and links stay on the same surface.
 */

type Screen = { kind: "list" } | { kind: "item"; idx: number } | { kind: "done"; n: number; value: number }

function parse(s: string | undefined): number | null {
  if (s == null || s.trim() === "") return null
  const n = Number(s.replace(",", "."))
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

export function CountWalk({ data, base }: { data: WalkData; base: "/dashboard/count" | "/m/count" }) {
  const router = useRouter()
  const href = useSurfaceHref()
  const [busy, start] = useTransition()
  const [screen, setScreen] = useState<Screen>({ kind: "list" })
  const [countId, setCountId] = useState<string | null>(data.count?.id ?? null)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [confirmFinish, setConfirmFinish] = useState(false)
  // What is typed, as text, per item per layer. Seeded from the open count.
  const [typed, setTyped] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(data.items.filter((i) => i.values).map((i) => [i.id, i.values!.map((v) => (v ? fmtQty(v).replace(/,/g, "") : ""))])),
  )
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set(data.items.filter((i) => i.values).map((i) => i.id)))

  // A new screen starts at its top, not wherever the list was scrolled to.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [screen])

  const items = data.items
  const done = items.filter((i) => savedIds.has(i.id)).length
  const valuesOf = (it: WalkItem) => (typed[it.id] ?? []).map(parse)

  const shelfValue = items.reduce(
    (t, it) => (savedIds.has(it.id) && it.cost != null ? t + shelfTotal(it.layers, valuesOf(it).map((v) => (v == null || Number.isNaN(v) ? 0 : v))) * it.cost : t),
    0,
  )

  if (items.length === 0) {
    return (
      <div className="cw">
        <p className="cw__sub">Nothing is on the count list yet. Pick what you count and how it comes in, once, and it's here every week.</p>
        <Link className="cw__btn cw__btn--primary" href={href("/dashboard/count/setup")}>Set up the count list</Link>
      </div>
    )
  }

  const ensureCount = async (): Promise<string | null> => {
    if (countId) return countId
    const r = await startCount(data.store.id)
    if (!r.ok || !r.id) {
      setOutcome({ ok: false, text: r.ok ? "Couldn't open the count" : r.error })
      return null
    }
    setCountId(r.id)
    return r.id
  }

  const open = (idx: number) => {
    setOutcome(null)
    setConfirmFinish(false)
    start(async () => {
      if (await ensureCount()) setScreen({ kind: "item", idx })
    })
  }

  // ── done ────────────────────────────────────────────────────────────────
  if (screen.kind === "done") {
    return (
      <div className="cw">
        <div className="cw__top">
          <span className="cw__mono">{data.store.name}</span>
          <h2 className="cw__h">Count saved</h2>
        </div>
        <div className="cw__hero">
          <span className="cw__mono">Counted</span>
          <b>{screen.n} of {items.length} items</b>
          <span>{screen.value > 0 ? `${money(screen.value)} on the shelves` : "Value shows once items have a price"}</span>
        </div>
        <p className="cw__sub">
          This count is the starting point now. Next week&apos;s count is compared against it, plus deliveries from invoices, minus what sales say you used and the waste you logged.
        </p>
        <div className="cw__foot">
          <Link className="cw__btn cw__btn--primary" href={href(`/dashboard/count/report?store=${data.store.id}`)}>See the report</Link>
          <Link className="cw__btn" href={`${base}/waste?store=${data.store.id}`}>Log waste</Link>
        </div>
      </div>
    )
  }

  // ── one item ────────────────────────────────────────────────────────────
  if (screen.kind === "item") {
    const it = items[screen.idx]
    const raw = typed[it.id] ?? it.layers.map(() => "")
    const vals = raw.map(parse)
    const bad = vals.some((v) => Number.isNaN(v))
    const clean = vals.map((v) => (v == null || Number.isNaN(v) ? 0 : v))
    const total = shelfTotal(it.layers, clean)
    const empty = !hasAnyValue(clean)
    const last = screen.idx === items.length - 1
    const set = (i: number, s: string) => setTyped((t) => ({ ...t, [it.id]: it.layers.map((_, j) => (j === i ? s : (raw[j] ?? ""))) }))
    const bump = (i: number, dir: 1 | -1) => {
      const step = it.layers[i].quarters ? 0.25 : 1
      const cur = clean[i] ?? 0
      set(i, fmtQty(Math.max(0, Math.round((cur + dir * step) * 100) / 100)).replace(/,/g, ""))
    }
    const save = () => {
      if (bad) {
        setOutcome({ ok: false, text: "One of the numbers isn't a number" })
        return
      }
      setOutcome(null)
      start(async () => {
        const id = await ensureCount()
        if (!id) return
        const r = await saveCountItem({ countId: id, countItemId: it.id, values: clean })
        if (!r.ok) {
          setOutcome({ ok: false, text: r.error })
          return
        }
        setSavedIds((s) => new Set(s).add(it.id))
        setTyped((t) => ({ ...t, [it.id]: clean.map((v) => (v ? fmtQty(v).replace(/,/g, "") : "")) }))
        setScreen(last ? { kind: "list" } : { kind: "item", idx: screen.idx + 1 })
      })
    }
    return (
      <div className="cw">
        <div className="cw__top">
          <div className="cw__meta">
            <button type="button" className="cw__link" onClick={() => setScreen({ kind: "list" })}>‹ All items</button>
            <span className="cw__mono">{it.areaLabel} · {screen.idx + 1} of {items.length}</span>
          </div>
          <h2 className="cw__h">{it.name}</h2>
        </div>
        <div className="cw__card">
          {it.layers.map((l, i) => (
            <div className="cw__fld" key={i}>
              <label className="cw__lb" htmlFor={`cw-${it.id}-${i}`}>
                <span className="cw__mono">{i === 0 ? "How it comes" : i === it.layers.length - 1 && it.layers.length > 1 ? "Loose or opened" : "Inside it"}</span>
                {l.label}
                <small>{l.per === 1 ? it.unit : `${showQty(l.per, it.unit)} each`}{l.quarters ? " · in quarters" : ""}</small>
              </label>
              <button type="button" className="cw__step" aria-label={`One less ${l.label}`} onClick={() => bump(i, -1)}>−</button>
              <input
                id={`cw-${it.id}-${i}`}
                className="cw__qty"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={raw[i] ?? ""}
                onChange={(e) => set(i, e.target.value)}
              />
              <button type="button" className="cw__step" aria-label={`One more ${l.label}`} onClick={() => bump(i, 1)}>+</button>
            </div>
          ))}
        </div>
        <div className="cw__hero" aria-live="polite">
          <span className="cw__mono">On hand</span>
          <b>{showQty(total, it.unit)}</b>
          <span>
            {empty ? "Nothing entered yet" : describeShelf(it.layers, clean)}
            {it.cost != null && !empty ? ` · ${money(total * it.cost)}` : ""}
          </span>
        </div>
        <OutcomeLine outcome={outcome} />
        <div className="cw__foot">
          <button type="button" className="cw__btn" disabled={busy} onClick={() => setScreen(last ? { kind: "list" } : { kind: "item", idx: screen.idx + 1 })}>
            Skip
          </button>
          <button type="button" className="cw__btn cw__btn--primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : empty ? (last ? "None here · done" : "None here · next") : last ? "Save · done" : "Save · next"}
          </button>
        </div>
      </div>
    )
  }

  // ── the list ────────────────────────────────────────────────────────────
  const finish = () => {
    if (!countId || done === 0) return
    if (done < items.length && !confirmFinish) {
      setConfirmFinish(true)
      return
    }
    start(async () => {
      const r = await finishCount(countId)
      if (!r.ok) {
        setOutcome({ ok: false, text: r.error })
        return
      }
      // A fresh start for the next count, without a reload.
      setCountId(null)
      setSavedIds(new Set())
      setTyped({})
      setConfirmFinish(false)
      setScreen({ kind: "done", n: done, value: shelfValue })
      router.refresh()
    })
  }
  return (
    <div className="cw">
      <div className="cw__top">
        <StoreChips stores={data.stores} current={data.store.id} path={base} />
        <div className="cw__meta">
          <span>{done} of {items.length} counted</span>
          <span>{data.lastFinished ? `Last count ${data.lastFinished}` : "First count for this store"}</span>
        </div>
        <div className="cw__bar" aria-hidden="true"><i style={{ width: `${Math.round((done / items.length) * 100)}%` }} /></div>
      </div>
      {COUNT_AREAS.map((a) => {
        const rows = items.map((it, idx) => ({ it, idx })).filter(({ it }) => it.area === a.id)
        if (rows.length === 0) return null
        return (
          <div className="cw__area" key={a.id}>
            <span className="cw__mono">{a.label}</span>
            <div className="cw__card">
              {rows.map(({ it, idx }) => {
                const isDone = savedIds.has(it.id)
                const clean = valuesOf(it).map((v) => (v == null || Number.isNaN(v) ? 0 : v))
                return (
                  <button type="button" className="cw__row" key={it.id} disabled={busy} onClick={() => open(idx)}>
                    <span className={`ck-gl ${isDone ? "ck-gl--ok" : "ck-gl--open"}`} aria-hidden="true">{isDone ? "✓" : ""}</span>
                    <b>{it.name}</b>
                    <span>{isDone ? showQty(shelfTotal(it.layers, clean), it.unit) : "not counted"}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      {confirmFinish && (
        <p className="cw__warn" role="alert">
          {items.length - done} {items.length - done === 1 ? "item isn't" : "items aren't"} counted. They&apos;ll be left out of this count. Press Finish again to close it.
        </p>
      )}
      <OutcomeLine outcome={outcome} />
      <div className="cw__foot">
        <Link className="cw__btn" href={`${base}/waste?store=${data.store.id}`}>
          Log waste{data.waste.n ? ` · ${data.waste.n} this week` : ""}
        </Link>
        {countId ? (
          <button type="button" className="cw__btn cw__btn--primary" disabled={busy || done === 0} onClick={finish}>
            {busy ? "Saving…" : "Finish count"}
          </button>
        ) : (
          <button type="button" className="cw__btn cw__btn--primary" disabled={busy} onClick={() => open(0)}>
            {busy ? "Opening…" : "Start the count"}
          </button>
        )}
      </div>
    </div>
  )
}
