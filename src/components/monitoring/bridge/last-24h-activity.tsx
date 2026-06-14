import Link from "next/link"
import { InlineSpark } from "../inline-spark"
import { monoLabel, fraunces17, number as numberStyle } from "../styles"
import { SYSTEM_INK } from "../system-color"

export type LoginsByHour = { bucket: Date; succeeded: number; failed: number }

type Props = {
  errorsByHour: { bucket: Date; count: number }[]
  aiCostByHour: { bucket: Date; cost: number }[]
  loginsByHour: LoginsByHour[]
}

/** Row 3 — three sparkline tiles for the last 24h. */
export function Last24hActivity({ errorsByHour, aiCostByHour, loginsByHour }: Props) {
  const errorsTotal = errorsByHour.reduce((a, b) => a + b.count, 0)
  const aiTotal = aiCostByHour.reduce((a, b) => a + b.cost, 0)
  const loginsTotal = loginsByHour.reduce((a, b) => a + b.succeeded + b.failed, 0)
  const failedTotal = loginsByHour.reduce((a, b) => a + b.failed, 0)

  return (
    <section
      className="inv-panel"
      style={{
        padding: "16px 18px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 0,
      }}
    >
      <Tile
        href="/dashboard/admin/monitoring/activity"
        heading="Errors"
        big={`${errorsTotal}`}
        bigTone={errorsTotal > 0 ? "danger" : "ink"}
        sub="last 24 hours"
        spark={
          <InlineSpark
            points={errorsByHour.map((p) => ({ x: p.bucket.getTime(), y: p.count }))}
            width={180}
            height={28}
          />
        }
      />
      <Divider />
      <Tile
        href="/dashboard/admin/monitoring/costs"
        heading="AI spend"
        big={`$${aiTotal.toFixed(2)}`}
        sub="last 24 hours"
        spark={
          <InlineSpark
            points={aiCostByHour.map((p) => ({ x: p.bucket.getTime(), y: p.cost }))}
            width={180}
            height={28}
          />
        }
      />
      <Divider />
      <Tile
        href="/dashboard/admin/monitoring/people"
        heading="Logins"
        big={`${loginsTotal}`}
        bigTone={failedTotal > 0 ? "danger" : "ink"}
        sub={
          failedTotal > 0
            ? `${failedTotal} failed · 24h`
            : `last 24 hours`
        }
        spark={
          <SplitSpark
            points={loginsByHour.map((p) => ({
              x: p.bucket.getTime(),
              up: p.succeeded,
              down: p.failed,
            }))}
            width={180}
            height={28}
          />
        }
      />
    </section>
  )
}

function Divider() {
  return (
    <div
      aria-hidden
      style={{ width: 1, background: "var(--hairline)" }}
    />
  )
}

function Tile({
  href,
  heading,
  big,
  bigTone = "ink",
  sub,
  spark,
}: {
  href: string
  heading: string
  big: string
  bigTone?: "ink" | "danger"
  sub: string
  spark: React.ReactNode
}) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "6px 18px",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <span style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink)" }}>
        {heading}
      </span>
      <span
        style={{
          ...numberStyle,
          fontSize: 26,
          color: bigTone === "danger" ? "var(--accent)" : "var(--ink)",
        }}
      >
        {big}
      </span>
      <span style={{ ...monoLabel, color: "var(--ink-muted)" }}>{sub}</span>
      <div style={{ marginTop: 2 }}>{spark}</div>
    </Link>
  )
}

/** Split-axis sparkline: successes go up in stamp blue, failures go
 * down in accent red. Reads as a security signal at a glance. */
function SplitSpark({
  points,
  width = 180,
  height = 28,
}: {
  points: { x: number; up: number; down: number }[]
  width?: number
  height?: number
}) {
  if (points.length === 0) {
    return <span style={{ display: "inline-block", width, height }} aria-hidden />
  }
  const maxUp = Math.max(1, ...points.map((p) => p.up))
  const maxDn = Math.max(1, ...points.map((p) => p.down))
  const half = height / 2
  const stepX = points.length > 1 ? width / points.length : 0
  return (
    <svg width={width} height={height} aria-hidden style={{ display: "block" }}>
      <line x1={0} x2={width} y1={half} y2={half} stroke="var(--hairline)" strokeWidth={1} />
      {points.map((p, i) => {
        const x = i * stepX
        const upH = (p.up / maxUp) * (half - 1)
        const dnH = (p.down / maxDn) * (half - 1)
        return (
          <g key={i}>
            {p.up > 0 && (
              <rect
                x={x + 1}
                y={half - upH}
                width={Math.max(1, stepX - 2)}
                height={upH}
                fill={SYSTEM_INK.db}
              />
            )}
            {p.down > 0 && (
              <rect
                x={x + 1}
                y={half}
                width={Math.max(1, stepX - 2)}
                height={dnH}
                fill="var(--accent)"
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}
