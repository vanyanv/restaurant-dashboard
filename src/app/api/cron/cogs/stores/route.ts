import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isCronRequest } from "@/lib/rate-limit"

/**
 * Enumerate active store IDs for matrix fan-out from GitHub Actions. The
 * cogs-sweep / cogs-refresh workflows hit this first, then expand the result
 * into a per-store matrix so each downstream sweep call is bounded to one
 * store and stays well under Vercel's function timeout.
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
