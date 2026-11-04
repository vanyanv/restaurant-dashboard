"use client"

import Link from "next/link"
import { Fragment, useState } from "react"
import { useSurfaceHref } from "@/components/counter"
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
  const max = Math.max(1, ...p.weeks.map((w) => Math.max(0, w.kept)))
  const v = p.vsPrior
  return (
    <div className="pl-hero">
      <div className="pl-card pl-kept">
        <span className="pl-cap">Kept after every cost</span>
        <div className="pl-big">
          {p.sales > 0 ? (
            <>
              {p.atMost ? "≤ " : ""}
              {money(p.kept)}
              <small>{pct(p.keptPct)} of sales</small>
            </>
          ) : (
            "No sales"
          )}
        </div>
        {p.atMost ? <span className="pl-atmost">{p.atMost}</span> : null}
        <div className="pl-delta">
          {v ? (
            <>
              <span>
                vs {v.label}:{" "}
                <b className={v.kept >= 0 ? "pl-up" : "pl-down"}>
                  {v.kept >= 0 ? "▲ " : "▼ "}
                  {signed(v.kept)}
                </b>
              </span>
              {v.pts !== null ? (
                <span>
                  <b className={v.pts >= 0 ? "pl-up" : "pl-down"}>{pts(v.pts)}</b> of sales
                </span>
              ) : null}
              <span>sales {signed(v.sales)}</span>
            </>
          ) : (
            <span>no earlier period to compare</span>
          )}
        </div>
        {p.sentence ? <p className="pl-lead">{p.sentence}</p> : null}
      </div>

      {p.weeks.length > 0 ? (
        <div className="pl-card pl-weeks">
          <div className="pl-weeks__top">
            <span className="pl-cap">Last {p.weeks.length} weeks · tap a week</span>
            <span className="pl-key">
              <span>
                <i />
                complete
              </span>
              <span>
                <i className="is-part" />
                labor missing, true number lower
              </span>
            </span>
          </div>
          <div className="pl-wk">
            {p.weeks.map((w) => {
              const on = isSelected(w.window, range)
              return (
                <button
                  key={w.window.start}
                  type="button"
                  aria-pressed={on}
                  aria-label={`Week of ${w.label}: kept ${w.atMost ? "at most " : ""}${money(w.kept)}`}
                  onClick={() => {
                    const r = readWeekWindow(w.window)
                    onWeek({ start: r.start, end: r.end })
                  }}
                >
                  <span className="pl-wk__pct">{w.sales > 0 ? pct(w.keptPct) : "—"}</span>
                  <span
                    className={`pl-bar${w.atMost ? " is-part" : ""}`}
                    style={{ height: w.sales > 0 ? `${Math.max(2, (Math.max(0, w.kept) / max) * 100)}%` : 0 }}
                  />
                  <span className="pl-wk__lbl">{w.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function PlainStatuses({ p }: { p: PnlPlain }) {
  return (
    <div className="pl-pills">
      {p.statuses.map((s) => (
        <span key={s.text} className={`pl-pill ${toneClass(s.tone)}`}>
          {s.text}
        </span>
      ))}
    </div>
  )
}

/** "Needs you" body: at most three groups, one button each. */
export function PlainTodos({ p }: { p: PnlPlain }) {
  const href = useSurfaceHref()
  if (p.todos.length === 0) {
    return <p className="pl-nodays">Every input behind this number is on file.</p>
  }
  return (
    <ul className="pl-todos">
      {p.todos.map((t) => (
        <li key={t.title} className={`pl-todo is-${t.tone}`}>
          <span className="pl-todo__t">{t.title}</span>
          <ul>
            {t.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
          <Link className="btn" href={href(t.action.href)}>
            {t.action.label}
          </Link>
        </li>
      ))}
    </ul>
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
          style={{ ["--pl-n" as string]: days.length }}
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
    <div className="pl-stores">
      {p.stores.map((s) => (
        <button key={s.storeId} type="button" className="pl-store" onClick={() => onStore(s.storeId)}>
          <span className="pl-store__nm">{s.name}</span>
          {s.sales > 0 ? (
            <>
              <span className="pl-store__big">
                {s.atMost ? "≤ " : ""}
                {money(s.kept)}
              </span>
              <span className="pl-store__sub">
                {pct(s.keptPct)} of {money(s.sales)}
                {s.keptChange !== null ? (
                  <>
                    {" · "}
                    <span className={s.keptChange >= 0 ? "pl-up" : "pl-down"}>{signed(s.keptChange)}</span> vs
                    before
                  </>
                ) : null}
              </span>
              <span className="pl-store__sub">
                food {cents(s.food)} · labor {cents(s.labor)} · fees {cents(s.fees)}
              </span>
            </>
          ) : (
            <span className="pl-store__sub">no sales in this range</span>
          )}
          {s.flags.length > 0 ? (
            <span className="pl-store__flag">{s.flags.join(" · ")}</span>
          ) : (
            <span className="pl-store__sub pl-up">every input on file</span>
          )}
        </button>
      ))}
    </div>
  )
}
