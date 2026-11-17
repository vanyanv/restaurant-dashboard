import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { recordError } from "@/lib/monitoring/errors"
import { createDedupe, ERROR_DEDUPE_MS } from "@/lib/monitoring/error-dedupe"

export const dynamic = "force-dynamic"

/**
 * Where browsers send the errors they catch (`reportClientError`). Records one
 * `ErrorEvent` with source "client", shown on Monitoring.
 *
 * Signed-out callers are accepted on purpose: crew use the store checks page
 * at /checks/<code> without an account, and it is the page most worth hearing
 * from. The guards: same-origin only (Sec-Fetch-Site, or a matching Origin
 * when a browser omits it), a body cap before parsing, a size-capped schema,
 * a per-IP ceiling, one row per distinct error per ten minutes and at most
 * 60 rows a minute per instance. The reply is always 204, so the endpoint
 * tells a caller nothing and never reports a failure of its own.
 */
const LIMIT = { limit: 20, windowMs: 60_000, identifyBy: "ip" as const }
/** Larger than the schema allows (2 KB message + 8 KB stack + fields); refused before parsing. */
const MAX_BODY_BYTES = 12_000
/** Rows this server instance writes per minute, whoever sends them. */
const INSTANCE_PER_MINUTE = 60

// The same fault on many phones is one row per ten minutes, not one per phone.
const shouldRecord = createDedupe(ERROR_DEDUPE_MS)
let windowStart = 0
let writtenInWindow = 0
function underInstanceCap(now = Date.now()): boolean {
  if (now - windowStart >= 60_000) {
    windowStart = now
    writtenInWindow = 0
  }
  return ++writtenInWindow <= INSTANCE_PER_MINUTE
}

/** Same-origin only: a browser says so in Sec-Fetch-Site; otherwise Origin must name this host. */
function isSameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site")
  if (site) return site === "same-origin"
  const origin = req.headers.get("origin")
  if (!origin) return false
  try {
    return new URL(origin).host === new URL(req.url).host
  } catch {
    return false
  }
}

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

    if (!isSameOrigin(req)) return NO_CONTENT()
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return NO_CONTENT()
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) return NO_CONTENT()

    const parsed = bodySchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return NO_CONTENT()
    const { kind, path, message, stack, digest } = parsed.data
    if (!path.startsWith("/")) return NO_CONTENT()
    const route = path.split(/[?#]/)[0]!
    if (!shouldRecord(`${route}|${message}`)) return NO_CONTENT()
    if (!underInstanceCap()) return NO_CONTENT()

    const session = await getServerSession(authOptions)

    await recordError({
      source: "client",
      route,
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
