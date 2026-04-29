import type { z } from "zod"
import type { PrismaClient } from "@/generated/prisma/client"

/**
 * Shared context every chat tool receives. The route handler resolves
 * `ownerId` (the actor) and `accountId` (the tenant boundary used for every
 * data filter) from the authenticated session and passes its own `prisma`
 * client. Tools must never accept an `ownerId`/`accountId` from the model —
 * every scope check is rooted in this context.
 */
export interface ChatToolContext {
  ownerId: string
  accountId: string
  prisma: PrismaClient
}

export interface ChatTool<Schema extends z.ZodTypeAny, Result> {
  name: string
  description: string
  parameters: Schema
  execute: (args: z.infer<Schema>, ctx: ChatToolContext) => Promise<Result>
}
