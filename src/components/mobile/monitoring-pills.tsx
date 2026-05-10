import type { SystemStatus } from "@/lib/monitoring/system-status"
import { SYSTEM_LABEL } from "@/components/monitoring/system-color"

type Props = {
  statuses: SystemStatus[]
}

const TONE_DATA = {
  ok: { stamp: "info", label: "OK" },
  warn: { stamp: "watch", label: "WATCH" },
  danger: { stamp: "alert", label: "ALERT" },
} as const

/**
 * 2×3 grid of compact subsystem pills (db, r2, cache, auth, syncs, tokens).
 * Each pill renders a JetBrains Mono caption, the headline figure (DM Sans
 * tabular), and an optional caption. Tone drives the stamp color via the
 * existing `.inv-stamp[data-tone]` pattern — no new color tokens.
 */
export function MonitoringPills({ statuses }: Props) {
  if (statuses.length === 0) {
    return (
      <div className="m-empty m-empty--flush">
        No system signals yet.
      </div>
    )
  }
  return (
    <div className="m-mon-pills">
      {statuses.map((s) => {
        const tone = TONE_DATA[s.tone]
        return (
          <div key={s.system} className="m-mon-pill">
            <div className="m-mon-pill__head">
              <span className="m-mon-pill__name">
                {SYSTEM_LABEL[s.system]}
              </span>
              <span className="inv-stamp" data-tone={tone.stamp}>
                {tone.label}
              </span>
            </div>
            <div className="m-mon-pill__head-line">{s.headline}</div>
            {s.caption ? (
              <div className="m-mon-pill__caption">{s.caption}</div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
