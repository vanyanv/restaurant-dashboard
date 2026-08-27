import type { AlertSeverity, AlertSource } from "@/generated/prisma/client"

/**
 * The alert inbox's two filter axes, declared once.
 *
 * The same shape and the same reason as `channels.ts`: the URL reader
 * (`url-state.ts`), the adapter and the page client all need to agree on which
 * ids exist and what each one is called, and a second copy of that list is how
 * a toggle comes to write a value nothing reads back.
 *
 * This module is PURE — constants and two guards, no Prisma, no React — so a
 * client component and a server adapter can both import it. The two Prisma
 * enums are imported as TYPES only, which erases at compile time.
 *
 * ## Why all five sources are listed when only one of them has ever fired
 *
 * Measured on the live database 2026-08-26: `Alert` holds 87 rows and every
 * one of them is `ANOMALY_EVENT`. `PRICE_DELTA`, `HARRI_VARIANCE`,
 * `QUANTITY_SPIKE` and `NEW_PRODUCT` have zero rows each.
 *
 * Ruling N-R1: the page renders all five anyway, each carrying its LIVE count,
 * and a zero-count toggle is rendered disabled. Five is what the schema stores
 * and five is what the prototype draws; a filter row that silently showed one
 * toggle would tell a reader this product has one kind of alert, which is a
 * claim about the SYSTEM rather than about today's rows. A toggle that reads
 * `Price moves 0` says the true thing — the source exists and has raised
 * nothing — and a toggle that filters to nothing without saying so is worse
 * than either.
 */

export interface AlertFilterOption<Id extends string> {
  id: Id
  label: string
  /**
   * A `ct-` custom-property NAME, e.g. `"--bad"` — never a colour literal, and
   * never wrapped in `var()` here. `Filters` is what wraps it. Sources carry
   * no tint: the prototype's source row draws bare word toggles, because the
   * severity row above it already owns the colour on this page.
   */
  tint?: string
}

/**
 * Severity, in the prototype's own order (`P.alerts.desk`, line 4778) —
 * critical first, because that is the order a reader triages in, not the order
 * the Prisma enum happens to declare (`INFO, WATCH, CRITICAL`).
 *
 * The tints are the prototype's three: `--bad`, `--signal`, `--ink-3`.
 */
export const ALERT_SEVERITIES: readonly AlertFilterOption<AlertSeverity>[] = [
  { id: "CRITICAL", label: "Critical", tint: "--bad" },
  { id: "WATCH", label: "Watch", tint: "--signal" },
  { id: "INFO", label: "Info", tint: "--ink-3" },
] as const

/** The five sources, with the prototype's own labels (line 4790). */
export const ALERT_SOURCES: readonly AlertFilterOption<AlertSource>[] = [
  { id: "ANOMALY_EVENT", label: "Anomalies" },
  { id: "PRICE_DELTA", label: "Price moves" },
  { id: "HARRI_VARIANCE", label: "Labor variance" },
  { id: "QUANTITY_SPIKE", label: "Quantity spikes" },
  { id: "NEW_PRODUCT", label: "New products" },
] as const

/**
 * `P.alerts.seg` — `['Open','All','Muted']`, lower-cased into ids because the
 * segment travels in the query string.
 */
export type AlertSegment = "open" | "all" | "muted"

export const ALERT_SEGMENTS: readonly { id: AlertSegment; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "all", label: "All" },
  { id: "muted", label: "Muted" },
] as const

export const DEFAULT_ALERT_SEGMENT: AlertSegment = "open"

export const isAlertSeverity = (v: string): v is AlertSeverity =>
  ALERT_SEVERITIES.some((s) => s.id === v)

export const isAlertSource = (v: string): v is AlertSource =>
  ALERT_SOURCES.some((s) => s.id === v)

export const isAlertSegment = (v: string): v is AlertSegment =>
  ALERT_SEGMENTS.some((s) => s.id === v)

export const alertSourceLabel = (id: AlertSource): string =>
  ALERT_SOURCES.find((s) => s.id === id)?.label ?? id
