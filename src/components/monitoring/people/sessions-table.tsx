"use client"

import { useState } from "react"
import { fraunces17, monoLabel, dmBody, number } from "../styles"
import { RegisterMark } from "../register-mark"
import { SYSTEM_INK } from "../system-color"
import type { Session } from "@/lib/monitoring/engagement"
import { fmtDuration } from "./engagement-summary"

export function SessionsTable({
  sessions,
  userName,
}: {
  sessions: Session[]
  userName: string
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  return (
    <section className="inv-panel" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <RegisterMark color={SYSTEM_INK.auth} size={8} />
        <span style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink)" }}>
          Sessions — {userName}
        </span>
        <span
          style={{
            ...monoLabel,
            color: "var(--ink-faint)",
            letterSpacing: "0.16em",
            marginLeft: "auto",
          }}
        >
          {sessions.length} sessions
        </span>
      </div>

      {sessions.length === 0 ? (
        <p
          style={{
            ...fraunces17,
            fontStyle: "italic",
            color: "var(--ink-muted)",
            marginTop: 12,
          }}
        >
          No sessions in this window.
        </p>
      ) : (
        <ul style={{ margin: "12px 0 0 0", padding: 0, listStyle: "none" }}>
          {sessions.map((s, i) => (
            <li key={new Date(s.startedAt).toISOString()}>
              <button
                type="button"
                className="inv-row"
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
                aria-expanded={openIdx === i}
                style={{
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "150px 90px 70px 1fr",
                  alignItems: "baseline",
                  gap: 12,
                  padding: "9px 4px",
                  background: "none",
                  border: "none",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>
                  {fmtStamp(s.startedAt)}
                </span>
                <span style={{ ...number, fontSize: 13 }}>
                  {fmtDuration(s.durationMs)}
                </span>
                <span style={{ ...number, fontSize: 13, color: "var(--ink-muted)" }}>
                  {s.pageCount}p
                </span>
                <span style={{ ...monoLabel, color: "var(--ink-muted)" }}>
                  {s.entryPath} → {s.exitPath}
                </span>
              </button>

              {openIdx === i && (
                <ol
                  style={{
                    margin: "2px 0 10px 0",
                    padding: "8px 0 8px 18px",
                    listStyle: "none",
                    borderLeft: "2px solid var(--hairline-bold)",
                  }}
                >
                  {s.views.map((v, vi) => (
                    <li
                      key={`${new Date(v.enteredAt).toISOString()}-${vi}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "70px 1fr 70px",
                        gap: 12,
                        padding: "4px 0",
                      }}
                    >
                      <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>
                        {fmtClock(v.enteredAt)}
                      </span>
                      <span style={{ ...dmBody, color: "var(--ink)" }}>{v.path}</span>
                      <span
                        style={{
                          ...monoLabel,
                          color: "var(--ink-muted)",
                          textAlign: "right",
                        }}
                      >
                        {v.dwellMs == null ? "—" : `${Math.round(v.dwellMs / 1000)}s`}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function fmtStamp(d: Date): string {
  const date = new Date(d)
  const month = date.toLocaleString(undefined, { month: "short" })
  return `${month} ${String(date.getDate()).padStart(2, "0")} · ${fmtClock(date)}`
}

function fmtClock(d: Date): string {
  const date = new Date(d)
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`
}
