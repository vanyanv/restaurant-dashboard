"use client"

import { Fragment, useState, type CSSProperties } from "react"
import { useSurfaceHref } from "@/components/counter"
import {
  Answer,
  Freshness,
  BigNumber,
  ButtonLink,
  Card,
  NeedsYouItem,
  NeedsYouList,
  Status,
  Statuses,
  StoreCard,
  StoreCardGrid,
  WeekBars,
  type StatusTone,
} from "@/components/counter/ui"
import { money, pct } from "@/lib/counter/format"
import { isoDay, readWeekWindow, type DateRange, type SerializedWeekWindow } from "@/lib/counter/date-range"
import type { PlainDay, PlainLine, PlainTone, PnlPlain } from "@/lib/counter/pnl-plain"

/**
 * The P&L "made plain" — the parts `pnl-plain.ts` reads, drawn. Shared by
 * the desk page and `/m/pnl`, so the two say the same thing in the same words;
 * the phone differences are CSS (`counter-pnl.css`).
 *
 * Everything shown is already a figure of the statement; this file only
 * formats. An incomplete figure prints with "≤" / "at most", never as if it
 * were whole.
 */

const toneClass = (t: PlainTone) => (t === "ok" ? "" : `is-${t}`)

const STATUS_TONE: Record<PlainTone, StatusTone> = { ok: "good", warn: "warn", bad: "bad" }

/** "12¢" */
const cents = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}¢`)

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`

const pts = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} pts`

/** Week windows arrive as day keys; the range is local midnight. Compare day keys, never UTC slices. */
function isSelected(w: SerializedWeekWindow, range: DateRange): boolean {
  return w.start === isoDay(range.start) && w.end === isoDay(range.end)
}

/** The big kept figure, its move, the sentence, and the eight weeks as the picker. */
export function PlainHero({
  p,
  range,
  onWeek,
}: {
  p: PnlPlain
  range: DateRange
  onWeek: (range: DateRange) => void
}) {
  const v = p.vsPrior
  return (
    <div className="pl-hero">
      <Card>
        <BigNumber
          label="Estimated profit"
          value={p.sales > 0 ? money(p.kept) : "No sales"}
          atMost={p.sales > 0 && Boolean(p.atMost)}
          sub={p.sales > 0 ? `${pct(p.keptPct)} of sales` : undefined}
          missing={p.sales > 0 ? (p.keptNote ?? undefined) : undefined}
          vs={
            v && v.kept === null
              ? // The last day is still trading or syncing: only sales, hour for hour.
                {
                  change: `${v.sales >= 0 ? "▲ " : "▼ "}${signed(v.sales)}`,
                  tone: v.sales >= 0 ? "up" : "down",
                  against: `sales ${v.against ?? `vs ${v.label}`}`,
                }
              : v && v.kept !== null
              ? [
                  {
                    change: `${v.kept >= 0 ? "▲ " : "▼ "}${signed(v.kept)}`,
                    tone: v.kept >= 0 ? "up" : "down",
                    against: `vs ${v.label}`,
                  },
                  ...(v.pts !== null
                    ? [{ change: pts(v.pts), tone: v.pts >= 0 ? ("up" as const) : ("down" as const), against: "of sales" }]
                    : []),
                  { change: "", tone: "flat" as const, against: `sales ${signed(v.sales)}` },
                ]
              : { change: "", tone: "flat", against: p.compareNote ?? "no earlier period to compare" }
          }
        />
        {p.sentence ? <Answer>{p.sentence}</Answer> : null}
        <Freshness />
      </Card>

      <WeekBars
        title={`Last ${p.weeks.length} weeks · tap a week`}
        partialLabel="a cost missing, true number lower"
        weeks={p.weeks.map((w) => ({
          key: w.window.start,
          label: w.running ? "so far" : w.label,
          value: w.kept,
          top: w.sales > 0 ? pct(w.keptPct) : "—",
          partial: w.atMost,
          selected: isSelected(w.window, range),
          ariaLabel: `Week of ${w.label}${w.running ? ", so far" : ""}: kept ${w.atMost ? "at most " : ""}${money(w.kept)}`,
        }))}
        onPick={(key) => {
          const w = p.weeks.find((x) => x.window.start === key)
          if (!w) return
          const r = readWeekWindow(w.window)
          onWeek({ start: r.start, end: r.end })
        }}
      />
    </div>
  )
}

export function PlainStatuses({ p }: { p: PnlPlain }) {
  return (
    <Statuses>
      {p.statuses.map((s) => (
        <Status key={s.text} tone={STATUS_TONE[s.tone]}>
          {s.text}
        </Status>
      ))}
    </Statuses>
  )
}

/** "Needs you" body: at most three groups, one button each. */
export function PlainTodos({ p }: { p: PnlPlain }) {
  const href = useSurfaceHref()
  if (p.todos.length === 0) {
    return <p className="pl-nodays">Every input behind this number is on file.</p>
  }
  return (
    <NeedsYouList>
      {p.todos.map((t) => (
        <NeedsYouItem
          key={t.title}
          bad={t.tone === "bad"}
          what={t.title}
          why={
            <ul>
              {t.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          }
        >
          <ButtonLink href={href(t.action.href)}>{t.action.label}</ButtonLink>
        </NeedsYouItem>
      ))}
    </NeedsYouList>
  )
}

/** Where each dollar went: one bar, five slices, each with how it was worked out. */
export function PlainDollar({ p }: { p: PnlPlain }) {
  if (p.sales <= 0) return <p className="pl-nodays">No sales in this range.</p>
  return (
    <>
      <div
        className="pl-dollar"
        role="img"
        aria-label={p.lines.map((l) => `${l.label} ${cents(l.share)}`).join(", ")}
      >
        {p.lines.map((l) => (
          <div key={l.key} className={`pl-c-${l.key}`} style={{ flex: Math.max(0, l.amount) }} />
        ))}
      </div>
      <div className="pl-legend">
        {p.lines.map((l) => (
          <div key={l.key} className="pl-lg">
            <span className="pl-lg__k">
              <i className={`pl-c-${l.key}`} />
              {l.label}
            </span>
            <span className="pl-lg__v">
              {l.key === "kept" && p.atMost ? "≤ " : ""}
              {money(l.amount)}
            </span>
            <span className="pl-lg__s">
              {cents(l.share)} per dollar
              {l.changePts !== null ? (
                <>
                  {" · "}
                  <span className={changeClass(l)}>{pts(l.changePts)}</span>
                </>
              ) : null}
            </span>
            <span className={`pl-how ${toneClass(l.tone)}`}>{l.how}</span>
          </div>
        ))}
      </div>
    </>
  )
}

/** Up is good for kept, bad for a cost. A move under 0.3 pts is not painted. */
function changeClass(l: PlainLine): string {
  if (l.changePts === null || Math.abs(l.changePts) < 0.3) return ""
  const good = l.key === "kept" ? l.changePts > 0 : l.changePts < 0
  return good ? "pl-up" : "pl-down"
}

/** Day by day: a small kept-per-day chart, then one row per day that opens into its lines. */
export function PlainDays({ days, showStores }: { days: PlainDay[]; showStores: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  const max = Math.max(1, ...days.map((d) => Math.max(0, d.kept)))
  return (
    <>
      {days.length <= 14 ? (
        <div
          className="pl-dchart"
          style={{ "--pl-n": days.length } as CSSProperties}
          role="img"
          aria-label={days.map((d) => `${d.label} kept ${money(d.kept)}`).join(", ")}
        >
          {days.map((d) => (
            <div key={d.date}>
              <span className={`pl-dchart__v${d.kept < 0 ? " pl-neg" : ""}`}>
                {d.atMost ? "≤ " : ""}
                {money(d.kept)}
              </span>
              <span
                className={`pl-bar${d.atMost ? " is-part" : ""}${d.best ? " is-best" : ""}`}
                style={{ height: `${(Math.max(0, d.kept) / max) * 80}%` }}
              />
              <span className="pl-dchart__l">{d.short}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="pl-dlist">
        <div className="pl-day pl-dhead" aria-hidden="true">
          <span>Day</span>
          <span className="pl-day__n">Sales</span>
          <span className="pl-day__n">Kept</span>
          <span className="pl-day__n">Kept %</span>
          <span />
        </div>
        {days.map((d) => {
          const on = open === d.date
          return (
            <Fragment key={d.date}>
              <button
                type="button"
                className="pl-day"
                aria-expanded={on}
                onClick={() => setOpen(on ? null : d.date)}
              >
                <span className="pl-day__d">
                  <b>{d.label}</b>
                  {d.best ? <span className="mono"> best day</span> : null}
                  {d.laborMissing.length > 0 ? (
                    <small>{d.laborMissing.join(", ")} labor missing · kept is at most</small>
                  ) : null}
                </span>
                <span className="pl-day__n is-sales">
                  {money(d.sales)}
                  <small> sales</small>
                </span>
                <span className={`pl-day__n is-kept${d.kept < 0 ? " pl-neg" : ""}`}>
                  {d.atMost ? "≤ " : ""}
                  {money(d.kept)}
                </span>
                <span className="pl-day__n is-pct">
                  {d.sales > 0 ? pct(d.keptPct) : "—"}
                  <small> kept</small>
                </span>
                <span className="pl-day__chev" aria-hidden="true">
                  ›
                </span>
              </button>
              {on ? <DayDetail d={d} showStores={showStores} /> : null}
            </Fragment>
          )
        })}
      </div>
    </>
  )
}

function DayDetail({ d, showStores }: { d: PlainDay; showStores: boolean }) {
  const of = (v: number) => (d.sales > 0 ? pct(v / d.sales) : "")
  return (
    <div className="pl-detail">
      <table>
        <tbody>
          <tr>
            <td>Sales</td>
            <td className="r">{money(d.sales, { cents: true })}</td>
            <td className="r mono" />
          </tr>
          {d.lines
            .filter((l) => l.key !== "kept")
            .map((l) => (
              <tr key={l.key}>
                <td>
                  {l.label}
                  <span className={`pl-how ${toneClass(l.tone)}`}>{l.how}</span>
                </td>
                <td className="r">{money(-l.amount, { cents: true })}</td>
                <td className="r mono">{of(-l.amount)}</td>
              </tr>
            ))}
          <tr className="is-sum">
            <td>Kept{d.atMost ? " (at most)" : ""}</td>
            <td className={`r${d.kept < 0 ? " pl-neg" : ""}`}>{money(d.kept, { cents: true })}</td>
            <td className="r">{of(d.kept)}</td>
          </tr>
        </tbody>
      </table>
      {showStores && d.stores.length > 1 ? (
        <table>
          <tbody>
            <tr>
              <td className="pl-cap" colSpan={3}>
                By store this day
              </td>
            </tr>
            {d.stores.map((s) => (
              <tr key={s.storeId}>
                <td>
                  {s.name}
                  {s.laborMissing ? <span className="pl-how is-bad">no labor this day</span> : null}
                </td>
                <td className="r">{money(s.sales)} sales</td>
                <td className={`r${s.kept < 0 ? " pl-neg" : ""}`}>
                  {s.laborMissing ? "≤ " : ""}
                  {money(s.kept)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div />
      )}
    </div>
  )
}

/** One card per store; pressing one scopes the page to it. */
export function PlainStores({ p, onStore }: { p: PnlPlain; onStore: (storeId: string) => void }) {
  return (
    <StoreCardGrid>
      {p.stores.map((s) => (
        <StoreCard
          key={s.storeId}
          name={s.name}
          onClick={() => onStore(s.storeId)}
          status={
            s.flags.length > 0
              ? { tone: "warn", label: "Inputs missing" }
              : { tone: "good", label: "Every input on file" }
          }
          figures={
            s.sales > 0
              ? [
                  { label: "Kept", value: `${s.atMost ? "≤ " : ""}${money(s.kept)}` },
                  { label: "Of sales", value: pct(s.keptPct) },
                ]
              : []
          }
          note={
            s.sales > 0 ? (
              <>
                {money(s.sales)} sales
                {s.keptChange !== null ? (
                  <>
                    {" · "}
                    <span className={s.keptChange >= 0 ? "cu-vs cu-vs--up" : "cu-vs cu-vs--down"}>
                      {signed(s.keptChange)}
                    </span>{" "}
                    vs before
                  </>
                ) : null}
                <br />
                food {cents(s.food)} · labor {cents(s.labor)} · fees {cents(s.fees)}
                {s.flags.length > 0 ? (
                  <>
                    <br />
                    {s.flags.join(" · ")}
                  </>
                ) : null}
              </>
            ) : (
              <>
                No sales in this range
                {s.flags.length > 0 ? (
                  <>
                    <br />
                    {s.flags.join(" · ")}
                  </>
                ) : null}
              </>
            )
          }
        />
      ))}
    </StoreCardGrid>
  )
}
