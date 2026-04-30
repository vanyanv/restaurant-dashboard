import type { SyncRow } from "@/lib/monitoring/queries"
import { InlineSpark } from "./inline-spark"
import { JOB_SCHEDULES } from "@/lib/monitoring/job-schedules"
import { monoLabel, number as numberStyle } from "./styles"

type Props = {
  db: { totalBytes: number; capBytes: number; pct: number }
  dbGrowth: { date: Date; totalBytes: number }[]
  aiTodayUsd: number
  aiCost30d: number
  aiCostByDay: { day: Date; cost: number }[]
  syncs: SyncRow[]
  errorsCount24h: number
  errorsByHour: { bucket: Date; count: number }[]
  cacheHitPctRecent: number
  cacheHitByDay: { day: Date; hitPct: number }[]
}

export function DashboardTiles(props: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <DatabaseTile db={props.db} dbGrowth={props.dbGrowth} />
      <AiSpendTile
        aiTodayUsd={props.aiTodayUsd}
        aiCost30d={props.aiCost30d}
        aiCostByDay={props.aiCostByDay}
      />
      <SyncsTile syncs={props.syncs} />
      <ErrorsCacheTile
        errorsCount24h={props.errorsCount24h}
        errorsByHour={props.errorsByHour}
        cacheHitPctRecent={props.cacheHitPctRecent}
        cacheHitByDay={props.cacheHitByDay}
      />
    </div>
  )
}

// ─── Tile shell ─────────────────────────────────────────────────────────

function Tile({
  dept,
  big,
  bigTone = "ink",
  sub,
  spark,
}: {
  dept: string
  big: React.ReactNode
  bigTone?: "ink" | "accent"
  sub?: React.ReactNode
  spark?: React.ReactNode
}) {
  return (
    <section
      className="inv-panel"
      style={{
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 130,
      }}
    >
      <span
        style={{
          ...monoLabel,
          letterSpacing: "0.24em",
          color: "var(--ink-faint)",
        }}
      >
        {dept}
      </span>
      <div
        style={{
          fontFamily: "var(--font-dm-sans), ui-sans-serif, sans-serif",
          fontWeight: 600,
          fontSize: 28,
          lineHeight: 1.05,
          fontVariantNumeric: "tabular-nums lining-nums",
          letterSpacing: "-0.018em",
          color: bigTone === "accent" ? "var(--accent)" : "var(--ink)",
        }}
      >
        {big}
      </div>
      {sub !== undefined && (
        <div
          style={{
            ...monoLabel,
            color: "var(--ink-muted)",
            letterSpacing: "0.14em",
          }}
        >
          {sub}
        </div>
      )}
      {spark !== undefined && (
        <div style={{ marginTop: "auto", paddingTop: 4 }}>{spark}</div>
      )}
    </section>
  )
}

// ─── DATABASE ───────────────────────────────────────────────────────────

function DatabaseTile({
  db,
  dbGrowth,
}: {
  db: Props["db"]
  dbGrowth: Props["dbGrowth"]
}) {
  const pct = Math.round(db.pct)
  const elevated = pct >= 75
  const sparkPoints = dbGrowth.map((d) => ({
    x: new Date(d.date).getTime(),
    y: d.totalBytes,
  }))
  return (
    <Tile
      dept="DATABASE"
      big={`${pct}%`}
      bigTone={elevated ? "accent" : "ink"}
      sub={`${fmtBytes(db.totalBytes)} / ${fmtBytes(db.capBytes)}`}
      spark={
        sparkPoints.length > 1 ? (
          <InlineSpark points={sparkPoints} width={140} height={20} />
        ) : null
      }
    />
  )
}

// ─── AI SPEND ───────────────────────────────────────────────────────────

function AiSpendTile({
  aiTodayUsd,
  aiCost30d,
  aiCostByDay,
}: {
  aiTodayUsd: number
  aiCost30d: number
  aiCostByDay: { day: Date; cost: number }[]
}) {
  const sparkPoints = aiCostByDay.map((d) => ({
    x: new Date(d.day).getTime(),
    y: d.cost,
  }))
  // Highlight if today >50% above 30d average
  const mean = aiCost30d / Math.max(1, aiCostByDay.length)
  const elevated = aiTodayUsd > mean * 1.5 && aiTodayUsd > 0
  return (
    <Tile
      dept="AI SPEND"
      big={`$${aiTodayUsd.toFixed(2)}`}
      bigTone={elevated ? "accent" : "ink"}
      sub={`today · $${aiCost30d.toFixed(0)} / 30d`}
      spark={
        sparkPoints.length > 1 ? (
          <InlineSpark points={sparkPoints} width={140} height={20} />
        ) : null
      }
    />
  )
}

// ─── SYNCS ──────────────────────────────────────────────────────────────

function SyncsTile({ syncs }: { syncs: SyncRow[] }) {
  const total = syncs.length
  const failing = syncs.filter((s) => s.status === "FAILURE").length
  const overdue = syncs.filter(
    (s) => s.overdue && s.status !== "FAILURE",
  ).length
  const okCount = syncs.filter(
    (s) => s.status === "SUCCESS" && !s.overdue,
  ).length
  const elevated = failing > 0 || overdue > 0

  // Compute "next expected" from the most-recently-run sync's cadence
  const next = computeNextExpected(syncs)

  let bigText: string
  if (failing > 0) bigText = `${failing} fail`
  else if (overdue > 0) bigText = `${overdue} late`
  else bigText = `${okCount}/${total} OK`

  let subText: string
  if (failing > 0 || overdue > 0) {
    subText = `${okCount}/${total} healthy`
  } else if (next) {
    subText = `next ${next}`
  } else {
    subText = `${total} jobs registered`
  }

  return (
    <Tile
      dept="SYNCS"
      big={bigText}
      bigTone={elevated ? "accent" : "ink"}
      sub={subText}
    />
  )
}

function computeNextExpected(syncs: SyncRow[]): string | null {
  // Find the soonest next-expected time (lastRunAt + cadence) across known jobs
  let soonestMs = Infinity
  for (const s of syncs) {
    if (!s.lastRunAt) continue
    const sched = JOB_SCHEDULES[s.jobName]
    if (!sched) continue
    const nextAt =
      new Date(s.lastRunAt).getTime() + sched.cadenceMinutes * 60_000
    if (nextAt > Date.now() && nextAt < soonestMs) soonestMs = nextAt
  }
  if (!isFinite(soonestMs)) return null
  const deltaMin = Math.round((soonestMs - Date.now()) / 60_000)
  if (deltaMin < 60) return `~${deltaMin}m`
  if (deltaMin < 60 * 24) return `~${Math.round(deltaMin / 60)}h`
  return `~${Math.round(deltaMin / 60 / 24)}d`
}

// ─── ERRORS · CACHE ─────────────────────────────────────────────────────

function ErrorsCacheTile({
  errorsCount24h,
  errorsByHour,
  cacheHitPctRecent,
  cacheHitByDay,
}: {
  errorsCount24h: number
  errorsByHour: { bucket: Date; count: number }[]
  cacheHitPctRecent: number
  cacheHitByDay: { day: Date; hitPct: number }[]
}) {
  const hasErrors = errorsCount24h > 0
  const lowCache = cacheHitPctRecent > 0 && cacheHitPctRecent < 30
  const elevated = hasErrors || lowCache

  const errPoints = errorsByHour.map((p) => ({
    x: new Date(p.bucket).getTime(),
    y: p.count,
  }))
  const cachePoints = cacheHitByDay.map((p) => ({
    x: new Date(p.day).getTime(),
    y: p.hitPct,
  }))

  return (
    <section
      className="inv-panel"
      style={{
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 130,
      }}
    >
      <span
        style={{
          ...monoLabel,
          letterSpacing: "0.24em",
          color: "var(--ink-faint)",
        }}
      >
        ERRORS · CACHE
      </span>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1px 1fr",
          gap: 12,
          alignItems: "stretch",
        }}
      >
        {/* errors */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span
            style={{
              ...numberStyle,
              fontSize: 22,
              color: hasErrors ? "var(--accent)" : "var(--ink)",
            }}
          >
            {errorsCount24h}
          </span>
          <span style={{ ...monoLabel, color: "var(--ink-muted)" }}>
            errs / 24h
          </span>
          {errPoints.length > 1 && (
            <InlineSpark points={errPoints} width={70} height={14} />
          )}
        </div>
        <div style={{ background: "var(--hairline)", width: 1 }} />
        {/* cache */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span
            style={{
              ...numberStyle,
              fontSize: 22,
              color: lowCache ? "var(--accent)" : "var(--ink)",
            }}
          >
            {Math.round(cacheHitPctRecent)}%
          </span>
          <span style={{ ...monoLabel, color: "var(--ink-muted)" }}>
            cache hit
          </span>
          {cachePoints.length > 1 && (
            <InlineSpark points={cachePoints} width={70} height={14} />
          )}
        </div>
      </div>
      {/* invisible elevated marker — keep parity with other tiles */}
      <span style={{ display: "none" }} aria-hidden>
        {elevated ? "elevated" : "ok"}
      </span>
    </section>
  )
}

// ─── helpers ────────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
