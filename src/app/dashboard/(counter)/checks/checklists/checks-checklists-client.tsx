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
 * (crew can see it from, Submit opens, Submit closes, per night if the close
 * moves), then each section's tasks in English and Spanish side by side, each
 * with its own photo switch. A missing Spanish line shows crew the English one.
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
/** A due clock time is the first one after the open time, past midnight if need be. */
const afterOpen = (clock: number, opens: number) => {
  const d = clock + (opens >= 1440 ? 1440 : 0)
  return d <= opens ? d + 1440 : d
}
/** The same, but the open time itself is allowed (Submit may open with the list). */
const atOrAfter = (clock: number, ref: number) => {
  const d = clock + (ref >= 1440 ? 1440 : 0)
  return d < ref ? d + 1440 : d
}
const isNew = (id: string) => id.startsWith("new-")
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
        kind: t.kind as "MORNING" | "EVENING",
        opensAtMin: t.opensAtMin,
        submitFromMin: t.submitFromMin,
        dueAtMin: t.dueAtMin,
        dueByWeekday: t.dueByWeekday,
        graceMin: 0,
        enabled: t.enabled,
        sections: t.sections.map((s) => ({
          id: isNew(s.id) ? undefined : s.id,
          nameEn: s.nameEn,
          nameEs: s.nameEs,
          items: s.items.map((i) => ({ id: isNew(i.id) ? undefined : i.id, en: i.en, es: i.es, photoRequired: i.photoRequired })),
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
                  {d.enabled
                    ? `Submit ${label12(d.submitFromMin)} – ${label12(d.dueAtMin)} · ${items} task${items === 1 ? "" : "s"} · ${d.sections.reduce((n, s) => n + s.items.filter((i) => i.photoRequired).length, 0)} photo`
                    : "Switched off"}
                </span>
              </button>
            )
          })}
        </div>
        <div className="sec">
          <div className="ck-win">
            <label className="ck-field">
              <span className="ck-mono">Crew can see it from</span>
              <input
                className="ck-input"
                type="time"
                value={toTime(t.opensAtMin)}
                onChange={(e) =>
                  update((t) => {
                    const o = fromTime(e.target.value) + (t.opensAtMin >= 1440 ? 1440 : 0)
                    t.opensAtMin = o
                    t.submitFromMin = atOrAfter(t.submitFromMin % 1440, o)
                    t.dueAtMin = afterOpen(t.dueAtMin % 1440, t.submitFromMin)
                    t.dueByWeekday = t.dueByWeekday.map((d) => afterOpen(d % 1440, t.submitFromMin))
                  })
                }
              />
            </label>
            <label className="ck-field">
              <span className="ck-mono">Submit opens</span>
              <input
                className="ck-input"
                type="time"
                value={toTime(t.submitFromMin)}
                onChange={(e) =>
                  update((t) => {
                    t.submitFromMin = atOrAfter(fromTime(e.target.value), t.opensAtMin)
                    t.dueAtMin = afterOpen(t.dueAtMin % 1440, t.submitFromMin)
                    t.dueByWeekday = t.dueByWeekday.map((d) => afterOpen(d % 1440, t.submitFromMin))
                  })
                }
              />
            </label>
            <label className="ck-field">
              <span className="ck-mono">Submit closes · then missed</span>
              <input
                className="ck-input"
                type="time"
                value={toTime(t.dueAtMin)}
                onChange={(e) =>
                  update((t) => {
                    const d = afterOpen(fromTime(e.target.value), t.submitFromMin)
                    // Nights that followed the usual time keep following it.
                    t.dueByWeekday = t.dueByWeekday.map((x) => (x === t.dueAtMin ? d : x))
                    t.dueAtMin = d
                  })
                }
              />
            </label>
            <div className="ck-field">
              <span className="ck-mono">
                LA time{t.dueAtMin >= 1440 ? " · closes after midnight, counts for the day it opened" : ""}
              </span>
              <div
                className="ck-timeline"
                aria-label={`Crew see it from ${label12(t.opensAtMin)}, submit ${label12(t.submitFromMin)} to ${label12(t.dueAtMin)}`}
              >
                <i className="g" style={{ left: left(t.opensAtMin), width: `calc(${left(t.submitFromMin)} - ${left(t.opensAtMin)})` }} />
                <i className="w" style={{ left: left(t.submitFromMin), width: `calc(${left(t.dueAtMin)} - ${left(t.submitFromMin)})` }} />
                <span style={{ left: left(t.opensAtMin) }}>{label12(t.opensAtMin)}</span>
                <span style={{ left: left(t.submitFromMin) }}>{label12(t.submitFromMin)}</span>
                <span style={{ left: left(t.dueAtMin) }}>{label12(t.dueAtMin)}</span>
              </div>
            </div>
          </div>
          <div className="ck-esect">
            <label className="ck-check">
              <input
                type="checkbox"
                checked={t.opensAtMin >= 1440}
                onChange={(e) =>
                  update((t) => {
                    const o = (t.opensAtMin % 1440) + (e.target.checked ? 1440 : 0)
                    t.opensAtMin = o
                    t.submitFromMin = atOrAfter(t.submitFromMin % 1440, o)
                    t.dueAtMin = afterOpen(t.dueAtMin % 1440, t.submitFromMin)
                    t.dueByWeekday = t.dueByWeekday.map((d) => afterOpen(d % 1440, t.submitFromMin))
                  })
                }
              />
              Opens after midnight. A 12:30 am open still counts for the night before, so Friday&apos;s close is Friday&apos;s check.
            </label>
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
              Submit closes at a different time on some nights. For Night: 2:00 am after a 1 am close, 3:00 am after a 3 am close.
            </label>
            {t.dueByWeekday.length === 7 && (
              <div className="ck-days">
                {WEEK.map(([label, d]) => (
                  <label className="ck-field" key={d}>
                    <span className="ck-mono">{label}</span>
                    <input
                      className="ck-input"
                      type="time"
                      aria-label={`Submit closes on ${label}`}
                      value={toTime(t.dueByWeekday[d])}
                      onChange={(e) =>
                        update((t) => void (t.dueByWeekday[d] = afterOpen(fromTime(e.target.value), t.submitFromMin)))
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
                  <span className="ck-row" style={{ gap: 6, flexWrap: "nowrap" }}>
                  <button
                    type="button"
                    className="ck-phototag"
                    aria-pressed={it.photoRequired}
                    title="Crew must take a photo to tick this task"
                    onClick={() => updateSection(si, (s) => void (s.items[ii].photoRequired = !s.items[ii].photoRequired))}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M3 7h4l2-3h6l2 3h4v13H3z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                    {it.photoRequired ? "Photo required" : "No photo"}
                  </button>
                  <button
                    type="button"
                    className="ck-iconbtn"
                    aria-label={`Remove item ${ii + 1}`}
                    onClick={() => updateSection(si, (s) => void s.items.splice(ii, 1))}
                  >
                    ✕
                  </button>
                  </span>
                </div>
              ))}
              <div>
                <button
                  type="button"
                  className="ck-link"
                  onClick={() => updateSection(si, (s) => void s.items.push({ id: newId(), en: "", es: "", photoRequired: false }))}
                >
                  + Add task
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
                      items: [{ id: newId(), en: "", es: "", photoRequired: false }],
                    }),
                  )
                }
              >
                + Add section
              </button>
              <span className="ck-meta">Crew see changes straight away, and ticks already made stay on their task. Checks already sent keep the wording crew saw.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
