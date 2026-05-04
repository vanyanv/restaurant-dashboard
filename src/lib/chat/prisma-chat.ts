import { PrismaClient } from "@/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

/**
 * Prisma client alias for the chat layer. Points at the same DATABASE_URL
 * as `src/lib/prisma.ts`. The named export documents intent ("this is a
 * chat-layer query") and lets the chat tools' import surface stay stable
 * if we ever reintroduce a dedicated read replica.
 *
 * Reuses the same global cache pattern as `src/lib/prisma.ts` to avoid
 * exhausting Postgres connections on Next.js dev hot-reloads.
 */

const globalForChatPrisma = globalThis as unknown as {
  chatPrisma: PrismaClient | undefined
}

const stripSslMode = (raw: string): string => {
  try {
    const url = new URL(raw)
    url.searchParams.delete("sslmode")
    return url.toString()
  } catch {
    return raw
  }
}

const createChatPrismaClient = () => {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error("chat-prisma: DATABASE_URL is not set")
  }
  const adapter = new PrismaPg({
    connectionString: stripSslMode(url),
    ssl: true,
  })
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })
}

export const chatPrisma =
  globalForChatPrisma.chatPrisma ?? createChatPrismaClient()

if (process.env.NODE_ENV !== "production") {
  globalForChatPrisma.chatPrisma = chatPrisma
}
