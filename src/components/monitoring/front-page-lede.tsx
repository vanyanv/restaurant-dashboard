"use client"

import { useQuery } from "@tanstack/react-query"

type Summary = {
  syncs: { jobName: string; lastRunAt: string | null; status: string | null; overdue: boolean }[]
}

export function FrontPageLede() {
  const { data } = useQuery<Summary>({
    queryKey: ["monitoring-summary-lede"],
    queryFn: async () => {
      const res = await fetch("/api/monitoring/summary", { cache: "no-store" })
      if (!res.ok) throw new Error("lede fetch failed")
      return res.json()
    },
    refetchInterval: 60_000,
  })

  if (!data) return null
  const failing =
    data.syncs.find((s) => s.status === "FAILURE") ??
    data.syncs.find((s) => s.overdue)
  if (!failing) return null

  return (
    <section
      className="my-8"
      style={{
        borderTop: "1px dashed var(--hairline-bold)",
        borderBottom: "1px dashed var(--hairline-bold)",
        padding: "18px 0",
      }}
    >
      <h2
        style={{
          fontFamily: "Fraunces, Iowan Old Style, Georgia, serif",
          fontSize: 26,
          fontWeight: 450,
          fontVariationSettings: '"opsz" 96, "SOFT" 50',
          letterSpacing: "-0.022em",
          lineHeight: 1.1,
          color: "var(--ink)",
        }}
      >
        <em style={{ fontStyle: "italic" }}>{failing.jobName}</em>{" "}
        {failing.status === "FAILURE" ? "is failing." : "is overdue."}
      </h2>
      <p
        style={{
          fontFamily: "DM Sans, ui-sans-serif, sans-serif",
          fontSize: 13,
          color: "var(--ink-muted)",
          marginTop: 8,
        }}
      >
        Last run{" "}
        {failing.lastRunAt ? new Date(failing.lastRunAt).toLocaleString() : "never"}.
      </p>
    </section>
  )
}
