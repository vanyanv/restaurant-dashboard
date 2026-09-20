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
  /**
   * The tools this turn is actually offering, or null for all of them.
   *
   * Only `describeSchema` reads it, and it has to: the catalogue is what the
   * model consults before it is allowed to say a question cannot be answered,
   * so a catalogue listing tools the turn cannot call sends it looking for a
   * schema that is not in its menu. Not a permission boundary — every tool
   * still scopes its own `execute` — just the honest answer to "what can you
   * reach right now?".
   */
  activeTools?: readonly string[] | null
}

export interface ChatTool<Schema extends z.ZodTypeAny, Result> {
  name: string
  description: string
  parameters: Schema
  execute: (args: z.infer<Schema>, ctx: ChatToolContext) => Promise<Result>
}
