import { z } from "zod"
import { listOwnerStores, type OwnerStoreRow } from "@/lib/chat/owner-scope"
import type { ChatTool } from "./types"

const parameters = z.object({}).strict()

export const listStores: ChatTool<typeof parameters, OwnerStoreRow[]> = {
  name: "listStores",
  description:
    "Returns every active store owned by the authenticated user, with each store's lifecycle stage, opening date and COGS target. Use this when the user asks what stores they run, asks about all stores, or names a location that is not already clear from the prompt context (for example Hollywood, Glendale, or Van Nuys). Also use it before reporting that a forecast is missing: lifecycleStage 'pre_open' means the store trains no forecasts and 'warming_up' means its forecasts are borrowed from a comparable store, so an empty forecast for either is expected rather than a fault. Never expose UUIDs in the user-facing answer.",
  parameters,
  async execute(_args, ctx) {
    const stores = await listOwnerStores(ctx.accountId)
    // The cached row is a whole `Store`. Project it here so the model is sent
    // the five fields it can act on and not the forty it cannot, including the
    // commission rates and the geocoding columns.
    return stores.map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      lifecycleStage: s.lifecycleStage,
      openedAt: s.openedAt,
      targetCogsPct: s.targetCogsPct,
    }))
  },
}
