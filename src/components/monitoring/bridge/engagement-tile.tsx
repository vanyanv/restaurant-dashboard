import Link from "next/link"
import { fraunces17, monoLabel, dmBody, number } from "../styles"
import { RegisterMark } from "../register-mark"
import { SYSTEM_INK } from "../system-color"
import { fmtAgo } from "../people/engagement-summary"

type Headline = {
  name: string
  lastSeenAt: Date
  lastPath: string
  sessionsToday: number
} | null

export function EngagementTile({ headline }: { headline: Headline }) {
  return (
    <Link
      href="/dashboard/admin/monitoring/people"
      className="inv-panel"
      style={{
        display: "block",
        padding: "14px 18px",
        textDecoration: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <RegisterMark color={SYSTEM_INK.auth} size={8} />
        <span style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink)" }}>
          Owner activity
        </span>
        <span
          style={{
            ...monoLabel,
            color: "var(--ink-faint)",
            letterSpacing: "0.16em",
            marginLeft: "auto",
          }}
        >
          people →
        </span>
      </div>

      {headline == null ? (
        <p style={{ ...dmBody, color: "var(--ink-muted)", marginTop: 8 }}>
          No page views recorded yet.
        </p>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            marginTop: 8,
            flexWrap: "wrap",
          }}
        >
          <span style={{ ...dmBody, color: "var(--ink)" }}>{headline.name}</span>
          <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>
            last seen {fmtAgo(headline.lastSeenAt)} on {headline.lastPath}
          </span>
          <span style={{ ...number, fontSize: 13, marginLeft: "auto" }}>
            {headline.sessionsToday}
          </span>
          <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>
            sessions today
          </span>
        </div>
      )}
    </Link>
  )
}
