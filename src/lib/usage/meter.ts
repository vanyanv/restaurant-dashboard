/**
 * Usage counts, held in memory per server instance.
 *
 * Nothing here talks to Redis or the database: `count()` is a map write, so it
 * is safe on every request. `flush.ts` empties the map at most once every five
 * minutes. Design: docs/superpowers/specs/2026-11-27-usage-monitoring-design.md.
 *
 * Nothing exported from this file may throw. A failure in counting must never
 * fail or slow a request.
 */
import { randomBytes } from "node:crypto"
import { trace } from "@opentelemetry/api"
import type { UsageSource } from "./source"

/** `all` is for a figure that belongs to the instance, not a request (CPU). */
export type MeterSource = UsageSource | "all"

/** `hour` is an ISO time at the start of a UTC hour. */
export type PendingRow = [hour: string, source: MeterSource, metric: string, value: number]
export type FlushPayload = { v: 1; instance: string; rows: PendingRow[] }

const HOUR_MS = 3_600_000
const MAX_KEYS = 2_000
const MAX_TRACES = 5_000

const instance = randomBytes(4).toString("hex")
let counts = new Map<string, number>()
let oldest = 0
let lastCpu = process.cpuUsage()
const traces = new Map<string, UsageSource>()
let defaultSource: UsageSource = "other"

export function count(source: MeterSource, metric: string, value = 1, at?: Date): void {
  try {
    if (!Number.isFinite(value) || value <= 0) return
    const hour = Math.floor((at ? at.getTime() : Date.now()) / HOUR_MS) * HOUR_MS
    let key = `${hour}|${source}|${metric}`
    // A guard against a metric name that grows without bound (a host, an id).
    if (!counts.has(key) && counts.size >= MAX_KEYS) key = `${hour}|other|${metric}`
    counts.set(key, (counts.get(key) ?? 0) + value)
    if (oldest === 0) oldest = Date.now()
  } catch {
    // Never throws.
  }
}

export function bindTrace(traceId: string, source: UsageSource): void {
  if (traces.size >= MAX_TRACES) {
    // A request whose span never ended. Maps iterate oldest first.
    const first = traces.keys().next()
    if (!first.done) traces.delete(first.value)
  }
  traces.set(traceId, source)
}

export function unbindTrace(traceId: string): void {
  traces.delete(traceId)
}

export function sourceOfTrace(traceId: string): UsageSource | undefined {
  return traces.get(traceId)
}

/** For a process that is one source throughout: a script is `sync`. */
export function setDefaultSource(source: UsageSource): void {
  defaultSource = source
}

/** The source of the request this code is running in, else the default. */
export function currentSource(): UsageSource {
  try {
    const traceId = trace.getActiveSpan()?.spanContext().traceId
    return (traceId && traces.get(traceId)) || defaultSource
  } catch {
    return defaultSource
  }
}

/** How long the oldest unflushed count has waited. 0 when there is none. */
export function oldestAgeMs(now = Date.now()): number {
  return oldest === 0 ? 0 : Math.max(0, now - oldest)
}

/**
 * Empties the map. Adds the CPU this process used since the last take, as one
 * row under `all`: Vercel does not report Active CPU on this plan, so this is
 * the app's own measure of it.
 */
export function takePending(): FlushPayload | null {
  try {
    if (counts.size === 0) return null
    const taken = counts
    counts = new Map()
    oldest = 0
    const rows: PendingRow[] = []
    for (const [key, value] of taken) {
      const [hour, source, ...metric] = key.split("|")
      rows.push([new Date(Number(hour)).toISOString(), source as MeterSource, metric.join("|"), value])
    }
    const cpu = process.cpuUsage()
    const cpuMs = (cpu.user - lastCpu.user + cpu.system - lastCpu.system) / 1000
    lastCpu = cpu
    const nowHour = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS).toISOString()
    rows.push([nowHour, "all", "cpuMs", Math.max(0, Math.round(cpuMs * 10) / 10)])
    return { v: 1, instance, rows }
  } catch {
    return null
  }
}

export function resetMeterForTest(): void {
  counts = new Map()
  oldest = 0
  lastCpu = process.cpuUsage()
  traces.clear()
  defaultSource = "other"
}
