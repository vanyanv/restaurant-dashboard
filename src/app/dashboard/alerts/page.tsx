import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getAlertInbox } from "@/app/actions/alerts/inbox-actions"
import { ANOMALY_RELEVANCE_DAYS } from "@/lib/anomaly-window"
import type { AlertSeverity, AlertSource } from "@/generated/prisma/client"
import { EditorialTopbar } from "../components/editorial-topbar"
import { AlertRow } from "./components/alert-row"

/**
 * § 15 — the alert inbox.
 *
 * The `Alert` table has been written on a schedule since F21 with no UI at
 * all. This is the surface it was built for, and the destination for the two
 * places that were doing alerting badly: Product Usage's fifty-row list of
 * first-time purchases, and the Decisions briefing's unbounded open-anomaly
 * count.
 */

const SEVERITIES: AlertSeverity[] = ["CRITICAL", "WATCH", "INFO"]
const SOURCES: AlertSource[] = [
  "ANOMALY_EVENT",
  "PRICE_DELTA",
  "HARRI_VARIANCE",
  "QUANTITY_SPIKE",
  "NEW_PRODUCT",
]

const SOURCE_LABEL: Record<AlertSource, string> = {
  ANOMALY_EVENT: "Anomalies",
  PRICE_DELTA: "Price moves",
  HARRI_VARIANCE: "Labor variance",
  QUANTITY_SPIKE: "Quantity spikes",
  NEW_PRODUCT: "New products",
}

function isSeverity(v: string | undefined): v is AlertSeverity {
  return !!v && (SEVERITIES as string[]).includes(v)
}
function isSource(v: string | undefined): v is AlertSource {
  return !!v && (SOURCES as string[]).includes(v)
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{
    store?: string
    severity?: string
    source?: string
    resolved?: string
  }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard")

  const sp = await searchParams
  const includeResolved = sp.resolved === "1"
  const result = await getAlertInbox({
    storeId: sp.store ?? null,
    severity: isSeverity(sp.severity) ? sp.severity : null,
    source: isSource(sp.source) ? sp.source : null,
    includeResolved,
  })

  if (!result.ok) redirect("/dashboard")
  const { alerts, counts, stores } = result.data

  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams()
    const merged = {
      store: sp.store,
      severity: sp.severity,
      source: sp.source,
      resolved: sp.resolved,
      ...patch,
    }
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v)
    const s = next.toString()
    return s ? `/dashboard/alerts?${s}` : "/dashboard/alerts"
  }

  return (
    <div className="flex h-full flex-col">
      <EditorialTopbar
        section="§ 15"
        title="Alerts"
        stamps={
          <span>
            {counts.open} open · last {ANOMALY_RELEVANCE_DAYS} days
          </span>
        }
      />

      <div className="flex-1 overflow-auto px-4 pb-8 pt-4 sm:px-6 sm:pt-5">
        <div className="mx-auto flex max-w-350 flex-col gap-4">
          <section className="inv-panel inv-panel--flush">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
              <Filter
                label="All"
                href={qs({ severity: undefined })}
                active={!isSeverity(sp.severity)}
                count={counts.open}
              />
              <Filter
                label="Critical"
                href={qs({ severity: "CRITICAL" })}
                active={sp.severity === "CRITICAL"}
                count={counts.critical}
                tone="var(--accent)"
              />
              <Filter
                label="Watch"
                href={qs({ severity: "WATCH" })}
                active={sp.severity === "WATCH"}
                count={counts.watch}
                tone="var(--subtract)"
              />
              <Filter
                label="Note"
                href={qs({ severity: "INFO" })}
                active={sp.severity === "INFO"}
                count={counts.info}
              />

              <span className="ml-auto flex flex-wrap items-center gap-2">
                {stores.length > 1 ? (
                  <Link
                    href={qs({ store: undefined })}
                    className="toolbar-btn"
                    aria-current={!sp.store ? "true" : undefined}
                  >
                    All stores
                  </Link>
                ) : null}
                {stores.length > 1
                  ? stores.map((s) => (
                      <Link
                        key={s.id}
                        href={qs({ store: s.id })}
                        className="toolbar-btn"
                        aria-current={sp.store === s.id ? "true" : undefined}
                      >
                        {s.name}
                      </Link>
                    ))
                  : null}
                <Link
                  href={qs({ resolved: includeResolved ? undefined : "1" })}
                  className="toolbar-btn"
                  aria-pressed={includeResolved}
                >
                  {includeResolved ? "Open only" : "Show resolved"}
                </Link>
              </span>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-(--hairline) px-5 py-3">
              <Link
                href={qs({ source: undefined })}
                className="toolbar-btn"
                aria-current={!isSource(sp.source) ? "true" : undefined}
              >
                Every source
              </Link>
              {SOURCES.map((s) => (
                <Link
                  key={s}
                  href={qs({ source: s })}
                  className="toolbar-btn"
                  aria-current={sp.source === s ? "true" : undefined}
                >
                  {SOURCE_LABEL[s]}
                </Link>
              ))}
            </div>
          </section>

          <section className="inv-panel inv-panel--flush">
            <div className="inv-panel__head px-5 pt-4">
              <div>
                <div className="inv-panel__dept">Inbox</div>
                <h2 className="inv-panel__title">
                  {includeResolved ? "Everything recent" : "Needs a decision"}
                </h2>
              </div>
            </div>

            {alerts.length === 0 ? (
              <p className="px-5 py-8 text-[13px] text-(--ink-muted)">
                {includeResolved
                  ? "Nothing recorded in this window."
                  : "Nothing open. Anything raised in the last " +
                    `${ANOMALY_RELEVANCE_DAYS} days has been dealt with.`}
              </p>
            ) : (
              <div>
                {alerts.map((a) => (
                  <AlertRow key={a.id} alert={a} showStore={stores.length > 1} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function Filter({
  label,
  href,
  active,
  count,
  tone,
}: {
  label: string
  href: string
  active: boolean
  count: number
  tone?: string
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className="flex items-baseline gap-2"
      style={{ color: active ? "var(--ink)" : "var(--ink-muted)" }}
    >
      <span
        className="font-mono text-[10px] uppercase tracking-[0.18em]"
        style={{ fontWeight: active ? 700 : 500 }}
      >
        {label}
      </span>
      <span
        className="text-[18px] font-semibold tabular-nums"
        style={{ color: count > 0 ? (tone ?? "var(--ink)") : "var(--ink-muted)" }}
      >
        {count}
      </span>
    </Link>
  )
}
