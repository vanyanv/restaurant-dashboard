import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { recordError } from "@/lib/monitoring/errors"

export const dynamic = "force-dynamic"

/**
 * Where browsers send the errors they catch (`reportClientError`). Records one
 * `ErrorEvent` with source "client", shown on Monitoring.
 *
 * Signed-out callers are accepted on purpose: crew use the store checks page
 * at /checks/<code> without an account, and it is the page most worth hearing
 * from. The guards are the ones the page-view beacon uses — same-origin only,
 * a size-capped schema, a per-IP ceiling — and a reply that is always 204, so
 * the endpoint tells a caller nothing and never reports a failure of its own.
 */
const LIMIT = { limit: 20, windowMs: 60_000, identifyBy: "ip" as const }

const bodySchema = z.object({
  kind: z.string().min(1).max(40),
  path: z.string().min(1).max(300),
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).nullable().optional(),
  digest: z.string().max(100).nullable().optional(),
})

const NO_CONTENT = () => new NextResponse(null, { status: 204 })

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const limited = await rateLimit(req, LIMIT)
    if (limited) return NO_CONTENT()

    const fetchSite = req.headers.get("sec-fetch-site")
    if (fetchSite && fetchSite !== "same-origin") return NO_CONTENT()

    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return NO_CONTENT()
    const { kind, path, message, stack, digest } = parsed.data
    if (!path.startsWith("/")) return NO_CONTENT()

    const session = await getServerSession(authOptions)

    await recordError({
      source: "client",
      route: path.split(/[?#]/)[0]!,
      message,
      stack: stack ?? null,
      userId: session?.user?.id ?? null,
      metadata: {
        kind,
        digest: digest ?? null,
        userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? null,
      },
    })
  } catch (err) {
    console.error("[client-error] dropped", err)
  }
  return NO_CONTENT()
}
