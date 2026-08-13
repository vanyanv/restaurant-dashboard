import { fraunces17, monoLabel } from "../styles"
import { RegisterMark } from "../register-mark"
import { SYSTEM_INK } from "../system-color"
import { todayInLA } from "@/lib/dashboard-utils"
import type { ActiveDay } from "@/lib/monitoring/engagement"

const CELL_COUNT = 90

/** 90 cells, oldest to newest. Absent days are the point of this strip —
 * a gap is the signal, so empty cells stay visible rather than collapsing. */
export function ActivityCalendar({ days }: { days: ActiveDay[] }) {
  const byDate = new Map(days.map((d) => [d.date, d.views]))

  // Cell keys must be built on the same Los Angeles basis as `dayKey`, or the
  // strip renders UTC days and every cell misses the data it was drawn for.
  // Arithmetic runs in UTC over the LA date string so it stays a pure calendar
  // walk rather than a second timezone conversion.
  const [y, m, d] = todayInLA().split("-").map(Number) as [number, number, number]
  const cells: Array<{ date: string; views: number }> = []
  for (let i = CELL_COUNT - 1; i >= 0; i--) {
    const key = new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10)
    cells.push({ date: key, views: byDate.get(key) ?? 0 })
  }

  // Count what is actually drawn. The read is a rolling 90x24h window, so it
  // catches part of day -90 and the header could otherwise claim "91 of 90".
  const renderedActive = cells.filter((c) => c.views > 0).length
  const max = Math.max(1, ...cells.map((c) => c.views))

  return (
    <section className="inv-panel" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <RegisterMark color={SYSTEM_INK.auth} size={8} />
        <span style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink)" }}>
          Active days
        </span>
        <span
          style={{
            ...monoLabel,
            color: "var(--ink-faint)",
            letterSpacing: "0.16em",
            marginLeft: "auto",
          }}
        >
          {renderedActive} of {CELL_COUNT}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(30, 1fr)",
          gap: 3,
          marginTop: 14,
        }}
      >
        {cells.map((c) => (
          <div
            key={c.date}
            title={`${c.date} — ${c.views} views`}
            style={{
              aspectRatio: "1",
              borderRadius: 2,
              border: "1px solid var(--hairline)",
              background:
                c.views === 0
                  ? "transparent"
                  : `rgba(220, 38, 38, ${0.12 + 0.68 * (c.views / max)})`,
            }}
          />
        ))}
      </div>
    </section>
  )
}
