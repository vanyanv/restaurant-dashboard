"use client"

import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useSurfaceHref } from "@/components/counter"
import { finishCount, saveCountItem, startCount } from "@/lib/counter/actions/count"
import type { WalkData, WalkItem } from "@/lib/counter/adapters/count"
import { COUNT_AREAS, describeShelf, fmtQty, hasAnyValue, shelfTotal, showQty } from "@/lib/counter/count-layers"
import { money, OutcomeLine, type Outcome } from "./count-ui"
import { clearDraft, readDraft, writeDraft } from "@/components/counter/keep/use-draft"

/**
 * The count, in the owner's walk order: the six sections of their Inventory
 * sheet. On a phone it is one item per screen, biggest layer first (cases,
 * then what's inside, then loose), with last count above the boxes so a slip
 * stands out while typing. On the desk the start screen is the sheet itself:
 * one row per item, Enter moves down, totals fill in. Either way each item
 * saves as you go, and "Before you finish" shows what was skipped and what
 * looks off before the count closes. A finished count is what "Order next"
 * and the report read.
 *
 * `base` is the page this sits on (`/dashboard/count` or `/m/count`), so the
 * store chips and links stay on the same surface.
 */

type Screen = { kind: "list" } | { kind: "item"; idx: number } | { kind: "review" } | { kind: "done"; n: number; value: number }

/** A count this far from the last one (either way) is asked about before finishing. */
const OFF_RATIO = 3

function parse(s: string | undefined): number | null {
  if (s == null || s.trim() === "") return null
  const n = Number(s.replace(",", "."))
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

function cleanOf(raw: string[]): number[] {
  return raw.map(parse).map((v) => (v == null || Number.isNaN(v) ? 0 : v))
}

function lastText(it: WalkItem): string | null {
  if (!it.last) return null
  const shelf = it.last.values && hasAnyValue(it.last.values) ? `${describeShelf(it.layers, it.last.values)} · ` : ""
  return `${shelf}${showQty(it.last.qty, it.unit)}`
}

/** "10× last count" when a number is far off the last one, else null. */
function offNote(it: WalkItem, total: number): string | null {
  if (!it.last || !(it.last.qty > 0) || !(total > 0)) return null
  const r = total / it.last.qty
  if (r >= OFF_RATIO) return `${fmtQty(Math.round(r * 10) / 10)}× ${it.last.day}'s count`
  if (r <= 1 / OFF_RATIO) return `a ${fmtQty(Math.round((1 / r) * 10) / 10)}th of ${it.last.day}'s count`
  return null
}

function vsLast(it: WalkItem, total: number): string | null {
  if (!it.last) return null
  const d = total - it.last.qty
  if (Math.abs(d) < 0.005) return `same as ${it.last.day}`
  return `${showQty(Math.abs(d), it.unit)} ${d > 0 ? "more" : "less"} than ${it.last.day}`
}

export function CountWalk({ data, base }: { data: WalkData; base: "/dashboard/count" | "/m/count" }) {
  const router = useRouter()
  const href = useSurfaceHref()
  const [busy, start] = useTransition()
  const [screen, setScreen] = useState<Screen>({ kind: "list" })
  const [countId, setCountId] = useState<string | null>(data.count?.id ?? null)
  const [outcome, setOutcome] = useState<Outcome>(null)
  // What is typed, as text, per item per layer. Seeded from the open count.
  const [typed, setTyped] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(data.items.filter((i) => i.values).map((i) => [i.id, i.values!.map((v) => (v ? fmtQty(v).replace(/,/g, "") : ""))])),
  )
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set(data.items.filter((i) => i.values).map((i) => i.id)))
  // "It's right" on Before you finish: not asked again for this count.
  const [okIds, setOkIds] = useState<Set<string>>(() => new Set())
  const opening = useRef<Promise<string | null> | null>(null)

  /*
   * Leaving mid-count (a call, the app closed, another page) used to drop you
   * back at the item list and lose numbers typed but not yet saved. The item
   * you were on and the unsaved typing are kept in this browser, per store,
   * and put back when you return. Saved items always come from the server.
   */
  const draftKey = `count-walk:${data.store.id}`
  const [restored, setRestored] = useState(false)
  const [resumeId, setResumeId] = useState<string | null>(null)
  useEffect(() => {
    const d = readDraft<{ countId: string | null; itemId: string | null; typed: Record<string, string[]> }>(draftKey)
    // A draft from a count that has since been finished (or a different one)
    // is not this count's work.
    if (d && d.countId === (data.count?.id ?? null)) {
      const unsaved = Object.entries(d.typed ?? {}).filter(([id]) => !savedIds.has(id))
      if (unsaved.length) setTyped((t) => ({ ...t, ...Object.fromEntries(unsaved) }))
      const idx = d.itemId ? data.items.findIndex((i) => i.id === d.itemId) : -1
      if (idx >= 0 && data.count?.id) setResumeId(d.itemId)
    } else if (d) {
      clearDraft(draftKey)
    }
    setRestored(true)
    // Once per store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])
  useEffect(() => {
    if (!restored) return
    if (screen.kind === "done") {
      clearDraft(draftKey)
      return
    }
    const unsaved = Object.fromEntries(Object.entries(typed).filter(([id]) => !savedIds.has(id)))
    const itemId = screen.kind === "item" ? (data.items[screen.idx]?.id ?? null) : resumeId
    if (!itemId && Object.keys(unsaved).length === 0) clearDraft(draftKey)
    else writeDraft(draftKey, { countId, itemId, typed: unsaved })
  }, [restored, screen, typed, savedIds, countId, draftKey, data.items, resumeId])

  // A new screen starts at its top, not wherever the list was scrolled to.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [screen.kind, screen.kind === "item" ? screen.idx : -1])

  /*
   * Picking a store on "Which store are you counting?" lands here with
   * `?walk=1`: on a phone the count opens straight on the next item to count,
   * so the store is the one choice made before counting starts. The desk
   * stays on the sheet, which is already the walk.
   */
  const params = useSearchParams()
  const autoWalk = useRef<(() => void) | null>(null)
  const walked = useRef(false)
  useEffect(() => {
    if (!restored || walked.current || params.get("walk") !== "1") return
    walked.current = true
    router.replace(`${base}?${new URLSearchParams({ store: data.store.id }).toString()}`, { scroll: false })
    if (window.matchMedia("(min-width: 1000px)").matches) return
    autoWalk.current?.()
  }, [restored, params, router, base, data.store.id])

  if (!data.picked) return <StorePick cards={data.storeCards} base={base} />

  const items = data.items
  const done = items.filter((i) => savedIds.has(i.id)).length
  const rawOf = (it: WalkItem) => typed[it.id] ?? it.layers.map(() => "")
  const totalOf = (it: WalkItem) => shelfTotal(it.layers, cleanOf(rawOf(it)))

  const shelfValue = items.reduce((t, it) => (savedIds.has(it.id) && it.cost != null ? t + totalOf(it) * it.cost : t), 0)

  if (items.length === 0) {
    return (
      <div className="cw">
        <p className="cw__sub">Nothing is on the count list yet. Pick what you count and how it comes in, once, and it&apos;s here every week.</p>
        <Link className="cw__btn cw__btn--primary" href={href("/dashboard/count/setup")}>Set up the count list</Link>
      </div>
    )
  }

  const sections = COUNT_AREAS.map((a) => {
    const idxs = items.flatMap((it, idx) => (it.area === a.id ? [idx] : []))
    return { ...a, idxs, done: idxs.filter((i) => savedIds.has(items[i].id)).length }
  }).filter((s) => s.idxs.length > 0)
  const firstOpen = (from = 0) => {
    for (let k = 0; k < items.length; k++) {
      const i = (from + k) % items.length
      if (!savedIds.has(items[i].id)) return i
    }
    return -1
  }
  const resumeIdx = (() => {
    const r = resumeId ? items.findIndex((i) => i.id === resumeId) : -1
    return r >= 0 ? r : firstOpen()
  })()
  const offItems = items.filter((it) => savedIds.has(it.id) && !okIds.has(it.id) && offNote(it, totalOf(it)) != null)
  const skipped = items.filter((it) => !savedIds.has(it.id))

  // On the desk sheet two rows can save before the count exists; they share
  // one opening so the store doesn't get two open counts.
  const ensureCount = (): Promise<string | null> => {
    if (countId) return Promise.resolve(countId)
    if (opening.current) return opening.current
    opening.current = startCount(data.store.id).then((r) => {
      opening.current = null
      if (!r.ok || !r.id) {
        setOutcome({ ok: false, text: r.ok ? "Couldn't open the count" : r.error })
        return null
      }
      setCountId(r.id)
      return r.id
    })
    return opening.current
  }

  const open = (idx: number) => {
    setOutcome(null)
    start(async () => {
      if (await ensureCount()) {
        setResumeId(items[idx].id)
        setScreen({ kind: "item", idx })
      }
    })
  }

  /** Saves one item's numbers; returns whether it saved. */
  const saveItem = async (it: WalkItem, clean: number[]): Promise<boolean> => {
    const id = await ensureCount()
    if (!id) return false
    const r = await saveCountItem({ countId: id, countItemId: it.id, values: clean })
    if (!r.ok) {
      setOutcome({ ok: false, text: `${it.name}: ${r.error}` })
      return false
    }
    setSavedIds((s) => new Set(s).add(it.id))
    setTyped((t) => ({ ...t, [it.id]: clean.map((v) => (v ? fmtQty(v).replace(/,/g, "") : "")) }))
    return true
  }

  const finish = () => {
    if (!countId || done === 0) return
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
      setOkIds(new Set())
      setResumeId(null)
      setScreen({ kind: "done", n: done, value: shelfValue })
      router.refresh()
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
        <p className="cw__sub">The next order is now worked out from this count. Anything you skipped keeps its older number.</p>
        <div className="cw__foot cw__foot--col">
          <Link className="cw__btn cw__btn--primary" href={href(`/dashboard/count/orders?store=${data.store.id}`)}>See what to order next</Link>
          <div className="cw__foot">
            <Link className="cw__btn" href={href(`/dashboard/count/report?store=${data.store.id}`)}>Where food went</Link>
            <Link className="cw__btn" href={`${base}/waste?store=${data.store.id}`}>Log waste</Link>
          </div>
        </div>
      </div>
    )
  }

  // ── one item ────────────────────────────────────────────────────────────
  if (screen.kind === "item") {
    return (
      <ItemScreen
        key={items[screen.idx].id}
        storeName={data.store.name}
        it={items[screen.idx]}
        idx={screen.idx}
        section={sections.find((s) => s.id === items[screen.idx].area)!}
        items={items}
        savedIds={savedIds}
        raw={rawOf(items[screen.idx])}
        busy={busy}
        outcome={outcome}
        onType={(vals) => setTyped((t) => ({ ...t, [items[screen.idx].id]: vals }))}
        onBack={() => setScreen({ kind: "list" })}
        onSave={(clean, then) => {
          setOutcome(null)
          start(async () => {
            if (!(await saveItem(items[screen.idx], clean))) return
            const next = firstOpen(screen.idx + 1)
            if (then === "review" || next < 0 || next <= screen.idx) {
              setResumeId(null)
              setScreen({ kind: "review" })
            } else {
              setResumeId(items[next].id)
              setScreen({ kind: "item", idx: next })
            }
          })
        }}
        onBad={() => setOutcome({ ok: false, text: "One of the numbers isn't a number" })}
      />
    )
  }

  // ── before you finish ──────────────────────────────────────────────────
  if (screen.kind === "review") {
    return (
      <div className="cw cw--focus">
        <div className="cw__top">
          <button type="button" className="cw__link" onClick={() => setScreen({ kind: "list" })}>‹ Sections</button>
          <h2 className="cw__h">Before you finish</h2>
          <p className="cw__sub">
            {done} of {items.length} counted at {data.store.name}.
            {offItems.length + skipped.length === 0 ? " Nothing looks off." : ` ${offItems.length + skipped.length} to look at, each one tap.`}
          </p>
        </div>
        {offItems.length > 0 && (
          <div className="cw__area">
            <span className="cw__mono cw__mono--bad">Looks off · {offItems.length}</span>
            {offItems.map((it) => (
              <div className="cw-rv cw-rv--bad" key={it.id}>
                <div className="cw-rv__top">
                  <b>{it.name}</b>
                  <span>{showQty(totalOf(it), it.unit)}</span>
                </div>
                <span className="cw__sub">That&apos;s {offNote(it, totalOf(it))} ({showQty(it.last!.qty, it.unit)}). A slip?</span>
                <div className="cw__foot">
                  <button type="button" className="cw__btn cw__btn--primary" onClick={() => setScreen({ kind: "item", idx: items.indexOf(it) })}>Fix it</button>
                  <button type="button" className="cw__btn" onClick={() => setOkIds((s) => new Set(s).add(it.id))}>It&apos;s right</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {skipped.length > 0 && (
          <div className="cw__area">
            <span className="cw__mono">Not counted · {skipped.length}</span>
            <div className="cw__card">
              {skipped.map((it) => (
                <div className="cw-rv__row" key={it.id}>
                  <span className="cw-rv__name"><b>{it.name}</b><small>{it.areaLabel}</small></span>
                  <button
                    type="button"
                    className="cw__btn cw-rv__btn"
                    disabled={busy}
                    onClick={() => start(async () => { await saveItem(it, it.layers.map(() => 0)) })}
                  >
                    None here
                  </button>
                  <button type="button" className="cw__btn cw__btn--primary cw-rv__btn" disabled={busy} onClick={() => open(items.indexOf(it))}>Count</button>
                </div>
              ))}
            </div>
            <p className="cw__sub">Anything still not counted is left out of this count and keeps its older number on Order next.</p>
          </div>
        )}
        <OutcomeLine outcome={outcome} />
        <div className="cw__foot cw__foot--stick">
          <button type="button" className="cw__btn cw__btn--primary" disabled={busy || !countId || done === 0} onClick={finish}>
            {busy ? "Saving…" : "Finish count"}
          </button>
        </div>
      </div>
    )
  }

  // ── start: sections on a phone, the sheet on the desk ─────────────────────
  autoWalk.current = resumeIdx >= 0 ? () => open(resumeIdx) : null
  const resumeName = resumeIdx >= 0 ? items[resumeIdx].name : null
  const resumeArea = resumeIdx >= 0 ? items[resumeIdx].areaLabel : null
  return (
    <div className="cw cw--start">
      <div className="cw__top">
        <div className="cw-store">
          <h2 className="cw__h">{data.store.name}</h2>
          {data.stores.length > 1 && <Link className="cw__link" href={base}>Change store</Link>}
        </div>
        <p className="cw__say">
          {countId
            ? done === items.length
              ? "Everything is counted. Look it over and finish."
              : `${done} of ${items.length} counted.${resumeName ? ` Next up: ${resumeName} in ${resumeArea}.` : ""}`
            : `${items.length} items to count, in ${sections.length} sections.`}
          {" "}
          {data.lastFinished ? `Last full count ${data.lastFinished}.` : "This is the first count for this store."}
        </p>
        <div className="cw__bar" aria-hidden="true"><i style={{ width: `${Math.round((done / items.length) * 100)}%` }} /></div>
      </div>

      <div className="cw-phone">
        <span className="cw__mono">Sections, in walk order</span>
        <div className="cw__card">
          {sections.map((s) => {
            const full = s.done === s.idxs.length
            const next = s.idxs.find((i) => !savedIds.has(items[i].id))
            return (
              <button type="button" className="cw-sec" key={s.id} disabled={busy} onClick={() => open(next ?? s.idxs[0])}>
                <span className={`ck-gl ${full ? "ck-gl--ok" : "ck-gl--open"}`} aria-hidden="true">{full ? "✓" : ""}</span>
                <span className="cw-sec__name">
                  <b>{s.label}</b>
                  {countId && next != null && s.done > 0 && <small>Next: {items[next].name}</small>}
                </span>
                <span className={`cw-sec__n ${full ? "cw-sec__n--ok" : ""}`}>{s.done} of {s.idxs.length}</span>
              </button>
            )
          })}
        </div>
        <p className="cw__sub">Tap a section to jump in. Every item saves as you go, so closing the app loses nothing.</p>
      </div>

      <Sheet
        items={items}
        sections={sections}
        rawOf={rawOf}
        savedIds={savedIds}
        onType={(it, vals) => setTyped((t) => ({ ...t, [it.id]: vals }))}
        onSave={(it, clean) => new Promise<boolean>((done) => start(async () => { done(await saveItem(it, clean)) }))}
      />

      <OutcomeLine outcome={outcome} />
      <div className="cw__foot cw__foot--stick cw-start-foot">
        {resumeIdx >= 0 ? (
          <button type="button" className="cw__btn cw__btn--primary cw-phone-only" disabled={busy} onClick={() => open(resumeIdx)}>
            {busy ? "Opening…" : countId && done > 0 ? `Resume at ${resumeName}` : "Start the count"}
          </button>
        ) : null}
        <Link className="cw__btn cw-desk-only" href={`${base}/waste?store=${data.store.id}`}>
          Log waste{data.waste.n ? ` · ${data.waste.n} this week` : ""}
        </Link>
        <button type="button" className={`cw__btn ${resumeIdx < 0 ? "cw__btn--primary" : ""}`} disabled={busy || !countId || done === 0} onClick={() => setScreen({ kind: "review" })}>
          <span className="cw-phone-only">Finish</span><span className="cw-desk-only">Review and finish</span>
        </button>
      </div>
    </div>
  )
}

function ItemScreen({
  storeName,
  it,
  idx,
  section,
  items,
  savedIds,
  raw,
  busy,
  outcome,
  onType,
  onBack,
  onSave,
  onBad,
}: {
  storeName: string
  it: WalkItem
  idx: number
  section: { label: string; idxs: number[] }
  items: WalkItem[]
  savedIds: Set<string>
  raw: string[]
  busy: boolean
  outcome: Outcome
  onType: (vals: string[]) => void
  onBack: () => void
  onSave: (clean: number[], then?: "review") => void
  onBad: () => void
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const vals = raw.map(parse)
  const bad = vals.some((v) => Number.isNaN(v))
  const clean = cleanOf(raw)
  const total = shelfTotal(it.layers, clean)
  const empty = !hasAnyValue(clean)
  const pos = section.idxs.indexOf(idx)
  const off = offNote(it, total)
  const last = lastText(it)
  const set = (i: number, s: string) => onType(it.layers.map((_, j) => (j === i ? s : (raw[j] ?? ""))))
  const bump = (i: number, dir: 1 | -1) => {
    const step = it.layers[i].quarters ? 0.25 : 1
    set(i, fmtQty(Math.max(0, Math.round(((clean[i] ?? 0) + dir * step) * 100) / 100)).replace(/,/g, ""))
  }
  const save = () => (bad ? onBad() : onSave(clean))
  const onKey = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return
    e.preventDefault()
    const next = refs.current[i + 1]
    if (next) next.focus()
    else save()
  }
  const caseNote = it.layers.length > 1 ? `1 ${oneOf(it.layers[0].label)} = ${showQty(it.layers[0].per, it.unit)}` : null

  return (
    <div className="cw cw--focus">
      <div className="cw__top">
        <div className="cw__meta">
          <button type="button" className="cw__link" onClick={onBack}>‹ Sections</button>
          <span className="cw__mono" title={storeName}>{section.label} · {pos + 1} of {section.idxs.length}</span>
        </div>
        <div className="cw-dots" aria-hidden="true">
          {section.idxs.map((i) => (
            <i key={i} className={i === idx ? "on" : savedIds.has(items[i].id) ? "ok" : ""} />
          ))}
        </div>
        <h2 className="cw__h">{it.name}</h2>
        <span className="cw__sub">{it.fullName}{caseNote ? ` · ${caseNote}` : ""}</span>
      </div>
      {last && (
        <div className="cw-last">
          <span className="cw__mono">Last count, {it.last!.day}</span>
          <b>{last}</b>
        </div>
      )}
      <div className="cw__card">
        {it.layers.map((l, i) => (
          <div className="cw__fld" key={i}>
            <label className="cw__lb" htmlFor={`cw-${it.id}-${i}`}>
              {l.label}
              <small>{l.per === 1 ? it.unit : it.unit === "each" ? `${l.per.toLocaleString()} per ${oneOf(l.label)}` : `${showQty(l.per, it.unit)} each`}{l.quarters ? " · in quarters" : ""}</small>
            </label>
            <button type="button" className="cw__step" aria-label={`One less ${l.label}`} onClick={() => bump(i, -1)}>−</button>
            <input
              ref={(el) => {
                refs.current[i] = el
              }}
              id={`cw-${it.id}-${i}`}
              className="cw__qty"
              inputMode="decimal"
              enterKeyHint={i === it.layers.length - 1 ? "done" : "next"}
              autoComplete="off"
              placeholder="0"
              value={raw[i] ?? ""}
              onChange={(e) => set(i, e.target.value)}
              onKeyDown={onKey(i)}
            />
            <button type="button" className="cw__step" aria-label={`One more ${l.label}`} onClick={() => bump(i, 1)}>+</button>
          </div>
        ))}
      </div>
      <div className="cw__hero" aria-live="polite">
        <span className="cw__mono">On hand now</span>
        <b>{showQty(total, it.unit)}</b>
        <span>
          {empty ? "Nothing entered yet" : describeShelf(it.layers, clean)}
          {!empty && vsLast(it, total) ? ` · ${vsLast(it, total)}` : ""}
          {it.cost != null && !empty ? ` · ${money(total * it.cost)}` : ""}
        </span>
      </div>
      {off && <p className="cw__warn" role="status">That&apos;s {off}. Check the numbers before saving.</p>}
      <OutcomeLine outcome={outcome} />
      <div className="cw__foot cw__foot--stick cw-item-foot">
        <button type="button" className="cw__btn" disabled={busy} onClick={() => onSave(it.layers.map(() => 0))}>
          None here
        </button>
        <button type="button" className="cw__btn cw__btn--primary" disabled={busy || empty} onClick={save}>
          {busy ? "Saving…" : "Save · next"}
        </button>
      </div>
    </div>
  )
}

/** The desk: the count as a sheet, one row per item, saved when you leave a row's box. */
function Sheet({
  items,
  sections,
  rawOf,
  savedIds,
  onType,
  onSave,
}: {
  items: WalkItem[]
  sections: Array<{ id: string; label: string; idxs: number[]; done: number }>
  rawOf: (it: WalkItem) => string[]
  savedIds: Set<string>
  onType: (it: WalkItem, vals: string[]) => void
  onSave: (it: WalkItem, clean: number[]) => Promise<boolean>
}) {
  const savedText = useRef<Record<string, string>>({})
  const moveDown = (idx: number, layer: number) => {
    const order = sections.flatMap((s) => s.idxs)
    const at = order.indexOf(idx)
    for (let k = at + 1; k < order.length; k++) {
      const el = document.querySelector<HTMLInputElement>(`[data-cell="${order[k]}-${Math.min(layer, items[order[k]].layers.length - 1)}"]`)
      if (el) {
        el.focus()
        el.select()
        return
      }
    }
  }
  const commit = (it: WalkItem) => {
    const raw = rawOf(it)
    if (raw.map(parse).some((v) => Number.isNaN(v))) return
    const key = raw.join("|")
    if (!raw.some((s) => s.trim() !== "")) return
    if (savedText.current[it.id] === key) return
    savedText.current[it.id] = key
    void onSave(it, cleanOf(raw)).then((ok) => {
      if (!ok && savedText.current[it.id] === key) delete savedText.current[it.id]
    })
  }
  return (
    <div className="cw-sheet">
      <div className="cw-sheet__pin">
        <nav className="cw-sheet__jump" aria-label="Jump to section">
          {sections.map((s) => (
            <a key={s.id} href={`#cw-sec-${s.id}`} className={s.done === s.idxs.length ? "ok" : ""}>
              {s.label} <span>{s.done}/{s.idxs.length}</span>
            </a>
          ))}
        </nav>
        <div className="cw-sheet__row cw-sheet__row--head" aria-hidden="true">
          <span>Item</span>
          <span>Last count</span>
          <span>Count it</span>
          <span>On hand</span>
          <span>vs last</span>
        </div>
      </div>
      <div role="table" aria-label="Count sheet">
      <div className="cw-sheet__row cw-sheet__row--head cw-sr" role="row">
        <span role="columnheader">Item</span>
        <span role="columnheader">Last count</span>
        <span role="columnheader">Count it</span>
        <span role="columnheader">On hand</span>
        <span role="columnheader">vs last</span>
      </div>
      {sections.map((s) => (
        <div role="rowgroup" key={s.id}>
          <div className="cw-sheet__sec" role="row" id={`cw-sec-${s.id}`}>
            <span role="cell">{s.label}</span>
            <span role="cell">{s.done} of {s.idxs.length}</span>
          </div>
          {s.idxs.map((idx) => {
            const it = items[idx]
            const raw = rawOf(it)
            const clean = cleanOf(raw)
            const total = shelfTotal(it.layers, clean)
            const has = hasAnyValue(clean) || savedIds.has(it.id)
            const off = offNote(it, total)
            return (
              <div className={`cw-sheet__row ${off ? "cw-sheet__row--off" : ""}`} role="row" key={it.id}>
                <span className="cw-sheet__name" role="cell">
                  <span className={`ck-gl ${savedIds.has(it.id) ? "ck-gl--ok" : "ck-gl--open"}`} aria-hidden="true">{savedIds.has(it.id) ? "✓" : ""}</span>
                  <span><b>{it.name}</b><small>{it.fullName}</small></span>
                </span>
                <span className="cw-sheet__last" role="cell">{it.last ? <>{lastText(it)}<small>{it.last.day}</small></> : <small>not counted before</small>}</span>
                <span className="cw-sheet__ins" role="cell">
                  {it.layers.map((l, i) => (
                    <label key={i}>
                      <input
                        data-cell={`${idx}-${i}`}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0"
                        aria-label={`${it.name}: ${l.label}`}
                        value={raw[i] ?? ""}
                        onChange={(e) => onType(it, it.layers.map((_, j) => (j === i ? e.target.value : (raw[j] ?? ""))))}
                        onBlur={() => commit(it)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            commit(it)
                            moveDown(idx, i)
                          }
                        }}
                      />
                      <small>{l.label}</small>
                    </label>
                  ))}
                </span>
                <b className="cw-sheet__tot" role="cell">{has ? showQty(total, it.unit) : "—"}</b>
                <span className={`cw-sheet__vs ${off ? "cw-sheet__vs--off" : ""}`} role="cell">
                  {off ? `${off}. Check` : has ? (vsLast(it, total) ?? "") : ""}
                </span>
              </div>
            )
          })}
        </div>
      ))}
      </div>
    </div>
  )
}

/** The first screen of the count: which store. Picking one starts the walk. */
function StorePick({ cards, base }: { cards: WalkData["storeCards"]; base: "/dashboard/count" | "/m/count" }) {
  return (
    <div className="cw">
      <div className="cw__top">
        <h2 className="cw__h">Which store are you counting?</h2>
        <p className="cw__sub">Pick the store you&apos;re standing in. The count opens on the first item to count.</p>
      </div>
      <div className="cw-pick">
        {cards.map((c) => (
          <Link key={c.id} className="cw-pick__store" href={`${base}?${new URLSearchParams({ store: c.id, walk: "1" }).toString()}`}>
            <b>{c.name}</b>
            <span className={c.inProgress != null ? "cw-pick__open" : undefined}>
              {c.inProgress != null
                ? `Count in progress, ${c.inProgress} counted. Pick up where you left off`
                : c.lastFinished
                  ? `Last counted ${c.lastFinished}`
                  : "Not counted yet"}
            </span>
            <i aria-hidden="true">›</i>
          </Link>
        ))}
      </div>
    </div>
  )
}

/** "Cases" → "case", "Boxes" → "box": a layer label read as one of it. */
function oneOf(label: string): string {
  const w = label.toLowerCase()
  if (/(x|ch|sh)es$/.test(w)) return w.slice(0, -2)
  return w.endsWith("s") ? w.slice(0, -1) : w
}
