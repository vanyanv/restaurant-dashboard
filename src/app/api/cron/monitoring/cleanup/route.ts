import { NextResponse } from "next/server"
import { withCronAuth } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"

export const maxDuration = 60

const RETENTION_DAYS = 90

export const POST = withCronAuth(
  async () => {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000)
    // ChatTurn.aiUsageEventId is onDelete: SetNull, so an AiUsageEvent deleted
    // out from under a still-in-window ChatTurn would silently null its link.
    // Delete ChatTurn first to keep the join intact for in-window rows.
    const chat = await prisma.chatTurn.deleteMany({ where: { occurredAt: { lt: cutoff } } })
    const [jobRun, ai, err, cache, snapshot, vercel, login, r2] = await Promise.all([
      prisma.jobRun.deleteMany({ where: { startedAt: { lt: cutoff } } }),
      prisma.aiUsageEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
      prisma.errorEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
      prisma.cacheStat.deleteMany({ where: { hourBucket: { lt: cutoff } } }),
      prisma.dbSnapshot.deleteMany({ where: { date: { lt: cutoff } } }),
      prisma.vercelUsageSnapshot.deleteMany({ where: { capturedAt: { lt: cutoff } } }),
      prisma.loginEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }),
      prisma.r2BucketSnapshot.deleteMany({ where: { capturedAt: { lt: cutoff } } }),
    ])
    return NextResponse.json({
      cutoff: cutoff.toISOString(),
      deleted: {
        jobRun: jobRun.count,
        aiUsageEvent: ai.count,
        errorEvent: err.count,
        chatTurn: chat.count,
        cacheStat: cache.count,
        dbSnapshot: snapshot.count,
        vercelUsageSnapshot: vercel.count,
        loginEvent: login.count,
        r2BucketSnapshot: r2.count,
      },
    })
  },
  { unauthorized: { status: 403, error: "forbidden" } }
)
