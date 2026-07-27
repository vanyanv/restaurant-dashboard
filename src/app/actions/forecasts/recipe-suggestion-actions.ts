"use server"

// F28 — Auto-completing recipe builder, session wrapper. All computation
// lives in src/lib/recipe-suggestions-core.ts (session-free, so the
// proposals cron can call it too); this action only resolves the session
// and scopes the call to the caller's account.

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { computeRecipeSuggestions } from "@/lib/recipe-suggestions-core"

export type {
  RecipeSuggestionConfidence,
  RecipeCandidate,
  UnmappedItem,
  RecipeSuggestionData,
  GetRecipeSuggestionResult,
} from "@/lib/recipe-suggestions-core"
import type { GetRecipeSuggestionResult } from "@/lib/recipe-suggestions-core"

interface SessionUser {
  id: string
  accountId: string
}
interface SessionLike {
  user?: SessionUser | null
}

export async function getRecipeSuggestions(input: {
  storeId?: string
  lookbackDays?: number
  asOf?: Date
}): Promise<GetRecipeSuggestionResult | null> {
  const session = (await getServerSession(authOptions)) as SessionLike | null
  const user = session?.user ?? null
  if (!user) return null

  return computeRecipeSuggestions({
    accountId: user.accountId,
    storeId: input.storeId,
    lookbackDays: input.lookbackDays,
    asOf: input.asOf,
  })
}
