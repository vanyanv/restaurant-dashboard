import { z } from "zod"
import { dateRangeSchema, parseDateRange, resolveStoreIds, ymd } from "./_shared"
import type { ChatTool } from "./types"

/**
 * Weather and nearby events per store and day — the same rows the forecasts
 * already train on (`StoreWeatherSignal` from Open-Meteo, hourly, including
 * about two weeks ahead; `StoreEventSignal` / `StoreEventDetailSignal` from
 * PredictHQ). Before this the chat had to call a weather question out of
 * scope while the forecast pipeline was reading the answer every night.
 *
 * Every day says whether a reading exists. A day with no row is "no data",
 * never "clear and 0 events": the event feed in particular has stopped before
 * (its last day is returned as `eventsSyncedThrough`).
 */

const params = z
  .object({
    storeIds: z
      .array(z.string().min(1))
      .optional()
      .describe("Restrict to these store ids from listStores. Omit for every store."),
    dateRange: dateRangeSchema.describe(
      "Inclusive YYYY-MM-DD days, up to 31. Weather includes about 14 days of forecast ahead of today.",
    ),
  })
  .strict()

const round1 = (n: number) => Math.round(n * 10) / 10
const toF = (c: number) => round1((c * 9) / 5 + 32)

/** WMO weather interpretation codes, as Open-Meteo reports them. */
export function weatherLabel(code: number | null | undefined): string | null {
  if (code == null) return null
  if (code === 0) return "Clear"
  if (code <= 2) return "Partly cloudy"
  if (code === 3) return "Overcast"
  if (code === 45 || code === 48) return "Fog"
  if (code >= 51 && code <= 57) return "Drizzle"
  if (code >= 61 && code <= 67) return "Rain"
  if (code >= 71 && code <= 77) return "Snow"
  if (code >= 80 && code <= 82) return "Rain showers"
  if (code === 85 || code === 86) return "Snow showers"
  if (code >= 95) return "Thunderstorm"
  return null
}

/** Worse weather wins the day's label: a thunderstorm at 6 pm is the story, not the clear morning. */
function severity(code: number | null): number {
  if (code == null) return -1
  if (code >= 95) return 9
  if (code >= 61 && code <= 67) return 7
  if (code >= 80 && code <= 82) return 6
  if (code >= 71) return 8
  if (code >= 51) return 5
  if (code === 45 || code === 48) return 4
  return code
}

export type WeatherEventsResult = {
  from: string
  to: string
  stores: Array<{
    storeId: string
    storeName: string
    weatherSyncedThrough: string | null
    eventsSyncedThrough: string | null
    days: Array<{
      date: string
      /** Null when there is no weather reading for the day. Store opening hours, 10 am to 10 pm LA, drive highF/lowF/label. */
      weather: {
        highF: number | null
        lowF: number | null
        rainInches: number
        maxRainChancePct: number | null
        label: string | null
        windMphMax: number | null
      } | null
      /** Null when the event feed has no row for the day. */
      events: {
        count: number
        majorCount: number
        attendance: number | null
        byKind: { sports: number; concerts: number; festivals: number; performingArts: number; community: number; conferences: number; expos: number }
        top: Array<{ title: string; category: string | null; startsAt: string | null; attendance: number | null; distanceMiles: number | null; venue: string | null }>
      } | null
    }>
  }>
}

export const getWeatherAndEvents: ChatTool<typeof params, WeatherEventsResult> = {
  name: "getWeatherAndEvents",
  description:
    "Weather and nearby events by store and day: high/low °F, rain in inches and chance of rain, conditions (clear, rain, fog…), wind, plus local events (count, big events, expected attendance, sports/concerts/festivals, the top events with venue and distance). Weather covers past days and about 14 days ahead. Use for 'what's the weather this weekend', 'was it raining on Saturday', 'was there a game / concert near Hollywood', or to explain a slow or busy day.",
  parameters: params,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const { from, to } = parseDateRange(args.dateRange)
    if ((to.getTime() - from.getTime()) / 86_400_000 > 30) {
      throw new Error("dateRange is limited to 31 days for weather and events")
    }
    const scope = { storeId: { in: storeIds }, store: { accountId: ctx.accountId } }
    const window = { gte: from, lte: to }

    const [stores, weather, events, details, wMax, eMax] = await Promise.all([
      ctx.prisma.store.findMany({
        where: { id: { in: storeIds }, accountId: ctx.accountId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      ctx.prisma.storeWeatherSignal.findMany({
        where: { ...scope, date: window },
        select: {
          storeId: true, date: true, hour: true, temperatureC: true, precipitationMm: true,
          precipitationProbabilityPct: true, windSpeedKph: true, weatherCode: true,
        },
      }),
      ctx.prisma.storeEventSignal.findMany({
        where: { ...scope, date: window },
        select: {
          storeId: true, date: true, eventCount: true, majorEventCount: true, attendance: true,
          sportsCount: true, concertsCount: true, festivalsCount: true, performingArtsCount: true,
          communityCount: true, conferencesCount: true, exposCount: true,
        },
      }),
      ctx.prisma.storeEventDetailSignal.findMany({
        where: { ...scope, date: window },
        select: {
          storeId: true, date: true, title: true, category: true, startsAt: true,
          attendance: true, distanceMiles: true, venueName: true, localRank: true,
        },
        orderBy: [{ localRank: { sort: "desc", nulls: "last" } }],
      }),
      ctx.prisma.storeWeatherSignal.groupBy({ by: ["storeId"], where: scope, _max: { date: true } }),
      ctx.prisma.storeEventSignal.groupBy({ by: ["storeId"], where: scope, _max: { date: true } }),
    ])

    const dayKeys: string[] = []
    for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) dayKeys.push(ymd(new Date(t)))
    const maxOf = (rows: Array<{ storeId: string; _max: { date: Date | null } }>, id: string) => {
      const d = rows.find((r) => r.storeId === id)?._max.date
      return d ? ymd(d) : null
    }

    return {
      from: ymd(from),
      to: ymd(to),
      stores: stores.map((s) => ({
        storeId: s.id,
        storeName: s.name,
        weatherSyncedThrough: maxOf(wMax, s.id),
        eventsSyncedThrough: maxOf(eMax, s.id),
        days: dayKeys.map((day) => {
          const hours = weather.filter((w) => w.storeId === s.id && ymd(w.date) === day)
          const open = hours.filter((h) => h.hour >= 10 && h.hour <= 22)
          const basis = open.length > 0 ? open : hours
          const temps = basis.map((h) => h.temperatureC).filter((t): t is number => t != null)
          const chances = hours.map((h) => h.precipitationProbabilityPct).filter((p): p is number => p != null)
          const winds = hours.map((h) => h.windSpeedKph).filter((w): w is number => w != null)
          const worst = basis.reduce<number | null>(
            (acc, h) => (severity(h.weatherCode) > severity(acc) ? h.weatherCode : acc),
            null,
          )
          const ev = events.find((e) => e.storeId === s.id && ymd(e.date) === day)
          return {
            date: day,
            weather:
              hours.length === 0
                ? null
                : {
                    highF: temps.length ? toF(Math.max(...temps)) : null,
                    lowF: temps.length ? toF(Math.min(...temps)) : null,
                    rainInches: Math.round((hours.reduce((t, h) => t + (h.precipitationMm ?? 0), 0) / 25.4) * 100) / 100,
                    maxRainChancePct: chances.length ? Math.round(Math.max(...chances)) : null,
                    label: weatherLabel(worst),
                    windMphMax: winds.length ? round1(Math.max(...winds) * 0.621371) : null,
                  },
            events: ev
              ? {
                  count: ev.eventCount,
                  majorCount: ev.majorEventCount,
                  attendance: ev.attendance == null ? null : Math.round(ev.attendance),
                  byKind: {
                    sports: ev.sportsCount,
                    concerts: ev.concertsCount,
                    festivals: ev.festivalsCount,
                    performingArts: ev.performingArtsCount,
                    community: ev.communityCount,
                    conferences: ev.conferencesCount,
                    expos: ev.exposCount,
                  },
                  top: details
                    .filter((d) => d.storeId === s.id && ymd(d.date) === day && d.title)
                    .slice(0, 3)
                    .map((d) => ({
                      title: d.title!,
                      category: d.category,
                      startsAt: d.startsAt
                        ? d.startsAt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })
                        : null,
                      attendance: d.attendance == null ? null : Math.round(d.attendance),
                      distanceMiles: d.distanceMiles == null ? null : round1(d.distanceMiles),
                      venue: d.venueName,
                    })),
                }
              : null,
          }
        }),
      })),
    }
  },
}
