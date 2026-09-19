import {
  canonicalizeUnit,
  resolveYieldQuantity,
  unitsCompatibleWith,
} from "@/lib/unit-conversion"

/**
 * The one gate every recipe write goes through.
 *
 * ## Why it is here and not inside `recipe-actions.ts`
 *
 * It used to be, as a private `validateIngredients`, and exactly one write
 * path called it. The other — accepting an AI mapping proposal, which is the
 * only way an owner could create a recipe at all — wrote straight to
 * `recipeIngredient.createMany` with whatever the model produced. There is no
 * database CHECK on `RecipeIngredient.quantity` either, so that path was the
 * product's only create route and its only unvalidated one. Shared rules live
 * in a shared module; a rule that only one of two callers remembers is not a
 * rule.
 *
 * This module is deliberately NOT `"use server"`. It exports a plain function
 * and a type, both of which a server-action module may not export, and both
 * callers import it directly.
 *
 * ## What it now checks that it did not
 *
 * **Units that cannot convert.** A line reading `2 cup` against an ingredient
 * priced per `lb` used to save happily and then cost $0.00 on every recosting
 * for the life of the recipe — mass and volume never bridge, the walk returns
 * a null conversion, and the plate still reports COSTED as long as one other
 * line priced. Refusing it at save is the only place the owner is present to
 * fix it. Ingredients with no `recipeUnit` at all are exempt: there is nothing
 * to judge the line against, and refusing on no evidence would block editing
 * recipes that are fine.
 *
 * **Sub-recipe lines that cannot be measured against the batch.** Same rule,
 * different target: a line drawing on a batch of `128 fl oz` has to be
 * expressible in fluid ounces.
 *
 * **References that belong to somebody else.** `upsertRecipe` scoped the
 * RECIPE by `accountId` and then wrote whatever ingredient and component ids
 * it was handed. `accountId` is the tenancy boundary (`src/lib/auth-scope.ts`),
 * and it has to hold for the things a recipe points AT, not just the row it
 * writes.
 */

export type RecipeLineForValidation = {
  canonicalIngredientId?: string | null
  componentRecipeId?: string | null
  quantity: number
  unit: string
}

export type RecipeShapeForValidation = {
  /** Omitted on a lines-only save; validated when present. */
  servingSize?: number
  yieldUnit?: string | null
  ingredients: RecipeLineForValidation[]
}

/**
 * The reads `validateRecipeShape` needs. Takes the Prisma client OR a
 * transaction client, so a save can validate against its own uncommitted
 * writes — the same reason `assertNoCycles` takes one.
 */
export type RecipeValidationDb = {
  canonicalIngredient: {
    findMany: (args: {
      where: { id: { in: string[] }; accountId: string }
      select: { id: true; name: true; recipeUnit: true }
    }) => Promise<Array<{ id: string; name: string; recipeUnit: string | null }>>
  }
  recipe: {
    findMany: (args: {
      where: { id: { in: string[] }; accountId: string }
      select: { id: true; itemName: true; yieldUnit: true }
    }) => Promise<Array<{ id: string; itemName: string; yieldUnit: string | null }>>
  }
}

/** Owner-facing. Thrown messages are shown verbatim by `saveRecipeLines`. */
export class RecipeValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RecipeValidationError"
  }
}

const fail = (message: string): never => {
  throw new RecipeValidationError(message)
}

/** "lb, oz, kg or g" — the units an owner may pick, written as a sentence. */
export function listUnits(units: readonly string[]): string {
  if (units.length === 0) return "no unit we recognise"
  if (units.length === 1) return units[0]
  return `${units.slice(0, -1).join(", ")} or ${units[units.length - 1]}`
}

export async function validateRecipeShape(
  input: RecipeShapeForValidation,
  accountId: string,
  db: RecipeValidationDb
): Promise<void> {
  if (input.servingSize !== undefined) {
    if (!isFinite(input.servingSize) || input.servingSize <= 0) {
      fail("A recipe has to make at least some of something — set the yield above zero.")
    }
  }

  if (input.yieldUnit != null && input.yieldUnit.trim() !== "") {
    if (!canonicalizeUnit(input.yieldUnit)) {
      fail(
        `“${input.yieldUnit}” is not a unit we can measure a batch in, so nothing could draw on this recipe. ` +
          `Use a weight, a volume, or leave it blank to count portions.`
      )
    }
  }

  for (const [i, ing] of input.ingredients.entries()) {
    const hasCanonical = !!ing.canonicalIngredientId
    const hasComponent = !!ing.componentRecipeId
    if (hasCanonical === hasComponent) {
      fail(`Line ${i + 1} has to be either an ingredient or another recipe, not both and not neither.`)
    }
    if (!isFinite(ing.quantity) || ing.quantity <= 0) {
      fail(`Line ${i + 1} needs a quantity above zero.`)
    }
    if (!ing.unit?.trim()) {
      fail(`Line ${i + 1} needs a unit.`)
    }
  }

  const canonicalIds = [
    ...new Set(input.ingredients.map((l) => l.canonicalIngredientId).filter((v): v is string => !!v)),
  ]
  const componentIds = [
    ...new Set(input.ingredients.map((l) => l.componentRecipeId).filter((v): v is string => !!v)),
  ]

  const [canonicals, components] = await Promise.all([
    canonicalIds.length > 0
      ? db.canonicalIngredient.findMany({
          where: { id: { in: canonicalIds }, accountId },
          select: { id: true, name: true, recipeUnit: true },
        })
      : Promise.resolve([]),
    componentIds.length > 0
      ? db.recipe.findMany({
          where: { id: { in: componentIds }, accountId },
          select: { id: true, itemName: true, yieldUnit: true },
        })
      : Promise.resolve([]),
  ])

  const canonicalById = new Map(canonicals.map((c) => [c.id, c]))
  const componentById = new Map(components.map((r) => [r.id, r]))

  for (const [i, ing] of input.ingredients.entries()) {
    if (ing.canonicalIngredientId) {
      const canonical = canonicalById.get(ing.canonicalIngredientId)
      if (!canonical) {
        fail(`Line ${i + 1} points at an ingredient that is not in your pantry.`)
        continue
      }
      // No recipe unit means nothing to check against — the walk falls back to
      // the raw invoice unit, and refusing here on no evidence would block
      // editing recipes that are already fine.
      if (!canonical.recipeUnit) continue
      const options = unitsCompatibleWith(canonical.recipeUnit)
      const ok =
        options.length > 0
          ? options.includes(canonicalizeUnit(ing.unit) as (typeof options)[number])
          : ing.unit.trim().toLowerCase() === canonical.recipeUnit.trim().toLowerCase()
      if (!ok) {
        fail(
          `${canonical.name} is priced per ${canonical.recipeUnit}, so line ${i + 1} cannot be measured in ${ing.unit}. ` +
            `Use ${listUnits(options.length > 0 ? options : [canonical.recipeUnit])}.`
        )
      }
      continue
    }

    if (ing.componentRecipeId) {
      const component = componentById.get(ing.componentRecipeId)
      if (!component) {
        fail(`Line ${i + 1} points at a recipe that is not in this account.`)
        continue
      }
      const resolved = resolveYieldQuantity({
        quantity: ing.quantity,
        unit: ing.unit,
        yieldUnit: component.yieldUnit,
      })
      if (resolved == null) {
        const options = unitsCompatibleWith(component.yieldUnit)
        fail(
          component.yieldUnit
            ? `${component.itemName} is made in batches measured in ${component.yieldUnit}, so line ${i + 1} cannot be ` +
                `measured in ${ing.unit}. Use ${listUnits(options.length > 0 ? options : [component.yieldUnit])}.`
            : `${component.itemName} is counted in servings, so line ${i + 1} cannot be measured in ${ing.unit}. ` +
                `Use servings.`
        )
      }
    }
  }
}
