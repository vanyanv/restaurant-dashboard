"use client"

import type { ReactNode } from "react"

interface EditorialTooltipRow {
  label: string
  value: ReactNode
  tone?: "ink" | "accent" | "subtract" | "muted"
}

interface EditorialChartTooltipProps {
  active?: boolean
  caption?: string
  rows: EditorialTooltipRow[]
  footnote?: string
}

const TONE_COLOR: Record<NonNullable<EditorialTooltipRow["tone"]>, string> = {
  ink: "var(--ink)",
  accent: "var(--accent)",
  subtract: "var(--subtract)",
  muted: "var(--ink-muted)",
}

export function EditorialChartTooltip({
  active,
  caption,
  rows,
  footnote,
}: EditorialChartTooltipProps) {
  if (!active || !rows.length) return null
  return (
    <div
      style={{
        background: "var(--paper)",
        border: "1px solid var(--hairline-bold)",
        borderRadius: 2,
        padding: "8px 12px",
        boxShadow: "0 8px 22px -10px rgba(26,22,19,0.3)",
        minWidth: 140,
      }}
    >
      {caption ? (
        <p
          style={{
            fontFamily: "var(--font-jetbrains-mono), monospace",
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
            margin: 0,
          }}
        >
          {caption}
        </p>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: caption ? 6 : 0 }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-dm-sans), sans-serif",
                fontSize: 11,
                color: "var(--ink-muted)",
                letterSpacing: "-0.005em",
              }}
            >
              {r.label}
            </span>
            <span
              style={{
                fontFamily: "var(--font-dm-sans), sans-serif",
                fontWeight: 600,
                fontSize: 13,
                letterSpacing: "-0.012em",
                color: TONE_COLOR[r.tone ?? "ink"],
                fontVariantNumeric: "tabular-nums lining-nums",
                fontFeatureSettings: '"tnum", "lnum"',
              }}
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>
      {footnote ? (
        <p
          style={{
            fontFamily: "var(--font-dm-sans), sans-serif",
            fontSize: 11,
            color: "var(--ink-muted)",
            margin: "6px 0 0",
            letterSpacing: "-0.005em",
          }}
        >
          {footnote}
        </p>
      ) : null}
    </div>
  )
}
