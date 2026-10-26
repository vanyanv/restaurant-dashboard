"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Section, useCounterTransition, usePageChrome } from "@/components/counter"
import { copyChecklistToOtherStores, saveChecklist } from "@/lib/counter/actions/checks"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  ChecklistsData,
  ChecklistsSections,
  EditorSection,
  EditorTemplate,
} from "@/lib/counter/adapters/checks"
import { ChecksHead, OutcomeLine, StorePicker, type Outcome } from "../checks-ui"

/**
 * Store checks — Checklists. One store and one check at a time: the window
 * (opens, due, late until), then each section with its photo rule and its
 * items in English and Spanish side by side. A missing Spanish line shows
 * crew the English one.
 */
export function ChecksChecklistsClient({ sections }: { sections: SectionSources<ChecklistsSections> }) {
  usePageChrome({ leaf: "Checklists" })
  const { pending } = useCounterTransition()
  return (
    <>
      <ChecksHead sub="What crew see, and when" />
      <Section title="Checklists" meta={(d) => d.store.name} data={sections.checklists} pending={pending} pad={false}>
        {(d) => <Editor key={d.store.id} data={d} />}
      </Section>
    </>
  )
}

const pad2 = (n: number) => String(n).padStart(2, "0")
const toTime = (min: number) => `${pad2(Math.floor((min % 1440) / 60))}:${pad2(min % 60)}`
const fromTime = (v: string) => {
  const [h, m] = v.split(":").map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0
}
/** A clock time at or before the open time means after midnight. */
const afterOpen = (clock: number, opens: number) => (clock <= opens ? clock + 1440 : clock)
/** Monday first, with each day's index into `dueByWeekday` (Sunday = 0). */
const WEEK: Array<[string, number]> = [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 0]]
const label12 = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  return `${h % 12 === 0 ? 12 : h % 12}${m % 60 ? `:${pad2(m % 60)}` : ""} ${h < 12 ? "am" : "pm"}`
}

let tmpId = 0
const newId = () => `new-${++tmpId}`

function Editor({ data }: { data: ChecklistsData }) {
  const router = useRouter()
  const [kind, setKind] = useState(data.templates[0]?.kind ?? "MORNING")
  const [drafts, setDrafts] = useState<Record<string, EditorTemplate>>(() =>
    Object.fromEntries(data.templates.map((t) => [t.kind, structuredClone(t)])),
  )
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [busy, start] = useTransition()
  const t = drafts[kind]

  const update = (fn: (t: EditorTemplate) => void) => {
    setDrafts((d) => {
      const next = structuredClone(d[kind])
      fn(next)
      return { ...d, [kind]: next }
    })
    setDirty((d) => ({ ...d, [kind]: true }))
    setOutcome(null)
  }
  const updateSection = (si: number, fn: (s: EditorSection) => void) => update((t) => fn(t.sections[si]))

  if (!t) return <p className="ck-meta" style={{ padding: 16 }}>No checks set up for this store.</p>

  const save = () =>
    start(async () => {
      const r = await saveChecklist({
        storeId: data.store.id,
        kind: t.kind,
        opensAtMin: t.opensAtMin,
        dueAtMin: t.dueAtMin,
        dueByWeekday: t.dueByWeekday,
        graceMin: t.graceMin,
        enabled: t.enabled,
        sections: t.sections.map((s) => ({
          nameEn: s.nameEn,
          nameEs: s.nameEs,
          photoRequired: s.photoRequired,
          hintEn: s.hintEn,
          hintEs: s.hintEs,
          items: s.items.map((i) => ({ en: i.en, es: i.es })),
        })),
      })
      if (r.ok) {
        setDirty((d) => ({ ...d, [kind]: false }))
        setOutcome({ ok: true, text: r.message ?? "Saved." })
        router.refresh()
      } else setOutcome({ ok: false, text: r.error })
    })

  const copy = () =>
    start(async () => {
      if (dirty[kind]) {
        setOutcome({ ok: false, text: "Save this checklist first, then copy it." })
        return
      }
      const r = await copyChecklistToOtherStores({ storeId: data.store.id, kind: t.kind })
      setOutcome(r.ok ? { ok: true, text: r.message ?? "Copied." } : { ok: false, text: r.error })
    })

  // Due before or at the open time means "after midnight".
  const dueDisplay = t.dueAtMin
  const span = 24 * 60
  const left = (min: number) => `${Math.min(100, Math.max(0, (min / (span + 6 * 60)) * 100))}%`

  return (
    <div style={{ display: "grid", gap: 14, padding: 14 }}>
      <div className="ck-spread">
        <StorePicker stores={data.stores} current={data.store.id} path="/dashboard/checks/checklists" />
        <div className="ck-row">
          <OutcomeLine outcome={outcome} />
          <button type="button" className="btn" onClick={copy} disabled={busy}>
            Copy to other stores
          </button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={busy || !dirty[kind]}>
            {busy ? "Saving…" : dirty[kind] ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>
      <div className="ck-ed">
        <div className="sec ck-cklist" role="group" aria-label="Check">
          {data.templates.map((x) => {
            const d = drafts[x.kind]
            const items = d.sections.reduce((n, s) => n + s.items.length, 0)
            return (
              <button key={x.kind} type="button" aria-pressed={kind === x.kind} onClick={() => setKind(x.kind)}>
                <b>
                  {x.label}
                  {dirty[x.kind] ? " •" : ""}
                </b>
                <span className="ck-meta">
                  {d.enabled ? `${label12(d.opensAtMin)} – ${label12(d.dueAtMin)} · ${items} items` : "Switched off"}
                </span>
              </button>
            )
          })}
        </div>
        <div className="sec">
          <div className="ck-win">
            <label className="ck-field">
              <span className="ck-mono">Opens</span>
              <input
                className="ck-input"
                type="time"
                value={toTime(t.opensAtMin)}
                onChange={(e) =>
                  update((t) => {
                    const o = fromTime(e.target.value)
                    t.opensAtMin = o
                    t.dueAtMin = afterOpen(t.dueAtMin % 1440, o)
                    t.dueByWeekday = t.dueByWeekday.map((d) => afterOpen(d % 1440, o))
                  })
                }
              />
            </label>
            <label className="ck-field">
              <span className="ck-mono">Due</span>
              <input
                className="ck-input"
                type="time"
                value={toTime(t.dueAtMin)}
                onChange={(e) =>
                  update((t) => {
                    const d = afterOpen(fromTime(e.target.value), t.opensAtMin)
                    // Nights that followed the usual due time keep following it.
                    t.dueByWeekday = t.dueByWeekday.map((x) => (x === t.dueAtMin ? d : x))
                    t.dueAtMin = d
                  })
                }
              />
            </label>
            <label className="ck-field">
              <span className="ck-mono">Late until (min after due)</span>
              <input
                className="ck-input"
                type="number"
                min={0}
                max={240}
                step={5}
                value={t.graceMin}
                onChange={(e) => update((t) => void (t.graceMin = Math.max(0, Math.min(240, Number(e.target.value) || 0))))}
              />
            </label>
            <div className="ck-field">
              <span className="ck-mono">
                Window · LA time{dueDisplay >= 1440 ? " · due after midnight, counts for the day it opened" : ""}
              </span>
              <div className="ck-timeline" aria-label={`Open ${label12(t.opensAtMin)}, due ${label12(t.dueAtMin)}, late until ${label12(t.dueAtMin + t.graceMin)}`}>
                <i className="w" style={{ left: left(t.opensAtMin), width: `calc(${left(t.dueAtMin)} - ${left(t.opensAtMin)})` }} />
                <i className="g" style={{ left: left(t.dueAtMin), width: `calc(${left(t.dueAtMin + t.graceMin)} - ${left(t.dueAtMin)})` }} />
                <span style={{ left: left(t.opensAtMin) }}>{label12(t.opensAtMin)}</span>
                <span style={{ left: left(t.dueAtMin) }}>{label12(t.dueAtMin)}</span>
              </div>
            </div>
          </div>
          <div className="ck-esect">
            <label className="ck-check">
              <input
                type="checkbox"
                checked={t.dueByWeekday.length === 7}
                onChange={(e) =>
                  update((t) => void (t.dueByWeekday = e.target.checked ? Array(7).fill(t.dueAtMin) : []))
                }
              />
              Due at a different time on some nights, for a store that closes later on weekends.
            </label>
            {t.dueByWeekday.length === 7 && (
              <div className="ck-days">
                {WEEK.map(([label, d]) => (
                  <label className="ck-field" key={d}>
                    <span className="ck-mono">{label}</span>
                    <input
                      className="ck-input"
                      type="time"
                      aria-label={`Due on ${label}`}
                      value={toTime(t.dueByWeekday[d])}
                      onChange={(e) =>
                        update((t) => void (t.dueByWeekday[d] = afterOpen(fromTime(e.target.value), t.opensAtMin)))
                      }
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="ck-esect">
            <label className="ck-check">
              <input type="checkbox" checked={t.enabled} onChange={(e) => update((t) => void (t.enabled = e.target.checked))} />
              This check is on. Turned off, crew can't start it and it never counts as missed.
            </label>
          </div>
          {t.sections.map((s, si) => (
            <div className="ck-esect" key={`${kind}-${si}`}>
              <div className="ck-erow">
                <span className="ck-mono">Section</span>
                <input
                  className="ck-input"
                  aria-label="Section name in English"
                  value={s.nameEn}
                  onChange={(e) => updateSection(si, (s) => void (s.nameEn = e.target.value))}
                />
                <input
                  className={`ck-input${s.nameEs ? "" : " ck-input--empty"}`}
                  aria-label="Section name in Spanish"
                  placeholder="En español…"
                  value={s.nameEs}
                  onChange={(e) => updateSection(si, (s) => void (s.nameEs = e.target.value))}
                />
                <button
                  type="button"
                  className="ck-link"
                  disabled={t.sections.length === 1}
                  onClick={() => update((t) => void t.sections.splice(si, 1))}
                >
                  Remove section
                </button>
              </div>
              <label className="ck-check">
                <input
                  type="checkbox"
                  checked={s.photoRequired}
                  onChange={(e) => updateSection(si, (s) => void (s.photoRequired = e.target.checked))}
                />
                Photo required for this section
              </label>
              {s.photoRequired && (
                <div className="ck-erow">
                  <span className="ck-mono">Photo hint</span>
                  <input
                    className="ck-input"
                    aria-label="Photo hint in English"
                    placeholder="What the photo should show"
                    value={s.hintEn}
                    onChange={(e) => updateSection(si, (s) => void (s.hintEn = e.target.value))}
                  />
                  <input
                    className={`ck-input${s.hintEs ? "" : " ck-input--empty"}`}
                    aria-label="Photo hint in Spanish"
                    placeholder="En español…"
                    value={s.hintEs}
                    onChange={(e) => updateSection(si, (s) => void (s.hintEs = e.target.value))}
                  />
                  <span />
                </div>
              )}
              <div className="ck-erow ck-erow--head">
                <span />
                <span>English</span>
                <span>Español</span>
                <span />
              </div>
              {s.items.map((it, ii) => (
                <div className="ck-erow" key={it.id}>
                  <span className="ck-row" style={{ gap: 4 }}>
                    <button
                      type="button"
                      className="ck-iconbtn"
                      aria-label="Move up"
                      disabled={ii === 0}
                      onClick={() => updateSection(si, (s) => void s.items.splice(ii - 1, 0, ...s.items.splice(ii, 1)))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="ck-iconbtn"
                      aria-label="Move down"
                      disabled={ii === s.items.length - 1}
                      onClick={() => updateSection(si, (s) => void s.items.splice(ii + 1, 0, ...s.items.splice(ii, 1)))}
                    >
                      ↓
                    </button>
                  </span>
                  <input
                    className="ck-input"
                    aria-label={`Item ${ii + 1} in English`}
                    value={it.en}
                    onChange={(e) => updateSection(si, (s) => void (s.items[ii].en = e.target.value))}
                  />
                  <input
                    className={`ck-input${it.es ? "" : " ck-input--empty"}`}
                    aria-label={`Item ${ii + 1} in Spanish`}
                    placeholder="Shows English until filled in"
                    value={it.es}
                    onChange={(e) => updateSection(si, (s) => void (s.items[ii].es = e.target.value))}
                  />
                  <button
                    type="button"
                    className="ck-iconbtn"
                    aria-label={`Remove item ${ii + 1}`}
                    onClick={() => updateSection(si, (s) => void s.items.splice(ii, 1))}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div>
                <button
                  type="button"
                  className="ck-link"
                  onClick={() => updateSection(si, (s) => void s.items.push({ id: newId(), en: "", es: "" }))}
                >
                  + Add item
                </button>
              </div>
            </div>
          ))}
          <div className="ck-esect" style={{ borderBottom: 0 }}>
            <div className="ck-spread">
              <button
                type="button"
                className="ck-link"
                onClick={() =>
                  update((t) =>
                    void t.sections.push({
                      id: newId(),
                      nameEn: "",
                      nameEs: "",
                      photoRequired: false,
                      hintEn: "",
                      hintEs: "",
                      items: [{ id: newId(), en: "", es: "" }],
                    }),
                  )
                }
              >
                + Add section
              </button>
              <span className="ck-meta">Changes apply from the next check. Checks already done keep the wording crew saw.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
