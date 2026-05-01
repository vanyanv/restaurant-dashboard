import { z } from "zod"
import { listOwnerStores } from "@/lib/chat/owner-scope"
import type { ChatTool } from "./types"

const parameters = z.object({}).strict()

export const listStores: ChatTool<
  typeof parameters,
  Array<{ id: string; name: string; address: string | null }>
> = {
  name: "listStores",
  description:
    "Returns every active store owned by the authenticated user. Use this when the user asks what stores they run, asks about all stores, or names a location that is not already clear from the prompt context (for example Hollywood, Glendale, or Van Nuys). Never expose UUIDs in the user-facing answer.",
  parameters,
  async execute(_args, ctx) {
    return listOwnerStores(ctx.accountId)
  },
}
