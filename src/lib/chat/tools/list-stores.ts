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
    "Returns every active store owned by the authenticated user. Use this when the user names a store ('Bay Ridge', 'the downtown one') and you need its UUID for a follow-up tool call. Never expose UUIDs in the user-facing answer.",
  parameters,
  async execute(_args, ctx) {
    return listOwnerStores(ctx.ownerId)
  },
}
