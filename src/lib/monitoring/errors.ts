import { prisma } from "@/lib/prisma"
import type { NextRequest, NextResponse } from "next/server"

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
        metadata: (args.metadata ?? null) as never,
      },
    })
  } catch (err) {
    console.error("[record-error] write failed", err)
  }
}

type RouteHandler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse> | Promise<Response>

/**
 * Wrap a route handler. Catches uncaught throws, persists to ErrorEvent, re-throws
 * so Next still returns a 500. Apply selectively — not blanket.
 */
export function withApiHandler(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      await recordError({
        source: "api",
        route: new URL(req.url).pathname,
        method: req.method,
        status: 500,
        message,
        stack,
      })
      throw err
    }
  }
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
