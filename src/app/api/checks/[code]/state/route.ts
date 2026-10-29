import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { findStoreByCode, loadCrewView } from "@/lib/checks/crew"

/**
 * The crew page's refresh: the shared form as it stands, so every phone on a
 * check sees the others' ticks within a few seconds, and sees the window open,
 * lock or get submitted without a reload. Public, like the page itself.
 */
const STATE_LIMIT = { limit: 90, windowMs: 60_000, identifyBy: "ip" as const }

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const limited = await rateLimit(request, STATE_LIMIT)
  if (limited) return limited
  const { code } = await params
  const store = await findStoreByCode(code)
  if (!store) return NextResponse.json({ error: "This link is no longer in use." }, { status: 404 })
  return NextResponse.json(
    { view: await loadCrewView(store, new Date()) },
    { headers: { "Cache-Control": "no-store" } },
  )
}
