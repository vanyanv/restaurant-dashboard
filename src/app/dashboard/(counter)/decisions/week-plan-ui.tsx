"use client"

import { useState, type CSSProperties } from "react"
import { useSurfaceHref } from "@/components/counter"
import {
  Answer,
  BigNumber,
  BigNumbers,
  ButtonLink,
  Card,
  Fold,
  Freshness,
  NeedsYouItem,
  NeedsYouList,
  Status,
  Statuses,
  StoreCard,
  StoreCardGrid,
  Tabs,
} from "@/components/counter/ui"
import type { PlanDay, PlanFigure, PlanTodo, PlanWeekKey, WeekPlan } from "@/lib/counter/week-plan"

/**
 * The Week ahead as a plan, shared by the desk and the phone (mock
 * https://claude.ai/artifact/9X3YWGHNAKdimeJh6ToQNF). Every figure and word
 * arrives from `week-plan.ts`; this file lays it out and keeps two picks in
 * the URL: which week, and which day the detail shows. Both weeks are in
 * the one payload, so switching is instant. The store is a link: it scopes
 * the whole page, the same `?store=` the rail's switcher writes.
 *
 * Layout is `counter-week.css` (`wa-`), with the phone differences decided
 * by each block's own width, not the screen's.
 */
export function WeekPlanView({
  plan,
  initialWeek,
  initialDay,
}: {
  plan: WeekPlan
  initialWeek: PlanWeekKey | null
  initialDay: string | null
}) {
  const href = useSurfaceHref()
  const [wk, setWk] = useState<PlanWeekKey>(initialWeek ?? plan.defaultWeek)
  const week = plan.weeks[wk]
  const [picked, setPicked] = useState<string | null>(initialDay)
  const day =
    week.days.find((d) => d.key === picked) ?? week.days.find((d) => d.key === week.defaultDay) ?? week.days[0] ?? null

  const remember = (nextWeek: PlanWeekKey, nextDay: string | null) => {
    // The URL is the page's memory: a reload, a shared link and the phone
    // open on the same week and day. replaceState, not a navigation: both
    // weeks are already on the page.
    try {
      const url = new URL(window.location.href)
      url.searchParams.set("week", nextWeek)
      if (nextDay) url.searchParams.set("day", nextDay)
      else url.searchParams.delete("day")
      window.history.replaceState(window.history.state, "", url)
    } catch {
      /* a sandboxed frame without history: the pick still works */
    }
  }

  const pickWeek = (key: string) => {
    const k = key === "next" ? "next" : "this"
    setWk(k)
    setPicked(null)
    remember(k, null)
  }
  const pickDay = (key: string) => {
    setPicked(key)
    remember(wk, key)
  }

  const scopeHref = (key: string) => {
    const q = new URLSearchParams()
    if (key !== "all") q.set("store", key)
    q.set("week", wk)
    return href(`/dashboard/decisions?${q.toString()}`)
  }

  const max = Math.max(1, ...week.days.map((d) => Math.max(d.amount ?? 0, d.p90 ?? 0)))
  const due = day ? week.todos.filter((t) => t.due === day.key) : []
  const kinds = (["Order", "Schedule", "Calls"] as const).filter((k) => week.todos.some((t) => t.kind === k))

  return (
    <div className="cu-stack wa">
      <div className="wa-picks">
        <Tabs
          label="Week"
          items={[
            { key: "this", label: "This week" },
            { key: "next", label: "Next week" },
          ]}
          active={wk}
          onSelect={pickWeek}
        />
        <Tabs
          label="Store"
          items={plan.scopes.map((s) => ({ key: s.key, label: s.label, href: scopeHref(s.key) }))}
          active={plan.scope.id ?? "all"}
        />
      </div>

      <Card label={`${week.name}, ${week.label}`}>
        <p className="wa-cap">
          {week.name} · {week.label} · {plan.scope.name}
        </p>
        <Answer>
          {week.sentence.map((s, i) => (s.strong ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
        </Answer>
        <Freshness />
        <BigNumbers>
          <Figure label={wk === "this" ? "Sales this week, sold and forecast" : "Expected sales, forecast"} f={week.sales} />
          <Figure label="Hours scheduled" f={week.hours} />
          <Figure label="To do" f={week.todo} />
        </BigNumbers>
      </Card>

      <Card label="Day by day">
        <div className="wa-key" aria-hidden="true">
          <span>
            <i className="wa-sw wa-sw--sold" />
            Sold
          </span>
          <span>
            <i className="wa-sw wa-sw--fc" />
            Forecast
          </span>
          <span>
            <i className="wa-sw wa-sw--rng" />
            Likely range
          </span>
        </div>
        <div className="wa-days" role="group" aria-label={`${week.name}, day by day`}>
          {week.days.map((d, i) => (
            <DayCell key={d.key} d={d} i={i} max={max} on={d.key === day?.key} onPick={pickDay} />
          ))}
        </div>
      </Card>

      {day ? (
        <Card label={day.full} className="wa-detail">
          <div className="wa-detail__head">
            <h2 className="wa-h">{day.full}</h2>
            <span className="wa-tag">{day.kind === "sold" ? "sold" : day.kind === "today" ? "today, forecast" : "forecast"}</span>
          </div>
          <div className="wa-detail__grid">
            <div>
              <p className="wa-cap">{day.kind === "sold" ? "How it went" : "Why this number"}</p>
              {day.detail.why ? (
                <div className="wa-why">
                  {day.detail.why.map((r, i) => (
                    <div key={`${r.label}-${i}`} className={i === day.detail.why!.length - 1 ? "is-total" : undefined}>
                      <span>{r.label}</span>
                      <span className="wa-num">{r.value}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <p className="wa-note">{day.detail.whyNote}</p>
              {day.detail.range ? <p className="wa-note wa-num">{day.detail.range}</p> : null}
              {day.weather || day.event ? (
                <p className="wa-note">
                  {[day.weather, day.event ? `${day.event} nearby` : null].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </div>
            <div>
              <p className="wa-cap">People by hour</p>
              {day.kind === "sold" ? (
                <p className="wa-note">This day is done. Hours worked are on the Labor page.</p>
              ) : day.detail.hours ? (
                <HourChart bars={day.detail.hours} />
              ) : (
                <p className="wa-note">No store in view has a schedule to check against the forecast.</p>
              )}
              {day.detail.hoursNotes.length > 0 ? (
                <ul className="wa-notes">
                  {day.detail.hoursNotes.map((n) => (
                    <li key={n.text}>
                      <Status tone={n.tone} plain>
                        {n.text}
                      </Status>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div>
              <p className="wa-cap">By store</p>
              <ul className="wa-list">
                {day.detail.stores.map((s) => (
                  <li key={s.id}>
                    <span>
                      <b>{s.name}</b>
                      <small className="wa-num">{s.amount}</small>
                    </span>
                    {s.status ? <Status tone={s.status.tone}>{s.status.text}</Status> : null}
                  </li>
                ))}
              </ul>
              {due.length > 0 ? (
                <>
                  <p className="wa-cap wa-cap--gap">Due this day</p>
                  <NeedsYouList>
                    {due.map((t) => (
                      <Todo key={t.key} t={t} href={href} />
                    ))}
                  </NeedsYouList>
                </>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <StoreCardGrid>
        {week.stores.map((s) => (
          <StoreCard
            key={s.id}
            name={s.name}
            status={s.status}
            figures={s.figures}
            note={s.note}
            href={href(s.href)}
          />
        ))}
      </StoreCardGrid>

      <Card caption="The shelf against the forecast">
        {plan.shelfNote ? <p className="wa-note">{plan.shelfNote}</p> : null}
        {plan.shelf.length > 0 ? (
          <ul className="wa-list">
            {plan.shelf.map((r) => (
              <li key={r.key}>
                <span>
                  <b>{r.what}</b>
                  <small>{r.why}</small>
                </span>
                <Status tone={r.tone}>{r.tag}</Status>
              </li>
            ))}
          </ul>
        ) : null}
        <Statuses>
          <Status tone={plan.accuracy.tone}>{plan.accuracy.text}</Status>
        </Statuses>
      </Card>

      {week.todos.length > 0 ? (
        <Fold
          summary={
            <>
              Needs you <span className="wa-sum">{week.todos.length} for {week.name.toLowerCase()}</span>
            </>
          }
        >
          {kinds.map((k) => (
            <div key={k} className="wa-group">
              <p className="wa-cap">{k === "Calls" ? "Calls" : k}</p>
              <NeedsYouList>
                {week.todos
                  .filter((t) => t.kind === k)
                  .map((t) => (
                    <Todo key={t.key} t={t} href={href} />
                  ))}
              </NeedsYouList>
            </div>
          ))}
        </Fold>
      ) : null}
    </div>
  )
}

function Figure({ label, f }: { label: string; f: PlanFigure }) {
  return (
    <BigNumber
      label={label}
      value={f.value}
      vs={f.vs ?? undefined}
      sub={f.sub || undefined}
      missing={f.missing}
    />
  )
}

function Todo({ t, href }: { t: PlanTodo; href: (p: string) => string }) {
  return (
    <NeedsYouItem what={t.what} why={t.why} bad={t.bad}>
      {t.action ? (
        <ButtonLink href={href(t.action.href)} variant={t.kind === "Order" ? "primary" : "plain"}>
          {t.action.label}
        </ButtonLink>
      ) : null}
    </NeedsYouItem>
  )
}

function DayCell({
  d,
  i,
  max,
  on,
  onPick,
}: {
  d: PlanDay
  i: number
  max: number
  on: boolean
  onPick: (key: string) => void
}) {
  const pct = (v: number | null) => (v === null ? 0 : Math.max(2, Math.min(100, (v / max) * 100)))
  const style = {
    "--i": i,
    "--h": pct(d.amount),
    "--lo": pct(d.p10),
    "--hi": pct(d.p90),
  } as CSSProperties
  const tag = d.kind === "sold" ? "sold" : d.kind === "today" ? "today" : d.kind === "forecast" ? "forecast" : "none yet"
  return (
    <button
      type="button"
      className="wa-day"
      data-kind={d.kind}
      aria-pressed={on}
      onClick={() => onPick(d.key)}
      aria-label={`${d.full}: ${d.amount === null ? "no figure" : `${d.short} ${d.kind === "sold" ? "sold" : "forecast"}`}, ${d.staffing.text}${d.ordersDue > 0 ? `, ${d.ordersDue} to order` : ""}`}
    >
      <span className="wa-day__dow">
        {d.dow} <small>{d.date}</small>
      </span>
      <span className="wa-day__amt wa-num">{d.amount === null ? "—" : d.short}</span>
      <span className="wa-day__barbox" style={style} aria-hidden="true">
        {d.amount !== null ? <i className="wa-day__bar" /> : null}
        {d.p10 !== null && d.p90 !== null ? <i className="wa-day__rng" /> : null}
      </span>
      <span className="wa-day__tag">{tag}</span>
      {d.weather || d.event ? (
        <span className="wa-day__wx">
          {d.weather}
          {d.event ? <b>{d.event}</b> : null}
        </span>
      ) : null}
      <span className="wa-day__st">
        <Status tone={d.staffing.tone}>{d.staffing.text}</Status>
      </span>
      {d.ordersDue > 0 ? <span className="wa-day__due">Order by · {d.ordersDue}</span> : null}
    </button>
  )
}

function HourChart({ bars }: { bars: Array<{ hour: number; label: string; staffed: number; short: number }> }) {
  const top = Math.max(1, ...bars.map((b) => b.staffed + b.short))
  return (
    <>
      <div className="wa-hrs" role="img" aria-label="People scheduled by hour, with the hours that are short in red">
        {bars.map((b) => (
          <span key={b.hour} className="wa-hrs__h">
            {b.short > 0 ? <i className="wa-hrs__x" style={{ height: `${(b.short / top) * 100}%` }} /> : null}
            <i className="wa-hrs__s" style={{ height: `${(b.staffed / top) * 100}%` }} />
          </span>
        ))}
      </div>
      <div className="wa-hrs__lbl" aria-hidden="true">
        {bars.map((b, i) => (
          <span key={b.hour}>{i % 2 === 0 ? b.label : ""}</span>
        ))}
      </div>
      <div className="wa-key" aria-hidden="true">
        <span>
          <i className="wa-sw wa-sw--staff" />
          People scheduled
        </span>
        <span>
          <i className="wa-sw wa-sw--short" />
          Short
        </span>
      </div>
    </>
  )
}
