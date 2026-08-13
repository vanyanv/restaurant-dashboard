import { fraunces17, monoLabel } from "../styles"
import { RegisterMark } from "../register-mark"
import { SYSTEM_INK } from "../system-color"
import type { ActiveDay } from "@/lib/monitoring/engagement"

/** 90 cells, oldest to newest. Absent days are the point of this strip —
 * a gap is the signal, so empty cells stay visible rather than collapsing. */
export function ActivityCalendar({ days }: { days: ActiveDay[] }) {
  const byDate = new Map(days.map((d) => [d.date, d.views]))
  const max = Math.max(1, ...days.map((d) => d.views))

  const cells: Array<{ date: string; views: number }> = []
  const today = new Date()
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`
    cells.push({ date: key, views: byDate.get(key) ?? 0 })
  }

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
          {days.length} of 90
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
