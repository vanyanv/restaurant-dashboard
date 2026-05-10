type PositionRow = {
  id: string
  category: string | null
  position: string | null
  hours: number | null
  totalLabor: number | null
  overtimeAmount: number | null
}

type Props = {
  rows: PositionRow[]
}

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })

const fmtHours = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 1 })

/**
 * Per-position breakdown for a single labor day. One `.inv-row` per position;
 * positions with overtime > 0 stamp a small accent OT chip and turn the
 * row total accent-red on hover via the standard `.inv-row` pattern.
 */
export function LaborPositionList({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="m-empty m-empty--flush">
        No position data for today.
      </div>
    )
  }

  const sorted = [...rows].sort(
    (a, b) => (b.totalLabor ?? 0) - (a.totalLabor ?? 0),
  )

  return (
    <div>
      {sorted.map((row) => {
        const ot = row.overtimeAmount ?? 0
        return (
          <div
            key={row.id}
            className="inv-row m-labor-position"
            style={{
              gridTemplateColumns:
                "[rule] 8px [name] minmax(0, 1fr) [hours] 56px [total] minmax(80px, auto)",
              gap: 12,
              padding: "12px 4px",
            }}
          >
            <div />
            <div style={{ minWidth: 0 }}>
              <div className="inv-row__vendor-name">
                {row.position ?? "—"}
              </div>
              <div
                style={{
                  fontFamily:
                    "var(--font-jetbrains-mono), ui-monospace, monospace",
                  fontSize: 9.5,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--ink-faint)",
                  marginTop: 4,
                }}
              >
                {row.category ?? "—"}
                {ot > 0 ? (
                  <span
                    className="inv-stamp"
                    data-tone="alert"
                    style={{ marginLeft: 8 }}
                  >
                    OT {fmtMoney(ot)}
                  </span>
                ) : null}
              </div>
            </div>
            <div
              style={{
                fontFamily:
                  "var(--font-jetbrains-mono), ui-monospace, monospace",
                fontSize: 11,
                letterSpacing: "0.12em",
                color: "var(--ink-muted)",
                fontVariantNumeric: "tabular-nums lining-nums",
                textAlign: "right",
              }}
            >
              {row.hours != null ? `${fmtHours(row.hours)}h` : "—"}
            </div>
            <div className="inv-row__total">
              {row.totalLabor != null ? fmtMoney(row.totalLabor) : "—"}
            </div>
          </div>
        )
      })}
    </div>
  )
}
