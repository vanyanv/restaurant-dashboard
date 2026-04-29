import { PrismaClient } from "@/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

/**
 * Prisma client for the chat layer. Points at `DATABASE_URL2` when set —
 * the dedicated Neon branch that hosts the chat schema (Conversation,
 * Message, ToolCall, InvoiceLineEmbedding, MenuItemEmbedding) plus a clone
 * of the source data tables (Invoice, OtterDailySummary, …).
 *
 * Falls back to `DATABASE_URL` when URL2 isn't set, so we degrade
 * gracefully in environments that don't separate the chat layer.
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
  const url = process.env.DATABASE_URL2 ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error("chat-prisma: neither DATABASE_URL2 nor DATABASE_URL is set")
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
