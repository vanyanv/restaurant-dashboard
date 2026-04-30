import type { Granularity } from "@/lib/pnl"
import {
  MAX_CUSTOM_RANGE_DAYS,
  rangeDayCount,
} from "@/lib/mobile/period"
import { startOfDayLA, endOfDayLA } from "@/lib/dashboard-utils"
import {
  PNL_PRESETS,
  type PnLRangeState,
} from "@/components/pnl/pnl-date-presets"

export type MobilePnLNamedPeriod =
  | "this-week"
  | "last-week"
  | "this-month"
  | "last-month"
  | "last-8-weeks"

export type MobilePnLPeriod = MobilePnLNamedPeriod | "custom"

export const MOBILE_PNL_PERIODS: Array<{
  value: MobilePnLNamedPeriod
  label: string
  short: string
  /** Maps to a key in PNL_PRESETS so we don't duplicate range math. */
  presetKey: string
}> = [
  { value: "this-week", label: "This week", short: "WK", presetKey: "thisWeek" },
  { value: "last-week", label: "Last week", short: "LAST WK", presetKey: "lastWeek" },
  { value: "this-month", label: "This month", short: "MO", presetKey: "thisMonth" },
  { value: "last-month", label: "Last month", short: "LAST MO", presetKey: "lastMonth" },
  { value: "last-8-weeks", label: "Last 8 weeks", short: "8 WKS", presetKey: "last8Weeks" },
]

const NAMED_VALUES = new Set<MobilePnLNamedPeriod>(MOBILE_PNL_PERIODS.map((p) => p.value))
const VALID_GRAINS = new Set<Granularity>(["daily", "weekly", "monthly"])

/** Default P&L view when no params are present (preserves existing behavior). */
export const DEFAULT_PNL_PERIOD: MobilePnLNamedPeriod = "last-8-weeks"

export type MobilePnLRange =
  | { kind: "named"; period: MobilePnLNamedPeriod }
  | {
      kind: "custom"
      start: Date
      end: Date
      startStr: string
      endStr: string
      grain: Granularity
      /** True if `grain` was derived from range length (not user-chosen). */
      grainAuto: boolean
    }

function isValidIsoDate(s: string | undefined): s is string {
  if (!s) return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const d = new Date(Date.UTC(year, month - 1, day))
  return (
    !Number.isNaN(d.getTime()) &&
    d.getUTCFullYear() === year &&
    d.getUTCMonth() + 1 === month &&
    d.getUTCDate() === day
  )
}

/**
 * Auto-pick granularity from range length:
 * - ≤14 days → daily
 * - ≤70 days (10 weeks) → weekly
 * - else monthly
 */
export function autoGrain(start: Date, end: Date): Granularity {
  const days = rangeDayCount(start, end)
  if (days <= 14) return "daily"
  if (days <= 70) return "weekly"
  return "monthly"
}

export function parsePnLRange(sp: {
  period?: string
  start?: string
  end?: string
  grain?: string
}): MobilePnLRange {
  const raw = sp.period
  if (raw === "custom") {
    const custom = parsePnLCustom(sp.start, sp.end, sp.grain)
    if (custom) return custom
    return { kind: "named", period: DEFAULT_PNL_PERIOD }
  }
  if (raw && NAMED_VALUES.has(raw as MobilePnLNamedPeriod)) {
    return { kind: "named", period: raw as MobilePnLNamedPeriod }
  }
  return { kind: "named", period: DEFAULT_PNL_PERIOD }
}

function parsePnLCustom(
  startStr: string | undefined,
  endStr: string | undefined,
  grainStr: string | undefined,
): Extract<MobilePnLRange, { kind: "custom" }> | null {
  if (!isValidIsoDate(startStr) || !isValidIsoDate(endStr)) return null
  const start = startOfDayLA(startStr)
  const end = endOfDayLA(endStr)
  if (end.getTime() < start.getTime()) return null
  if (rangeDayCount(start, end) > MAX_CUSTOM_RANGE_DAYS) return null

  const auto = autoGrain(start, end)
  let grain: Granularity = auto
  let grainAuto = true
  if (grainStr && VALID_GRAINS.has(grainStr as Granularity)) {
    grain = grainStr as Granularity
    grainAuto = grainStr === auto
  }
  return { kind: "custom", start, end, startStr, endStr, grain, grainAuto }
}

/** Resolve a P&L range (named or custom) into the existing `PnLRangeState`
 *  shape that `getStorePnL` / `getAllStoresPnL` accept. */
export function pnlRangeToState(range: MobilePnLRange): PnLRangeState {
  if (range.kind === "custom") {
    return {
      startDate: range.start,
      endDate: range.end,
      granularity: range.grain,
      preset: undefined,
    }
  }
  const meta = MOBILE_PNL_PERIODS.find((p) => p.value === range.period)!
  const preset = PNL_PRESETS.find((p) => p.key === meta.presetKey)
  if (!preset) {
    throw new Error(`pnlRangeToState: no PNL_PRESETS entry for key "${meta.presetKey}"`)
  }
  return preset.compute()
}
