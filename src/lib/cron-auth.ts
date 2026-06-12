import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { isCronRequest, rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"

/**
 * Auth preamble shared by every /api/cron/** route. Three production
 * flavors, selected via options so each route keeps its exact pre-wrapper
 * status codes and messages:
 *
 *   withCronAuth(handler)                              // cron-only, 401 Unauthorized
 *   withCronAuth(handler, { unauthorized: FORBIDDEN }) // monitoring style, 403 forbidden
 *   withCronAuth(handler, { ownerFallback: {...} })    // cron OR owner session,
 *                                                      // strict-rate-limited manual triggers
 *
 * The bearer check (isCronRequest) is timing-safe and lives in lib/rate-limit.
 */

type CronAuthContext = { fromCron: boolean }

type CronAuthOptions = {
  /**
   * Allow an OWNER/DEVELOPER session as an alternative to the cron bearer
   * (manual trigger from the dashboard). Applies the strict rate-limit tier
   * first — cron bearers bypass it inside rateLimit() itself.
   */
  ownerFallback?: { forbiddenMessage: string }
  /** Shape returned when no auth matches. Default: 401 {error:"Unauthorized"}. */
  unauthorized?: { status: number; error: string }
}

export function withCronAuth(
  handler: (req: NextRequest, ctx: CronAuthContext) => Promise<Response>,
  opts: CronAuthOptions = {}
): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest) => {
    if (opts.ownerFallback) {
      const limited = await rateLimit(req, RATE_LIMIT_TIERS.strict)
      if (limited) return limited
    }

    const fromCron = isCronRequest(req)
    if (!fromCron) {
      if (opts.ownerFallback) {
        const session = await getServerSession(authOptions)
        if (!session?.user) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }
        if (!hasOwnerAccess(session.user.role)) {
          return NextResponse.json(
            { error: opts.ownerFallback.forbiddenMessage },
            { status: 403 }
          )
        }
      } else {
        const { status, error } = opts.unauthorized ?? {
          status: 401,
          error: "Unauthorized",
        }
        return NextResponse.json({ error }, { status })
      }
    }

    return handler(req, { fromCron })
  }
}

/**
 * Strict JSON body parse: returns the parsed value, or a ready-to-return
 * 400 response. Routes that tolerate an empty body should use
 * `req.json().catch(() => ({}))` instead.
 */
export async function parseJsonBody<T>(
  req: NextRequest
): Promise<T | NextResponse> {
  try {
    return (await req.json()) as T
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }
}
