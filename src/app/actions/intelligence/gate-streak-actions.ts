"use server"

import { prisma } from "@/lib/prisma"
import { requireAuthScope } from "@/lib/auth-scope"

export interface GateStreak {
  consecutivePass: number
  trailingWindow: {
    date: string
    allPassed: boolean
    gateBreakdown: { gate: string; passed: boolean }[]
  }[]
}

export async function getOperatorGateStreak(): Promise<GateStreak> {
  // OperatorGateDailyVerdict is global (no store/account column), so we can't
  // tenant-filter it — but it still exposes ML pipeline health, so require auth.
  await requireAuthScope()
  const fourteenDaysAgo = new Date()
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
  const rows = await prisma.operatorGateDailyVerdict.findMany({
    where: { verdictDate: { gte: fourteenDaysAgo } },
    orderBy: [{ verdictDate: "desc" }, { gateName: "asc" }],
  })

  // Group by date.
  const byDate = new Map<string, { gate: string; passed: boolean }[]>()
  for (const r of rows) {
    const key = r.verdictDate.toISOString().slice(0, 10)
    if (!byDate.has(key)) byDate.set(key, [])
    byDate.get(key)!.push({ gate: r.gateName, passed: r.passed })
  }

  const trailingWindow = Array.from(byDate.entries()).map(([date, gates]) => ({
    date,
    allPassed: gates.every((g) => g.passed),
    gateBreakdown: gates,
  }))

  // Count consecutive pass days starting from the most recent.
  let consecutivePass = 0
  for (const day of trailingWindow) {
    if (day.allPassed) consecutivePass++
    else break
  }
  return { consecutivePass, trailingWindow }
}
