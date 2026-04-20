import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { runOrdersSync } from "@/lib/otter-orders-sync"
import { isCronRequest, rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.strict)
  if (limited) return limited

  const fromCron = isCronRequest(request)
  if (!fromCron) {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "OWNER") {
      return NextResponse.json(
        { error: "Only owners can sync Otter orders" },
        { status: 403 }
      )
    }
  }

  const body = await request.json().catch(() => ({})) as { days?: number }
  const days = Math.min(Math.max(Number(body.days) || 2, 1), 14)

  try {
    const result = await runOrdersSync(days)
    return NextResponse.json(result)
  } catch (error) {
    console.error("Orders sync error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    )
  }
}
