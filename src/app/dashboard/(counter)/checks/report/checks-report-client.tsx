"use client"

import { useRouter } from "next/navigation"
import { Section, useCounterTransition, usePageChrome, useSurfaceHref } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { ReportData, ReportSections } from "@/lib/counter/adapters/checks"
import { ChecksHead, StorePicker } from "../checks-ui"
import { PlainHead } from "../checks-plain-ui"

/**
 * Store checks — Report. What the saved ticks say over 7, 14 or 30 days: the
 * share of tasks done, the tasks missed most, the nights that slip, and what
 * each person did. Every figure is counted from the ticks; nothing is guessed.
 * The same client renders on the desk and the phone; the layout stacks.
 */
export function ChecksReportClient({ sections }: { sections: SectionSources<ReportSections> }) {
  usePageChrome({ leaf: "Report", askSuggestions: ["Which task gets missed most?"] })
  const { pending } = useCounterTransition()
  return (
    <>
      <ChecksHead sub="What the checks say" />
      <Section title="Report" meta={(d) => `Last ${d.range} days`} data={sections.report} pending={pending} pad={false}>
        {(d) => <Report data={d} />}
      </Section>
    </>
  )
}

const RANGES = [7, 14, 30] as const

function Report({ data }: { data: ReportData }) {
  const router = useRouter()
  const href = useSurfaceHref()
  const f = data.figures
  const setRange = (r: number) => {
    const q = new URLSearchParams()
    q.set("range", String(r))
    if (data.storeId) q.set("store", data.storeId)
    router.push(href(`/dashboard/checks/report?${q.toString()}`))
  }
  const delta = f.share && data.prevPct !== null ? f.share.pct - data.prevPct : null

  return (
    <div className="ck-rep">
      <div className="ck-spread" style={{ padding: "14px 14px 0" }}>
        <StorePicker stores={data.stores} current={data.storeId} path="/dashboard/checks/report" allLabel="All stores" extra={`range=${data.range}`} />
        <div className="seg" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={data.range === r} onClick={() => setRange(r)}>
              {r} days
            </button>
          ))}
        </div>
      </div>

      <PlainHead
        sentence={data.sentence}
        figure={f.share ? `${f.share.pct}%` : null}
        figureLabel={f.share ? `of tasks done · ${f.share.done} of ${f.share.total}` : "no task lists due"}
        delta={delta}
        deltaLabel={`vs the ${data.range} days before`}
      />

      <div className="ck-rep__tiles">
        <Tile n={f.checks.due} label="checks due" />
        <Tile n={f.checks.complete} label="all done" tone="good" />
        <Tile n={f.checks.partial} label="some missed" tone={f.checks.partial ? "warn" : undefined} />
        <Tile n={f.checks.missed} label="not started" tone={f.checks.missed ? "bad" : undefined} />
        <Tile n={f.checks.late} label="done late" tone={f.checks.late ? "warn" : undefined} />
        <Tile n={f.rushed} label="ticked in a rush" tone={f.rushed ? "warn" : undefined} />
        <Tile n={f.photosSentBack} label="photos sent back" />
      </div>

      <div className="ck-rep__grid">
        <div className="ck-rep__card">
          <h3>Missed most</h3>
          {f.mostMissed.length === 0 ? (
            <p className="ck-meta">No task was missed in these {data.range} days.</p>
          ) : (
            <ol className="ck-rep__bars">
              {f.mostMissed.map((t) => {
                const pct = Math.round((t.missed / t.of) * 100)
                return (
                  <li key={`${t.store}:${t.check}:${t.item}`}>
                    <div className="ck-rep__barhead">
                      <span>{t.item}</span>
                      <b>
                        {t.missed} of {t.of}
                      </b>
                    </div>
                    <div className="ck-rep__bar" aria-hidden>
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <span className="ck-meta">
                      {data.storeId ? t.check : `${t.store} · ${t.check}`}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        <div className="ck-rep__card">
          <h3>By weekday</h3>
          {f.weekdays.length === 0 ? (
            <p className="ck-meta">No check with a task list was due.</p>
          ) : (
            f.weekdays.map((w) => (
              <div key={w.kind} className="ck-rep__wk">
                <span className="ck-meta">{w.label}</span>
                <div className="ck-rep__wkrow">
                  {w.days.map((d) => (
                    <div
                      key={d.weekday}
                      className={`ck-rep__wd${d.pct === null ? " none" : d.pct === 100 ? " full" : d.pct >= 80 ? " most" : " low"}`}
                      title={d.pct === null ? `${d.short}: none due` : `${d.short}: ${d.pct}% of tasks over ${d.checks} checks`}
                    >
                      <span>{d.short}</span>
                      <b>{d.pct === null ? "—" : `${d.pct}%`}</b>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
          <p className="ck-meta">Share of tasks done, by the day the check belongs to.</p>
        </div>
      </div>

      <div className="ck-rep__card ck-rep__people">
        <h3>Crew</h3>
        {f.people.length === 0 ? (
          <p className="ck-meta">Nobody ticked a task in these {data.range} days.</p>
        ) : (
          <>
            <div className="ck-rep__prow ck-rep__phead ck-meta" aria-hidden>
              <span>Name</span>
              <span>Checks</span>
              <span>Tasks</span>
              <span>Late</span>
              <span>Notes</span>
              <span>Typical time</span>
            </div>
            <ul>
              {f.people.map((p) => (
                <li key={p.name} className="ck-rep__prow">
                  <b>{p.name}</b>
                  <span data-l="Checks">{p.checks}</span>
                  <span data-l="Tasks">{p.tasks}</span>
                  <span data-l="Late">{p.lateTicks}</span>
                  <span data-l="Notes">{p.notes}</span>
                  <span data-l="Typical time">{p.typicalSpan ?? "—"}</span>
                </li>
              ))}
            </ul>
            <p className="ck-meta">Typical time is the middle of each person's first-to-last tick on a check.</p>
          </>
        )}
      </div>
    </div>
  )
}

function Tile({ n, label, tone }: { n: number; label: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className={`ck-rep__tile${tone ? ` ${tone}` : ""}`}>
      <b>{n}</b>
      <span className="ck-meta">{label}</span>
    </div>
  )
}
