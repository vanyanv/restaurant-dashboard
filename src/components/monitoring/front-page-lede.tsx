"use client"

import { useQuery } from "@tanstack/react-query"
import { monoLabel } from "./styles"

type Summary = {
  syncs: {
    jobName: string
    lastRunAt: string | null
    status: string | null
    overdue: boolean
  }[]
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
    <div
      className="mb-4"
      style={{
        background: "var(--accent-bg)",
        border: "1px solid var(--accent)",
        borderRadius: 2,
        padding: "8px 14px",
        ...monoLabel,
        color: "var(--accent-dark)",
        fontVariantNumeric: "tabular-nums lining-nums",
      }}
      role="status"
    >
      {failing.jobName}{" "}
      {failing.status === "FAILURE" ? "is failing" : "is overdue"}
      {" · "}
      {failing.lastRunAt
        ? `last run ${new Date(failing.lastRunAt).toLocaleString()}`
        : "never run"}
    </div>
  )
}
