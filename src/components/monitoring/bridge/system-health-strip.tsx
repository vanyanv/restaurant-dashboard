import Link from "next/link"
import type { SystemStatus } from "@/lib/monitoring/system-status"
import {
  SYSTEMS,
  SYSTEM_INK,
  SYSTEM_LABEL,
  SYSTEM_HREF,
  STATUS_COLOR,
} from "../system-color"
import { RegisterMark } from "../register-mark"
import { monoLabel, number as numberStyle } from "../styles"

/** Row 1 of the command bridge — six pill-sized status indicators. */
export function SystemHealthStrip({ statuses }: { statuses: SystemStatus[] }) {
  const byId = new Map(statuses.map((s) => [s.system, s]))
  return (
    <section
      className="inv-panel"
      style={{
        padding: "12px 14px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 0,
      }}
    >
      {SYSTEMS.map((sys, i) => {
        const status = byId.get(sys)
        if (!status) return null
        return (
          <Link
            key={sys}
            href={SYSTEM_HREF[sys]}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "10px 14px",
              borderLeft: i === 0 ? undefined : "1px solid var(--hairline)",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <RegisterMark color={SYSTEM_INK[sys]} />
              <span
                style={{
                  ...monoLabel,
                  color: "var(--ink-muted)",
                  letterSpacing: "0.18em",
                }}
              >
                {SYSTEM_LABEL[sys]}
              </span>
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  backgroundColor: STATUS_COLOR[status.tone],
                  marginLeft: "auto",
                }}
              />
            </div>
            <div
              style={{
                ...numberStyle,
                fontSize: 18,
                color:
                  status.tone === "danger" ? "var(--accent)" : "var(--ink)",
              }}
            >
              {status.headline}
            </div>
            {status.caption && (
              <div
                style={{
                  ...monoLabel,
                  color: "var(--ink-faint)",
                  letterSpacing: "0.12em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {status.caption}
              </div>
            )}
          </Link>
        )
      })}
    </section>
  )
}
