import { withUsageCount } from "@/lib/usage/prisma-count"
import { PrismaClient } from "@/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { getPgPool } from "@/lib/prisma"

/**
 * Prisma client alias for the chat layer. Points at the same DATABASE_URL
 * as `src/lib/prisma.ts`. The named export documents intent ("this is a
 * chat-layer query") and lets the chat tools' import surface stay stable
 * if we ever reintroduce a dedicated read replica.
 *
 * Shares the main pg pool (`getPgPool`) and reuses the same global cache pattern as `src/lib/prisma.ts` to avoid
 * exhausting Postgres connections on Next.js dev hot-reloads.
 */

const globalForChatPrisma = globalThis as unknown as {
  chatPrisma: PrismaClient | undefined
}

const createChatPrismaClient = () => {
  // Same pool as `prisma`, so the chat layer adds no connections of its own
  // (docs/query-rules.md rule 12). The main client owns and ends the pool.
  const adapter = new PrismaPg(getPgPool())
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })
}

export const chatPrisma =
  globalForChatPrisma.chatPrisma ?? withUsageCount(createChatPrismaClient())

if (process.env.NODE_ENV !== "production") {
  globalForChatPrisma.chatPrisma = chatPrisma
}
