import { getRevenueForecast } from "@/app/actions/forecasts/revenue-forecast-actions"
import { getStores } from "@/app/actions/store/crud-actions"
import { getExternalSignals } from "@/lib/external-signals"
import { buildWaterfall, readInterval } from "@/lib/dashboard/model-call"
import { localDateStr, type DashboardRange } from "@/lib/dashboard-utils"
import { cn } from "@/lib/utils"
import { formatMoneyLarge } from "../hero-kpi"
import { ModelCallChart } from "../model-call-chart"
import type { OtterPromise } from "./data"

/**
 * "The model's call" — what today should have been, and why the model thought
 * so. Reads the row the nightly pipeline already writes; the dashboard never
 * calls a model itself.
 *
 * Only rendered for a single day. Across a multi-day range "the forecast" is a
 * sum of intervals, which is not an interval, and drawing one would imply a
 * precision the pipeline never claimed.
 */
export async function ModelCallSection({
  range,
  otterPromise,
}: {
  range: DashboardRange
  otterPromise: OtterPromise
}) {
  const isSingleDay =
    range.kind === "days"
      ? range.days === 1 || range.days === -1
      : range.startDate === range.endDate

  if (!isSingleDay) return null

  const [forecast, otter, stores] = await Promise.all([
    getRevenueForecast({ horizonDays: 1 }).catch(() => null),
    otterPromise,
    getStores().catch(() => []),
  ])

  if (!forecast || !forecast.ok || forecast.data.days.length === 0) return null

  // The action returns a horizon starting today, so a past range has no row in
  // it. Match on the range's own date and render NOTHING when there is no
  // match — falling back to days[0] put today's $6,879 call above January's
  // actuals and captioned it "gross so far", which is simply a different day's
  // number presented as this one's.
  const wanted =
    range.kind === "custom" ? range.startDate : localDateStr(new Date())
  // `forecastDate` is a @db.Date column: the pipeline writes the store's
  // CALENDAR day at midnight UTC. Reading it back through a local conversion
  // turns midnight UTC into 5pm the previous day in Los Angeles, so today's row
  // matched yesterday's date and the whole band disappeared. Compare on the UTC
  // fields, the same way the value was written.
  const day = forecast.data.days.find(
    (d) => d.date.toISOString().slice(0, 10) === wanted
  )
  if (!day) return null

  const actual = otter?.kpis.grossRevenue ?? null
  const interval =
    actual != null
      ? readInterval({
          p10: day.p10,
          p90: day.p90,
          forecast: day.predictedRevenue,
          actual,
        })
      : null

  const waterfall = day.attribution ? buildWaterfall(day.attribution) : null

  // One sentence of what was happening outside the restaurant. The events feed
  // explains a soft day better than the waterfall above it does, and both
  // signals are precomputed — no provider call on a request path.
  // `getExternalSignals` reports forward from today, so the line is only true
  // on a today range. Yesterday and back get no context rather than today's.
  const isTodayRange = range.kind === "days" && range.days === 1
  const context = isTodayRange
    ? await buildContextLine(stores.map((s) => s.id))
    : null

  return (
    <div className="dock-in dock-in-6">
      <div className="mb-0 flex flex-wrap items-center gap-3 border-b border-[var(--hairline)] pb-3">
        <span className="editorial-section-label">The model&apos;s call</span>
        <div className="h-px flex-1 border-t border-dotted border-[var(--hairline-bold)]" />
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-(--ink-faint)">
          {day.modelVersion} · {day.forecastSource}
          {forecast.data.recentMape != null
            ? ` · mape ${(forecast.data.recentMape * 100).toFixed(1)}%`
            : ""}
        </span>
      </div>

      <div className="model-call">
        <div>
          <div className="model-call__label">Forecast for this day</div>
          <div className="model-call__value">
            {formatMoneyLarge(day.predictedRevenue)}
          </div>

          {interval && (
            <div className="model-call__track" aria-hidden="true">
              <div className="model-call__track-rail" />
              <div
                className="model-call__track-forecast"
                style={{ left: `${interval.forecastPct * 100}%` }}
              />
              <div
                className={cn(
                  "model-call__track-mark",
                  !interval.inside && "is-outside"
                )}
                style={{ left: `${interval.markPct * 100}%` }}
              />
            </div>
          )}

          {day.p10 != null && day.p90 != null && (
            <div className="model-call__caption">
              p10 {formatMoneyLarge(day.p10)} — p90 {formatMoneyLarge(day.p90)}
              {actual != null ? ` · gross so far ${formatMoneyLarge(actual)}` : ""}
            </div>
          )}

          {interval && actual != null && (
            <div className="model-call__caption">
              {interval.inside
                ? "Inside the interval."
                : actual > day.predictedRevenue
                  ? "Above the interval — the day beat the call."
                  : "Below the interval — the day came in short."}
            </div>
          )}
        </div>

        <div>
          <div className="model-call__label">Why the model expected that</div>
          {waterfall ? (
            <>
              <ModelCallChart waterfall={waterfall} format={formatMoneyLarge} />
              {/* Reconciliation rewrites the point forecast but not the SHAP
                  payload, so on a reconciled day the columns foot to a
                  different number than the headline. Say it rather than
                  leaving two totals on screen contradicting each other. */}
              {Math.abs(waterfall.total - day.predictedRevenue) > 1 && (
                <div className="model-call__caption">
                  Columns foot to {formatMoneyLarge(waterfall.total)} — the
                  pre-reconciliation call. The headline is the reconciled figure.
                </div>
              )}
            </>
          ) : (
            <p className="model-call__none">
              No attribution on this forecast. The booster records one only when
              it can decompose the prediction; rows written before 19 August 2026
              never carried it.
            </p>
          )}
        </div>
      </div>

      {context && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-(--hairline) pt-3">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-(--ink-faint)">
            Context
          </span>
          <span className="text-[13px] leading-[1.5]">{context}</span>
        </div>
      )}
    </div>
  )
}

/**
 * "Two major events within five miles, the largest a 48,000-seat fixture."
 *
 * Built from `StoreEventSignal` only. `StoreWeatherSignal` stores a WMO code
 * but no temperature, so a "94°F and clear" line — which the concept showed —
 * cannot be written truthfully from what is banked today; the condition alone
 * adds little, so it is left out rather than padded.
 */
async function buildContextLine(storeIds: string[]): Promise<string | null> {
  if (storeIds.length === 0) return null
  try {
    const signals = await getExternalSignals(storeIds, { horizonDays: 1 })
    const today = signals.events[0]
    if (!today) return null

    const counts = today.categoryCounts
    const total = Object.values(counts).reduce((a, b) => a + b, 0)

    if (total === 0) return "No events of any size near the store today."

    const title = today.topEventTitle
    const attendance = today.topEventAttendance
    const head = `${total} event${total === 1 ? "" : "s"} near the store today`
    if (!title) return `${head}.`
    return attendance && attendance > 0
      ? `${head}, the largest ${title} at about ${Math.round(attendance).toLocaleString()} people.`
      : `${head}, the largest ${title}.`
  } catch {
    // A dead signal feed must not take the forecast band down with it.
    return null
  }
}
