import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { loadCrewView } from "@/lib/checks/crew"
import { checkStateByCode } from "@/lib/checks/version"

/**
 * The crew page's refresh: the shared form as it stands, so every phone on a
 * check sees the others' ticks within a few seconds, and sees the window open,
 * lock or get submitted without a reload. Public, like the page itself.
 *
 * The phone sends the version of the view it holds (`?v=`). One query finds
 * the store and its current version (`version.ts`); when they match the
 * answer is `{ unchanged: true }` and nothing else is read or written. A
 * changed version loads the view and closes a finished check first, as the
 * page did on every refresh before: a window ending changes the version, so
 * the record still appears within seconds of the window closing.
 */
const STATE_LIMIT = { limit: 90, windowMs: 60_000, identifyBy: "ip" as const }
const NO_STORE = { "Cache-Control": "no-store" }

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const limited = await rateLimit(request, STATE_LIMIT)
  if (limited) return limited
  const { code } = await params
  const now = new Date()
  const state = await checkStateByCode(code, now)
  if (!state) return NextResponse.json({ error: "This link is no longer in use." }, { status: 404 })
  const seen = request.nextUrl.searchParams.get("v")
  if (seen && seen === state.version) {
    return NextResponse.json({ unchanged: true, version: state.version }, { headers: NO_STORE })
  }
  return NextResponse.json(
    { view: await loadCrewView(state.store, now, { version: state.version, autoClose: true }) },
    { headers: NO_STORE },
  )
}
