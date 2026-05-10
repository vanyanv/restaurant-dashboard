import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getAllSystemStatus } from "@/lib/monitoring/system-status"
import {
  getBridgeEvents,
  getErrorsByHour,
  getAiCostByHour,
  getLoginsByHour,
  getSyncs,
} from "@/lib/monitoring/queries"
import { PageHead } from "@/components/mobile/page-head"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"
import { Panel } from "@/components/mobile/panel"
import { MonitoringPills } from "@/components/mobile/monitoring-pills"
import { MonitoringActivityStrip } from "@/components/mobile/monitoring-strip"
import { MonitoringSyncs } from "@/components/mobile/monitoring-syncs"
import { MonitoringEvents } from "@/components/mobile/monitoring-events"

export const dynamic = "force-dynamic"
export const revalidate = 30

/**
 * Zero-fill an hourly series so the sparkline always has 24 columns even when
 * a stretch of hours had no events. Buckets are matched at the hour grain.
 */
function zeroFillHourly<T extends { bucket: Date; value: number }>(
  rows: Array<{ bucket: Date } & Record<string, unknown>>,
  hours: number,
  pick: (r: (typeof rows)[number]) => number,
): T[] {
  const map = new Map<number, number>()
  for (const r of rows) {
    map.set(new Date(r.bucket).setMinutes(0, 0, 0), pick(r))
  }
  const out: T[] = []
  const now = new Date()
  now.setMinutes(0, 0, 0)
  for (let i = hours - 1; i >= 0; i--) {
    const ts = now.getTime() - i * 3600_000
    out.push({ bucket: new Date(ts), value: map.get(ts) ?? 0 } as T)
  }
  return out
}

export default async function MobileMonitoringPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  // Match the desktop monitoring layout: this page is DEVELOPER-only.
  if (session.user.role !== "DEVELOPER") redirect("/m")

  const [statuses, errorsByHour, aiByHour, loginsByHour, events, syncs] =
    await Promise.all([
      getAllSystemStatus(),
      getErrorsByHour(24),
      getAiCostByHour(24),
      getLoginsByHour(24),
      getBridgeEvents(15),
      getSyncs(),
    ])

  const errorSeries = zeroFillHourly<{ bucket: Date; value: number }>(
    errorsByHour,
    24,
    (r) => Number(r.count),
  )
  const aiSeries = zeroFillHourly<{ bucket: Date; value: number }>(
    aiByHour,
    24,
    (r) => Number(r.cost),
  )
  const loginsSeries = zeroFillHourly<{ bucket: Date; value: number }>(
    loginsByHour,
    24,
    (r) => Number(r.succeeded),
  )
  const failuresSeries = zeroFillHourly<{ bucket: Date; value: number }>(
    loginsByHour,
    24,
    (r) => Number(r.failed),
  )

  const danger = statuses.filter((s) => s.tone === "danger").length
  const warn = statuses.filter((s) => s.tone === "warn").length
  const overdue = syncs.filter((s) => s.overdue).length
  const failed = syncs.filter((s) => s.status === "FAILURE").length
  const totalErrors = errorSeries.reduce((s, p) => s + p.value, 0)

  const cells: MastheadCell[] = [
    {
      label: "SYSTEMS",
      value:
        danger > 0
          ? <span style={{ color: "var(--accent)" }}>{danger} alert</span>
          : warn > 0
            ? <span style={{ color: "var(--subtract)" }}>{warn} watch</span>
            : "all ok",
      sub: `${statuses.length} subsystems`,
    },
    {
      label: "ERRORS · 24H",
      value: (
        <span style={{ color: totalErrors > 0 ? "var(--accent)" : "var(--ink)" }}>
          {totalErrors.toLocaleString("en-US")}
        </span>
      ),
      sub: totalErrors === 0 ? "quiet" : "review feed",
    },
    {
      label: "CRONS",
      value: (
        <span
          style={{
            color: failed > 0 || overdue > 0 ? "var(--accent)" : "var(--ink)",
          }}
        >
          {failed > 0 ? `${failed} failed` : overdue > 0 ? `${overdue} late` : "on time"}
        </span>
      ),
      sub: `${syncs.length} jobs`,
    },
  ]

  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"

  return (
    <div data-perf-ready="/m/monitoring">
      <PageHead
        dept="DEV · § BRIDGE"
        title="Monitoring"
        sub={`build ${commitSha} · last 24h`}
      />

      <MastheadFigures cells={cells} />

      <div style={{ marginTop: 14 }}>
        <Panel dept="LAST 24H · ACTIVITY">
          <MonitoringActivityStrip
            errors={errorSeries}
            aiCost={aiSeries}
            logins={loginsSeries}
            loginFailures={failuresSeries}
          />
        </Panel>
      </div>

      <div style={{ marginTop: 14 }}>
        <Panel dept="SUBSYSTEMS">
          <MonitoringPills statuses={statuses} />
        </Panel>
      </div>

      <div style={{ marginTop: 14 }}>
        <Panel dept={`CRONS · ${syncs.length} JOB${syncs.length === 1 ? "" : "S"}`}>
          <MonitoringSyncs rows={syncs} />
        </Panel>
      </div>

      <div style={{ marginTop: 14 }}>
        <Panel dept={`EVENTS · LAST ${events.length}`}>
          <MonitoringEvents events={events} />
        </Panel>
      </div>
    </div>
  )
}
