/**
 * Harri scheduling — parsing and hour-bucketing for
 * GET /scheduling/api/v1/brands/{brandId}/schedule?week=%b %d, %Y
 *
 * This is the only intra-day labor signal in the integration; the labor-stats
 * endpoints are all daily-grain. See docs/harri-api-notes.md §8.
 *
 * Times arrive as local wall-clock strings ("Aug 10, 2026 09:00") with no zone.
 * We keep them as local-encoded-UTC so `getUTCHours()` returns the posted clock
 * hour — the same convention OtterHourlySummary buckets on, which is what lets
 * the two join without timezone math.
 *
 * Pure functions only, so the shapes can be tested without a gateway or a DB.
 */

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

export interface HarriShiftRow {
  harriShiftId: number
  date: Date
  weekStart: Date
  startTime: Date
  endTime: Date
  minutes: number
  userId: number | null
  isVirtual: boolean
  positionCode: string
  positionName: string | null
  categoryCode: string | null
  categoryName: string | null
  status: string | null
}

/** Raw response shapes — only the fields we consume. */
export interface HarriScheduleResponse {
  schedule: Array<{
    id: number
    start_date: string
    status?: string | null
    roles: Array<{
      position: {
        code: string
        name?: string | null
        category?: { code?: string | null; name?: string | null } | null
      }
      role_days: Array<{
        date: string
        assignees: Array<{
          user_id: number | null
          type?: string | null
          assignee_shifts?: Array<{
            id: number
            start_time: string
            end_time: string
            status?: string | null
          }> | null
        }>
      }>
    }>
  }>
}

/**
 * Parse "%b %d, %Y %H:%M" (or the date-only "%b %d, %Y") into a Date whose UTC
 * fields hold the LOCAL wall-clock. Returns null rather than an Invalid Date so
 * a format change upstream surfaces as dropped rows, not NaN timestamps.
 */
export function parseHarriDateTime(value: string): Date | null {
  const m = /^([A-Za-z]{3}) (\d{1,2}), (\d{4})(?: (\d{2}):(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  const month = MONTHS.indexOf(m[1])
  if (month < 0) return null
  const day = Number(m[2])
  if (day < 1 || day > 31) return null
  return new Date(
    Date.UTC(Number(m[3]), month, day, m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0)
  )
}

/** Format a Date as the "%b %d, %Y" the scheduling endpoint requires. */
export function formatHarriWeekParam(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${MONTHS[d.getUTCMonth()]} ${day}, ${d.getUTCFullYear()}`
}

/** UTC midnight of the day a timestamp falls on. */
function dayOf(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * Flatten the nested schedule → role → role_day → assignee → shift tree into
 * flat rows. `VIRTUAL` assignees are unfilled slots the manager left on the
 * grid; they carry no assignee_shifts and must never count as staffed labor.
 */
export function flattenSchedule(
  response: HarriScheduleResponse,
  weekStart: Date
): HarriShiftRow[] {
  const out: HarriShiftRow[] = []

  for (const schedule of response.schedule ?? []) {
    for (const role of schedule.roles ?? []) {
      const position = role.position
      for (const roleDay of role.role_days ?? []) {
        for (const assignee of roleDay.assignees ?? []) {
          for (const shift of assignee.assignee_shifts ?? []) {
            const startTime = parseHarriDateTime(shift.start_time)
            const endTime = parseHarriDateTime(shift.end_time)
            if (!startTime || !endTime || endTime <= startTime) continue

            out.push({
              harriShiftId: shift.id,
              // Dated by START day — an 18:00→01:00 shift belongs to the day
              // it opened on, which is how an operator reads the schedule.
              date: dayOf(startTime),
              weekStart,
              startTime,
              endTime,
              minutes: Math.round((endTime.getTime() - startTime.getTime()) / 60000),
              userId: assignee.user_id ?? null,
              isVirtual: (assignee.type ?? "").toUpperCase() === "VIRTUAL",
              positionCode: position.code,
              positionName: position.name ?? null,
              categoryCode: position.category?.code ?? null,
              categoryName: position.category?.name ?? null,
              status: shift.status ?? null,
            })
          }
        }
      }
    }
  }

  return out
}

/**
 * Spread shifts into per-hour headcount-hours, keyed by "YYYY-MM-DD" and
 * indexed 0–23. A shift that runs past midnight credits the next day's early
 * hours, which is how a late-night store's 1am staffing shows up at all.
 *
 * The unit is headcount-hours: two people covering 09:00–10:00 gives 2.
 */
export function bucketShiftHours(
  shifts: Array<{ startTime: Date; endTime: Date }>
): Map<string, number[]> {
  const buckets = new Map<string, number[]>()

  for (const shift of shifts) {
    let cursor = shift.startTime.getTime()
    const end = shift.endTime.getTime()

    while (cursor < end) {
      const at = new Date(cursor)
      const key = at.toISOString().slice(0, 10)
      const hour = at.getUTCHours()

      // End of this clock hour, or the shift's end — whichever comes first.
      const hourEnd = Date.UTC(
        at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), hour + 1
      )
      const sliceEnd = Math.min(hourEnd, end)

      if (!buckets.has(key)) buckets.set(key, new Array(24).fill(0))
      buckets.get(key)![hour] += (sliceEnd - cursor) / 3_600_000

      cursor = sliceEnd
    }
  }

  return buckets
}
