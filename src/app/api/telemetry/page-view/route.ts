import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  clampDwell,
  isTrackablePath,
  normalizeRoute,
  resolveEnteredAt,
  MAX_PATH_LEN,
} from "@/lib/monitoring/page-view"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  path: z.string().min(1),
  enteredAt: z.number(),
  dwellMs: z.number().nullable().optional(),
})

/** Always 204. A no-op and a successful write are indistinguishable to the
 * caller by design: this endpoint must never surface a failure to the person
 * being tracked, and must never emit an ErrorEvent of its own — that would
 * pollute the very monitoring stream it exists to feed. */
const NO_CONTENT = () => new NextResponse(null, { status: 204 })

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id
    if (!userId) return NO_CONTENT()

    // Developer browsing is excluded by decision. The escape hatch exists
    // because the developer otherwise cannot exercise this path — and it is
    // pinned to non-production so one stray Vercel env var cannot quietly
    // start polluting the owner's engagement data forever.
    if (
      session.user.role === "DEVELOPER" &&
      !(
        process.env.TRACK_DEVELOPER_PAGE_VIEWS === "1" &&
        process.env.NODE_ENV !== "production"
      )
    ) {
      return NO_CONTENT()
    }

    // A cross-site page can sendBeacon a text/plain body with the owner's
    // cookies and no preflight, injecting junk rows. Impact is small — this
    // data only renders as escaped text on a developer-only tab — but the
    // check is nearly free. Deliberately fail-OPEN when the header is absent:
    // rejecting on absence would silently kill the only write path for any
    // client that omits it, which is a far worse failure than the one it
    // prevents. Browsers that matter all send it.
    const fetchSite = req.headers.get("sec-fetch-site")
    if (fetchSite && fetchSite !== "same-origin") return NO_CONTENT()

    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return NO_CONTENT()

    const { path, enteredAt, dwellMs } = parsed.data
    if (!isTrackablePath(path)) return NO_CONTENT()

    await prisma.pageView.create({
      data: {
        userId,
        path: path.split(/[?#]/)[0]!.slice(0, MAX_PATH_LEN),
        route: normalizeRoute(path),
        enteredAt: resolveEnteredAt(enteredAt, Date.now()),
        dwellMs: clampDwell(dwellMs ?? null),
      },
    })
  } catch (err) {
    console.error("[page-view] dropped", err)
  }
  return NO_CONTENT()
}
