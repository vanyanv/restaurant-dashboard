"use server"

import {
  confirmRecipe,
  deleteRecipe,
  previewRecipeCost,
  upsertRecipe,
} from "@/app/actions/recipe-actions"
import { prisma } from "@/lib/prisma"

/**
 * The Counter layer's WRITE path — and the first one it has ever had.
 *
 * ## Why this file exists at all
 *
 * All 22 Counter pages built before this one are read-only. Reads already
 * have a shape: a page calls `src/lib/counter/adapters/*`, and the adapter —
 * not the page — is what imports `@/app/actions/*` and Prisma. That is
 * enforced, not conventional: `scripts/counter-lint.ts`' `no-direct-data-import`
 * fails any `.tsx` under a Counter path that imports `@/lib/prisma`,
 * `@prisma/client` or `@/app/actions/…`, and exempts only
 * `lib/counter/adapters/`.
 *
 * A builder has to write. The client needs `upsertRecipe`, and importing it
 * where the client can reach it is exactly what that rule forbids. So writes
 * get the same shape reads have: this module is to `@/app/actions/recipe-actions`
 * what an adapter is to a read action — the one place the Counter layer
 * touches the app's actions, with the page talking only to the Counter layer.
 *
 * `src/lib/counter/actions/` is a deliberate sibling of `adapters/`, not a
 * loophole. The linter's regex would also pass a page importing
 * `@/app/actions/x` renamed to `@/lib/x`, and that WOULD be a dodge; the test
 * is whether the page still reaches past the Counter layer, and here it does
 * not.
 *
 * ## What it deliberately does not re-implement
 *
 * Nothing. `upsertRecipe` already scopes the update by `accountId` (a bare
 * `update({ where: { id } })` would let any authenticated user overwrite
 * another account's recipe), validates the lines, runs the cycle check INSIDE
 * the transaction so a `RecipeCycleError` rolls the whole save back, and
 * revalidates three paths. Re-deriving any of that here would be a second
 * implementation of a rule that already has one.
 *
 * These wrappers add exactly two things the builder needs and the action does
 * not provide: the recipe's current header fields, so a caller editing only
 * the lines does not have to send a name it never showed the user, and a
 * revalidate of the two Counter recipe routes, which the app action predates.
 */

import { revalidatePath } from "next/cache"

export interface SaveLine {
  canonicalIngredientId?: string | null
  componentRecipeId?: string | null
  ingredientName?: string | null
  quantity: number
  unit: string
}

/** What the live cost panel needs back while somebody is still typing. */
export interface DraftCost {
  /** Cost of one of whatever the recipe yields. */
  perServing: number
  /** What the whole batch comes to. */
  batch: number
  partial: boolean
  /** Per line, in the order they were sent. */
  lines: Array<{ ext: number | null; missing: boolean }>
}

export interface SaveResult {
  ok: boolean
  /** Owner-facing, already written. Null when `ok`. */
  error: string | null
}

/**
 * Persist the recipe's lines and header.
 *
 * Header fields are read from the row when the caller omits them, so a
 * line-only edit cannot blank a name or a category by not mentioning it —
 * `upsertRecipe` takes a whole recipe and writes every field it is given.
 */
export async function saveRecipeLines(input: {
  recipeId: string
  lines: SaveLine[]
  itemName?: string
  category?: string
  servingSize?: number
  yieldUnit?: string | null
  notes?: string | null
  foodCostOverride?: number | null
}): Promise<SaveResult> {
  const current = await prisma.recipe.findUnique({
    where: { id: input.recipeId },
    select: {
      itemName: true, category: true, servingSize: true, notes: true,
      isSellable: true, foodCostOverride: true, yieldUnit: true,
    },
  })
  if (!current) return { ok: false, error: "That recipe no longer exists." }

  try {
    await upsertRecipe({
      id: input.recipeId,
      itemName: input.itemName ?? current.itemName,
      category: input.category ?? current.category,
      servingSize: input.servingSize ?? current.servingSize,
      yieldUnit: input.yieldUnit === undefined ? current.yieldUnit : input.yieldUnit,
      isSellable: current.isSellable,
      notes: input.notes === undefined ? current.notes : input.notes,
      foodCostOverride:
        input.foodCostOverride === undefined ? current.foodCostOverride : input.foodCostOverride,
      ingredients: input.lines.map((l) => ({
        canonicalIngredientId: l.canonicalIngredientId ?? null,
        componentRecipeId: l.componentRecipeId ?? null,
        ingredientName: l.ingredientName ?? null,
        quantity: l.quantity,
        unit: l.unit,
      })),
    })
  } catch (error) {
    // A cycle is the one failure a user can act on, so it is named. Everything
    // else is reported as itself rather than as "something went wrong".
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: message.startsWith("Recipe cycle detected")
        ? "That sub-recipe already contains this one, so adding it would make a loop."
        : message,
    }
  }

  revalidatePath(`/dashboard/recipes/${input.recipeId}`)
  revalidatePath("/dashboard/recipes")
  return { ok: true, error: null }
}

/**
 * Cost the draft under the owner's cursor.
 *
 * The editor's cost panel is server-rendered from the SAVED recipe, and the
 * extended cost on each line was a value the loader produced and nothing ever
 * recomputed — so changing a quantity from 2 to 4 showed the old figure until
 * Save and a refresh. The one question the screen exists to answer could only
 * be answered by committing the change first.
 *
 * Returns nulls rather than throwing: a live figure that disappears for a beat
 * is a worse outcome than a stale one only if it takes the editor down with
 * it, and a draft mid-keystroke is legitimately uncostable.
 */
export async function costDraftRecipe(input: {
  servingSize?: number
  yieldUnit?: string | null
  foodCostOverride?: number | null
  lines: SaveLine[]
}): Promise<DraftCost | null> {
  try {
    const result = await previewRecipeCost({
      servingSize: input.servingSize,
      yieldUnit: input.yieldUnit,
      foodCostOverride: input.foodCostOverride,
      ingredients: input.lines.map((l) => ({
        canonicalIngredientId: l.canonicalIngredientId ?? null,
        componentRecipeId: l.componentRecipeId ?? null,
        quantity: l.quantity,
        unit: l.unit,
      })),
    })
    return {
      perServing: result.totalCost,
      batch: result.batchCost,
      partial: result.partial,
      lines: result.lines.map((l) => ({
        ext: l.missingCost ? null : l.lineCost,
        missing: l.missingCost,
      })),
    }
  } catch {
    return null
  }
}

/** Remove the recipe. Refuses while anything uses it as a sub-recipe. */
export async function removeRecipe(recipeId: string): Promise<SaveResult> {
  try {
    await deleteRecipe(recipeId)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  revalidatePath("/dashboard/recipes")
  return { ok: true, error: null }
}

/** Mark the recipe confirmed. Thin — the app action already scopes and audits. */
export async function markRecipeConfirmed(recipeId: string): Promise<SaveResult> {
  try {
    await confirmRecipe(recipeId, true)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  revalidatePath(`/dashboard/recipes/${recipeId}`)
  revalidatePath("/dashboard/recipes")
  return { ok: true, error: null }
}

/**
 * Start a recipe.
 *
 * Until this existed the product had **no create path an owner could reach**.
 * `upsertRecipe` has always handled a create — `input.id` omitted is a create
 * — and the only caller that ever omitted it was the AI mapping-proposal
 * accept. So a recipe could be born from a model's guess about a POS item
 * name and in no other way; an owner who wanted to add a new dish had to sell
 * it first, wait for the proposal job, and accept what the model wrote.
 *
 * It is deliberately a name and a category and nothing else. The editor is
 * where a recipe is built, and a create form that asked for yield, override
 * and lines up front would be a second, worse copy of it — the thing the
 * audit called the complicated path.
 */
export async function createRecipe(input: {
  itemName: string
  category: string
}): Promise<{ ok: boolean; recipeId: string | null; error: string | null }> {
  const itemName = input.itemName.trim()
  if (!itemName) return { ok: false, recipeId: null, error: "Give the recipe a name." }
  const category = input.category.trim() || "Uncategorized"

  try {
    const { id } = await upsertRecipe({
      itemName,
      category,
      // One portion, counted rather than measured: the ordinary plate. A
      // batch recipe says so in the editor, where the yield pair is.
      servingSize: 1,
      yieldUnit: null,
      isSellable: true,
      notes: null,
      foodCostOverride: null,
      ingredients: [],
    })
    revalidatePath("/dashboard/recipes")
    return { ok: true, recipeId: id, error: null }
  } catch (error) {
    return {
      ok: false,
      recipeId: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
