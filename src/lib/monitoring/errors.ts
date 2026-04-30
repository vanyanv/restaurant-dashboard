import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"

export type ErrorSource = "api" | "server-action" | "cron" | "client" | "alerter" | "cache" | "uncaught"

/**
 * Persist one error. Never throws; logs and swallows internal failures so the
 * recorder cannot itself crash the caller.
 */
export async function recordError(args: {
  source: ErrorSource
  route?: string | null
  method?: string | null
  status?: number | null
  message: string
  stack?: string | null
  userId?: string | null
  storeId?: string | null
  metadata?: Record<string, unknown> | null
}): Promise<void> {
  try {
    await prisma.errorEvent.create({
      data: {
        source: args.source,
        route: args.route ?? null,
        method: args.method ?? null,
        status: args.status ?? null,
        message: args.message.slice(0, 8000),
        stack: args.stack?.slice(0, 16000) ?? null,
        userId: args.userId ?? null,
        storeId: args.storeId ?? null,
        metadata: args.metadata ? (args.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    })
  } catch (err) {
    console.error("[record-error] write failed", err)
  }
}

type AnyHandler = (...args: never[]) => Promise<Response>

/**
 * Wrap a route handler. Catches uncaught throws, persists to ErrorEvent, re-throws
 * so Next still returns a 500. Apply selectively — not blanket. The wrapper
 * preserves the wrapped handler's exact signature so it works for any of the
 * project's route shapes (Request vs NextRequest, with-ctx vs no-ctx).
 */
export function withApiHandler<H extends AnyHandler>(handler: H): H {
  const wrapped = (async (...args: Parameters<H>): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      const req = args[0] as Request | undefined
      let route: string | null = null
      let method: string | null = null
      if (req && typeof req === "object" && "url" in req) {
        try { route = new URL((req as Request).url).pathname } catch {}
        if ("method" in req) method = (req as Request).method
      }
      await recordError({
        source: "api",
        route,
        method,
        status: 500,
        message,
        stack,
      })
      throw err
    }
  }) as H
  return wrapped
}

/**
 * Wrap a server action. Same shape as withApiHandler, no req/res — caller
 * passes a logical action name.
 */
export function withServerAction<TArgs extends unknown[], TReturn>(
  actionName: string,
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs) => {
    try {
      return await fn(...args)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      await recordError({
        source: "server-action",
        route: actionName,
        message,
        stack,
      })
      throw err
    }
  }
}
