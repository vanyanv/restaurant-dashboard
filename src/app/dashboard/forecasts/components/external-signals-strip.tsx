import { format } from "date-fns"
import { getExternalSignals } from "@/lib/external-signals"
import { weatherLabel } from "@/lib/weather-labels"
import "./external-signals-strip.css"

interface Props {
  storeIds: string[]
  storeId: string | undefined
  storeName: string
}

function fmtAttendance(n: number | null): string {
  if (n == null || n === 0) return ""
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n / 1000)}k`
}

function pressureClass(p: "balanced" | "thin" | "heavy" | "missing"): string {
  if (p === "thin" || p === "missing") return "ext-strip__cell-accent"
  if (p === "heavy") return "ext-strip__cell-strong"
  return ""
}

function pressureLabel(p: "balanced" | "thin" | "heavy" | "missing"): string {
  if (p === "balanced") return "bal"
  if (p === "thin") return "thin"
  if (p === "heavy") return "heavy"
  return "—"
}

function isToday(dateStr: string): boolean {
  const t = new Date()
  const today = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`
  return dateStr === today
}

// Build the "+X concerts · Y festivals" tail from category counts.
// Skip the top event's own category to avoid double-counting in the headline.
function categoryTail(
  counts: {
    sports: number
    concerts: number
    festivals: number
    performingArts: number
    community: number
    conferences: number
    expos: number
  },
  topCategory: string | null,
  topConsumed: number,
): string {
  const named: Array<[string, number, string]> = [
    ["sports", counts.sports, "sports"],
    ["concerts", counts.concerts, "concerts"],
    ["festivals", counts.festivals, "festivals"],
    ["performing-arts", counts.performingArts, "perf-arts"],
    ["community", counts.community, "community"],
    ["conferences", counts.conferences, "conf"],
    ["expos", counts.expos, "expos"],
  ]
  const parts: string[] = []
  for (const [key, count, label] of named) {
    let n = count
    if (topCategory && key === topCategory) n -= topConsumed
    if (n > 0) parts.push(`${n} ${label}`)
  }
  if (parts.length === 0) return ""
  return parts.slice(0, 3).join(" · ")
}

export async function ExternalSignalsStrip({
  storeIds,
  storeId,
  storeName,
}: Props) {
  const signals = await getExternalSignals(storeIds, { storeId })

  // Empty-state collapse: weather + events both absent, no labor data either.
  if (
    !signals.hasAnyData &&
    signals.labor.every((d) => d.pressure === "missing")
  ) {
    return null
  }

  // Watch-day = day with the highest combined-severity score (ties → later day).
  let watchDay: string | null = null
  let watchScore = 0
  for (const [date, score] of signals.watchScores) {
    if (score >= watchScore) {
      watchScore = score
      watchDay = date
    }
  }
  if (watchScore < 2) watchDay = null // only mark a true watch-day

  const scopeLabel = storeId ? storeName : "Worst-of-portfolio"
  const dateRange = `${format(signals.startDate, "MMM dd")}–${format(
    new Date(signals.endDate.getTime() - 86_400_000),
    "MMM dd",
  )}`

  return (
    <section
      className="inv-panel ext-strip dock-in dock-in-1"
      aria-label="External signals — week ahead"
    >
      <header className="ext-strip__head">
        <span className="ext-strip__head-label">
          EXT § THIS WEEK · {dateRange} · {scopeLabel}
        </span>
      </header>

      <div className="ext-strip__grid" role="table">
        {/* Day labels */}
        <div role="row" className="ext-strip__row">
          <div /> {/* spacer for the row-label column */}
          {signals.weather.map((w) => {
            const today = isToday(w.date)
            const watch = watchDay === w.date
            return (
              <div
                key={`day-${w.date}`}
                role="columnheader"
                className={[
                  "ext-strip__day",
                  today ? "is-today" : "",
                  watch ? "is-watch" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {format(new Date(`${w.date}T00:00:00.000Z`), "EEE")}
              </div>
            )
          })}
        </div>

        {/* Weather row */}
        <div role="row" className="ext-strip__row">
          <div className="ext-strip__label">Weather</div>
          {signals.weather.map((w) => {
            const lbl = weatherLabel(w.topCode)
            const isEmpty = w.topCode == null
            const sevClass =
              lbl.severity === "accent"
                ? "ext-strip__cell-accent"
                : lbl.severity === "ink"
                  ? "ext-strip__cell-strong"
                  : isEmpty
                    ? "ext-strip__cell--empty"
                    : ""
            return (
              <div
                key={`w-${w.date}`}
                role="cell"
                className={`ext-strip__cell ${sevClass}`}
                title={isEmpty ? "No weather signal" : lbl.full}
              >
                {isEmpty ? "—" : lbl.short}
              </div>
            )
          })}
        </div>

        {/* Events row */}
        <div role="row" className="ext-strip__row">
          <div className="ext-strip__label">Events</div>
          {signals.events.map((e) => {
            const empty = !e.topEventTitle
            if (empty) {
              const totalCats =
                e.categoryCounts.sports +
                e.categoryCounts.concerts +
                e.categoryCounts.festivals +
                e.categoryCounts.performingArts +
                e.categoryCounts.community +
                e.categoryCounts.conferences +
                e.categoryCounts.expos
              return (
                <div
                  key={`e-${e.date}`}
                  role="cell"
                  className="ext-strip__cell ext-strip__cell--empty"
                  title={
                    totalCats > 0
                      ? `${totalCats} event(s) without ranked detail`
                      : "No events"
                  }
                >
                  {totalCats > 0 ? `${totalCats} unranked` : "—"}
                </div>
              )
            }
            const isHighImpact =
              e.topEventLocalRank != null && e.topEventLocalRank >= 80
            const tail = categoryTail(
              e.categoryCounts,
              e.topEventCategory,
              1,
            )
            return (
              <div
                key={`e-${e.date}`}
                role="cell"
                className="ext-strip__cell"
                title={`${e.topEventTitle ?? ""} · ${e.topEventCategory ?? "uncategorised"}`}
              >
                <span
                  className={`ext-strip__cell-title ${
                    isHighImpact
                      ? "ext-strip__cell-accent"
                      : "ext-strip__cell-strong"
                  }`}
                >
                  {e.topEventTitle}
                </span>
                {(e.topEventAttendance != null ||
                  e.topEventLocalRank != null) && (
                  <span className="ext-strip__cell-meta">
                    {e.topEventAttendance != null
                      ? fmtAttendance(e.topEventAttendance)
                      : ""}
                    {e.topEventAttendance != null &&
                    e.topEventLocalRank != null
                      ? " · "
                      : ""}
                    {e.topEventLocalRank != null
                      ? `#${Math.round(e.topEventLocalRank)}`
                      : ""}
                  </span>
                )}
                {tail && <span className="ext-strip__cell-cap">+{tail}</span>}
              </div>
            )
          })}
        </div>

        {/* Labor row */}
        <div role="row" className="ext-strip__row">
          <div className="ext-strip__label">Labor</div>
          {signals.labor.map((l) => (
            <div
              key={`l-${l.date}`}
              role="cell"
              className={`ext-strip__cell ${pressureClass(l.pressure)}`}
              title={
                l.pressure === "missing"
                  ? "No Harri schedule"
                  : `Labor: ${l.pressure}`
              }
            >
              {pressureLabel(l.pressure)}
              {l.understaffedStores > 0 && storeIds.length > 1 && (
                <span className="ext-strip__proofmark">
                  ▲ {l.understaffedStores}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function ExternalSignalsStripFallback() {
  return (
    <section
      className="inv-panel ext-strip dock-in dock-in-1"
      aria-busy="true"
      aria-label="External signals — loading"
    >
      <header className="ext-strip__head">
        <span className="ext-strip__head-label">EXT § THIS WEEK · syncing…</span>
      </header>
      <div className="ext-strip__skel">
        {Array.from({ length: 4 * 8 }).map((_, i) => (
          <div key={i} className="ext-strip__skel-cell" />
        ))}
      </div>
    </section>
  )
}
