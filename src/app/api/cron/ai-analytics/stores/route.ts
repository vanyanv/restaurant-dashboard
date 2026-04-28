import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isCronRequest } from "@/lib/rate-limit"

/**
 * Enumerate active stores for AI analytics matrix fan-out from GitHub
 * Actions. Identical surface to `/api/cron/cogs/stores` but kept on its own
 * path so the AI cron workflows are decoupled from the COGS cron workflows.
 */
export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, name: true, ownerId: true },
    orderBy: { name: "asc" },
  })

  return NextResponse.json({ stores })
}
