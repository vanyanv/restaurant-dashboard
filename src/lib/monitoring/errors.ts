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
