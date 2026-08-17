/**
 * How far back an OPEN anomaly stays worth surfacing.
 *
 * Nothing ever closed an anomaly, so the Decisions briefing accumulated them
 * indefinitely — it read "50 open anomalies — revenue dropped Fri, May 22, plus
 * 49 more" on 17 August. A three-month-old revenue dip is not open, it is
 * unresolved forever, and fifty of them is alert fatigue by definition.
 *
 * Anomalies older than this are excluded on read and swept to EXPIRED by the
 * retention cron, so the feed only ever shows things still worth acting on.
 */
export const ANOMALY_RELEVANCE_DAYS = 30

export function anomalyHorizon(now: Date = new Date()): Date {
  const d = new Date(now)
  d.setUTCDate(d.getUTCDate() - ANOMALY_RELEVANCE_DAYS)
  d.setUTCHours(0, 0, 0, 0)
  return d
}
