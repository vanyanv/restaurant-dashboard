import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
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
    /*
     * The highest-volume write path in the app — one row per navigation,
     * written from the client — and it had no ceiling. `PageView` is already
     * the table the nightly retention cron describes as its biggest, so a
     * navigation loop or a misbehaving client could inflate it between runs,
     * against a Neon plan whose storage is a tracked metric.
     *
     * A 429 here is returned rather than swallowed into NO_CONTENT, because
     * 429 is what a limiter means and a silent 204 would make a throttled
     * endpoint indistinguishable from a working one.
     *
     * It is NOT a signal anything can act on, and the tier below is chosen on
     * that basis. This note used to say "the beacon can then stop rather than
     * keep hammering"; it cannot. `navigator.sendBeacon` returns whether the
     * browser queued the request and never what came back, so no code on the
     * client sees this status — the only thing that happens is a console error
     * on whatever page the reader is looking at.
     *
     * Which is why the tier is `beacon` and not `moderate`. At 30 a minute a
     * person scanning the dashboard tripped it partway through and spent the
     * rest of the session logging errors from the endpoint whose own docblock
     * says it must never emit one. `beacon` is 240: still a hard stop for a
     * navigation loop, never reachable by a reader.
     */
    const limited = await rateLimit(req, RATE_LIMIT_TIERS.beacon)
    if (limited) return limited

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
