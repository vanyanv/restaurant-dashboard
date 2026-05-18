"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"

function fmtRange(weekStartIso: string): string {
  const start = new Date(`${weekStartIso}T00:00:00.000Z`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  const fmtL = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    })
  const fmtR = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    })
  return `${fmtL(start)} – ${fmtR(end)}`
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

type Props = {
  weekStart: string
  thisWeek: string
  isCurrentWeek: boolean
  daysWithData: number
}

export function MLaborWeekNav({
  weekStart,
  thisWeek,
  isCurrentWeek,
  daysWithData,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const go = (iso: string) => {
    const params = new URLSearchParams(sp.toString())
    params.set("week", iso)
    router.push(`${pathname}?${params.toString()}`)
  }

  const prev = addDaysIso(weekStart, -7)
  const next = addDaysIso(weekStart, 7)
  const isFuture = weekStart > thisWeek

  const sub = isCurrentWeek
    ? `In progress · ${daysWithData}/7 days`
    : daysWithData === 7
      ? "Closed · 7/7 days"
      : `${daysWithData}/7 days recorded`

  return (
    <nav
      className="inv-panel m-labor-weeknav"
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        marginTop: 14,
      }}
    >
      <button
        type="button"
        onClick={() => go(prev)}
        aria-label="Previous week"
        style={navBtnStyle}
      >
        ←&nbsp;Prev
      </button>

      <div style={{ textAlign: "center", minWidth: 0 }}>
        <div
          style={{
            fontFamily:
              "var(--font-dm-sans), system-ui, sans-serif",
            fontWeight: 600,
            fontSize: 13.5,
            color: "var(--ink)",
            fontVariantNumeric: "tabular-nums lining-nums",
            letterSpacing: "0.01em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {fmtRange(weekStart)}
        </div>
        <div
          style={{
            fontFamily:
              "var(--font-jetbrains-mono), ui-monospace, monospace",
            fontSize: 9.5,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
            marginTop: 2,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span>{sub}</span>
          {!isCurrentWeek ? (
            <button
              type="button"
              onClick={() => go(thisWeek)}
              style={{
                ...pillBtnStyle,
                color: "var(--accent)",
              }}
            >
              Today
            </button>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={() => go(next)}
        disabled={isFuture}
        aria-label="Next week"
        style={{
          ...navBtnStyle,
          opacity: isFuture ? 0.35 : 1,
          cursor: isFuture ? "not-allowed" : "pointer",
        }}
      >
        Next&nbsp;→
      </button>
    </nav>
  )
}

const navBtnStyle: React.CSSProperties = {
  appearance: "none",
  border: "1px solid var(--hairline-bold)",
  background: "rgba(255, 253, 247, 0.55)",
  color: "var(--ink)",
  fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  padding: "8px 10px",
  borderRadius: 2,
  cursor: "pointer",
}

const pillBtnStyle: React.CSSProperties = {
  appearance: "none",
  border: "1px solid var(--accent)",
  background: "transparent",
  fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
  fontSize: 9,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  padding: "2px 6px",
  borderRadius: 999,
  cursor: "pointer",
}
