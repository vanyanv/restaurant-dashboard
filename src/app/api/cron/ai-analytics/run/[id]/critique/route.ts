import { NextRequest, NextResponse } from "next/server"
import { isCronRequest } from "@/lib/rate-limit"
import { runPhaseCritique } from "@/lib/ai-analytics/orchestrator"

export const maxDuration = 60

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await ctx.params
  const result = await runPhaseCritique(id)
  return NextResponse.json(result)
}
