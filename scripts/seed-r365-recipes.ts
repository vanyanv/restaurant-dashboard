// scripts/seed-r365-recipes.ts
// One-time import of R365 recipe data for Chris N Eddy's Hollywood.
// Run with: npx tsx scripts/seed-r365-recipes.ts
// Idempotent: uses upsert on (storeId, itemName, category).

import fs from "fs"
import path from "path"

// --- Load .env.local BEFORE dynamic imports that read process.env ---
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) {
      process.env[key] = val
    }
  }
}

loadEnvLocal()

const HOLLYWOOD_STORE_ID = "cmexd4zia0001jr04ljkdt9na"

// ─── R365 Unit → Supported Unit mapping ───

interface UnitMapping {
  unit: string
  factor: number // multiply R365 qty by this to get target unit qty
}

function mapUnit(r365Unit: string): UnitMapping {
  switch (r365Unit) {
    case "Each":
    case "CT":
      return { unit: "EA", factor: 1 }
    case "OZ-wt":
    case "OZ-fl":
      return { unit: "OZ", factor: 1 }
    case "LB":
      return { unit: "LB", factor: 1 }
    case "Gallon":
      return { unit: "GAL", factor: 1 }
    case "Cup":
      return { unit: "OZ", factor: 8 } // 1 cup = 8 fl oz
    case "#10 Can":
      return { unit: "EA", factor: 1 }
    case "Gram":
      return { unit: "OZ", factor: 0.03527 }
    case "Pack (1 LB)":
      return { unit: "LB", factor: 1 }
    default:
      return { unit: "EA", factor: 1 }
  }
}

// ─── Strip R365 prefix from ingredient names ───
// "GROC Ketchup Bulk" → "Ketchup Bulk"
// "DAIRY Cheese American" → "Cheese American"

const R365_PREFIXES = ["GROC ", "DAIRY ", "MEAT ", "PROD ", "BAKE ", "PAPER ", "BATCH ", "MENU "]

function stripPrefix(name: string): string {
  for (const prefix of R365_PREFIXES) {
    if (name.startsWith(prefix)) {
      return name.slice(prefix.length)
    }
  }
  return name
}

// ─── BATCH sub-recipe definitions (for flattening) ───
// Chris N Eddy's Sauce is now PURCHASED, not made in-house — treated as a direct ingredient.

interface R365Ingredient {
  item: string      // raw R365 ingredient name
  qty: number
  unit: string      // R365 unit
  yieldPct: number  // 100 = 100%
}

// Batch: Diced Raw Onion → yields 7.13 gal (912.64 OZ-fl) from 40 LB onions
const BATCH_DICED_RAW_ONION: R365Ingredient[] = [
  { item: "PROD Onion", qty: 40, unit: "LB", yieldPct: 100 },
]
const DICED_ONION_YIELD_OZ = 7.13 * 128 // 7.13 gallons in OZ

// Batch: Grilled Onion → yields 2.38 gal (304.64 OZ-fl) from 1 batch diced onion + 4 LB butter
const BATCH_GRILLED_ONION: R365Ingredient[] = [
  // Expanding "1 CT of BATCH Diced Raw Onion" = all of its ingredients
  ...BATCH_DICED_RAW_ONION,
  { item: "DAIRY Butter", qty: 4, unit: "Pack (1 LB)", yieldPct: 100 },
]
const GRILLED_ONION_YIELD_OZ = 2.38 * 128 // 2.38 gallons in OZ

// Helper: expand grilled onion sub-recipe reference into proportional raw ingredients
function expandGrilledOnion(ozUsed: number): Array<{ item: string; qty: number; unit: string }> {
  const fraction = ozUsed / GRILLED_ONION_YIELD_OZ
  return BATCH_GRILLED_ONION.map((ing) => ({
    item: ing.item,
    qty: ing.qty * fraction,
    unit: ing.unit,
  }))
}

// ─── MENU recipe definitions ───

interface R365Recipe {
  name: string
  foodCost: number
  ingredients: R365Ingredient[]
  // Sub-recipe references that need expansion
  batchRefs?: Array<{ batch: "grilled_onion"; qty: number; unit: string }>
  // Explicit Otter name/category mapping (overrides auto-matching)
  otterName?: string
  otterCategory?: string
}

const MENU_RECIPES: R365Recipe[] = [
  // ── Sliders ──
  {
    name: "Chris N Eddy's Single Slider",
    otterName: "Single Slider",
    otterCategory: "A La Carte",
    foodCost: 0.90,
    ingredients: [
      { item: "BAKE Slider Bun", qty: 1, unit: "Each", yieldPct: 100 },
      { item: "DAIRY Cheese American", qty: 1, unit: "Each", yieldPct: 100 },
      { item: "MEAT Beef Ground", qty: 1, unit: "Each", yieldPct: 100 },
    ],
  },
  {
    name: "Chris N Eddy's Double Slider",
    otterName: "Double Slider",
    otterCategory: "A La Carte",
    foodCost: 4.01,
    ingredients: [
      { item: "BAKE Slider Bun", qty: 1, unit: "Each", yieldPct: 100 },
      { item: "Chris N Eddy's Sauce", qty: 1.2, unit: "OZ-fl", yieldPct: 100 },
      { item: "DAIRY Butter", qty: 10, unit: "Gram", yieldPct: 100 },
      { item: "DAIRY Cheese American", qty: 2, unit: "Each", yieldPct: 100 },
      { item: "MEAT Beef Ground", qty: 3, unit: "OZ-wt", yieldPct: 100 },
      { item: "PROD Lettuce", qty: 0.07, unit: "CT", yieldPct: 100 },
      { item: "PROD Tomato", qty: 0.80, unit: "OZ-wt", yieldPct: 100 },
    ],
    batchRefs: [{ batch: "grilled_onion", qty: 2, unit: "OZ-fl" }],
  },
  {
    name: "Chris N Eddy's Triple Slider",
    otterName: "Triple Slider",
    otterCategory: "A La Carte",
    foodCost: 4.59,
    ingredients: [
      { item: "BAKE Slider Bun", qty: 1, unit: "Each", yieldPct: 100 },
      { item: "Chris N Eddy's Sauce", qty: 1.2, unit: "OZ-fl", yieldPct: 100 },
      { item: "DAIRY Butter", qty: 10, unit: "Gram", yieldPct: 100 },
      { item: "DAIRY Cheese American", qty: 3, unit: "Each", yieldPct: 100 },
      { item: "MEAT Beef Ground", qty: 4.5, unit: "OZ-wt", yieldPct: 100 },
      { item: "PROD Lettuce", qty: 0.07, unit: "CT", yieldPct: 100 },
      { item: "PROD Tomato", qty: 0.80, unit: "OZ-wt", yieldPct: 100 },
    ],
    batchRefs: [{ batch: "grilled_onion", qty: 2, unit: "OZ-fl" }],
  },
  {
    name: "Chris N Eddy's Quad",
    otterName: "The Quad",
    otterCategory: "Secret Menu",
    foodCost: 5.17,
    ingredients: [
      { item: "BAKE Slider Bun", qty: 1, unit: "Each", yieldPct: 100 },
      { item: "Chris N Eddy's Sauce", qty: 1.2, unit: "OZ-fl", yieldPct: 100 },
      { item: "DAIRY Butter", qty: 10, unit: "Gram", yieldPct: 100 },
      { item: "DAIRY Cheese American", qty: 4, unit: "Each", yieldPct: 100 },
      { item: "MEAT Beef Ground", qty: 6, unit: "OZ-wt", yieldPct: 100 },
      { item: "PROD Lettuce", qty: 0.07, unit: "CT", yieldPct: 100 },
      { item: "PROD Tomato", qty: 0.80, unit: "OZ-wt", yieldPct: 100 },
    ],
    batchRefs: [{ batch: "grilled_onion", qty: 2, unit: "OZ-fl" }],
  },

  // ── Sauce ──
  {
    name: "Chris N Eddy's Sauce Cup",
    otterName: "Extra Chris N Eddy's Sauce",
    otterCategory: "On The Side",
    foodCost: 0.38,
    ingredients: [
      { item: "Chris N Eddy's Sauce", qty: 2.8, unit: "OZ-fl", yieldPct: 100 },
      { item: "PAPER Cup Portion 3.25-5.5oz", qty: 1, unit: "Each", yieldPct: 100 },
      { item: "PAPER Lid Portion 3.25-5.5oz", qty: 1, unit: "Each", yieldPct: 100 },
    ],
  },

  // ── Fries ──
  {
    name: "Classic Fries",
    otterName: "Straight Cut Fries",
    otterCategory: "A La Carte",
    foodCost: 0.68,
    ingredients: [
      { item: "GROC Fries", qty: 8, unit: "OZ-wt", yieldPct: 100 },
      { item: "GROC Salt Iodized", qty: 0.10, unit: "Gram", yieldPct: 100 },
      { item: "PAPER Fry Boat", qty: 1, unit: "CT", yieldPct: 100 },
    ],
  },
  {
    name: "Cheese Fries",
    otterName: "Cheese Fries",
    otterCategory: "A La Carte",
    foodCost: 0.94,
    ingredients: [
      { item: "DAIRY Cheese American", qty: 2, unit: "CT", yieldPct: 100 },
      { item: "GROC Fries", qty: 8, unit: "OZ-wt", yieldPct: 100 },
      { item: "PAPER Fry Boat", qty: 1, unit: "CT", yieldPct: 100 },
    ],
  },
  {
    name: "Loaded Fries",
    otterName: "Loaded Fries",
    otterCategory: "A La Carte",
    foodCost: 1.81,
    ingredients: [
      { item: "Chris N Eddy's Sauce", qty: 3, unit: "OZ-fl", yieldPct: 100 },
      { item: "DAIRY Cheese American", qty: 2, unit: "CT", yieldPct: 100 },
      { item: "GROC Fries", qty: 8, unit: "OZ-wt", yieldPct: 100 },
      { item: "PAPER Fry Boat", qty: 1, unit: "CT", yieldPct: 100 },
    ],
    batchRefs: [{ batch: "grilled_onion", qty: 3, unit: "OZ-fl" }],
  },

  // ── Other ──
  {
    name: "Grilled Cheese",
    otterName: "Grilled Cheese",
    otterCategory: "On The Side",
    foodCost: 0.81,
    ingredients: [
      { item: "BAKE Slider Bun", qty: 1, unit: "CT", yieldPct: 100 },
      { item: "DAIRY Butter", qty: 1, unit: "OZ-wt", yieldPct: 100 },
      { item: "DAIRY Cheese American", qty: 2, unit: "CT", yieldPct: 100 },
    ],
  },

  // ── Combos ──
  // Combo 1: 1× Double Slider + 1× Classic Fries + 1× Sauce Cup + packaging
  {
    name: "Combo 1",
    otterName: "1 Slider Combo",
    otterCategory: "Combos",
    foodCost: 5.31,
    ingredients: [
      // Double slider ingredients (inline)
      { item: "BAKE Slider Bun", qty: 1, unit: "Each", yieldPct: 100 },
      { item: "Chris N Eddy's Sauce", qty: 1.2, unit: "OZ-fl", yieldPct: 100 },
      { item: "DAIRY Butter", qty: 10, unit: "Gram", yieldPct: 100 },
      { item: "DAIRY Cheese American", qty: 2, unit: "Each", yieldPct: 100 },
      { item: "MEAT Beef Ground", qty: 3, unit: "OZ-wt", yieldPct: 100 },
      { item: "PROD Lettuce", qty: 0.07, unit: "CT", yieldPct: 100 },
      { item: "PROD Tomato", qty: 0.80, unit: "OZ-wt", yieldPct: 100 },
      // Classic fries ingredients
      { item: "GROC Fries", qty: 8, unit: "OZ-wt", yieldPct: 100 },
      { item: "GROC Salt Iodized", qty: 0.10, unit: "Gram", yieldPct: 100 },
      { item: "PAPER Fry Boat", qty: 1, unit: "CT", yieldPct: 100 },
      // Sauce cup ingredients
      { item: "Chris N Eddy's Sauce", qty: 2.8, unit: "OZ-fl", yieldPct: 100 },
      { item: "PAPER Cup Portion 3.25-5.5oz", qty: 1, unit: "Each", yieldPct: 100 },
      { item: "PAPER Lid Portion 3.25-5.5oz", qty: 1, unit: "Each", yieldPct: 100 },
      // Packaging
      { item: "GROC Ketchup Packet", qty: 2, unit: "CT", yieldPct: 100 },
      { item: "PAPER Bag Plastic Takeout", qty: 0.75, unit: "CT", yieldPct: 100 },
      { item: "PAPER Container Takeout Medium", qty: 0.75, unit: "Each", yieldPct: 100 },
      { item: "PAPER Napkins", qty: 5, unit: "Each", yieldPct: 100 },
    ],
    batchRefs: [{ batch: "grilled_onion", qty: 2, unit: "OZ-fl" }],
  },
  // Combo 2: 2× Double Slider + 1× Classic Fries + 1× Sauce Cup + packaging
  {
    name: "Combo 2",
    otterName: "2 Slider Combo",
    otterCategory: "Combos",
    foodCost: 9.32,
    ingredients: [
      // 2× Double slider ingredients
      { item: "BAKE Slider Bun", qty: 2, unit: "Each", yieldPct: 100 },
      { item: "Chris N Eddy's Sauce", qty: 2.4, unit: "OZ-fl", yieldPct: 100 },
      { item: "DAIRY Butter", qty: 20, unit: "Gram", yieldPct: 100 },
      { item: "DAIRY Cheese American", qty: 4, unit: "Each", yieldPct: 100 },
      { item: "MEAT Beef Ground", qty: 6, unit: "OZ-wt", yieldPct: 100 },
      { item: "PROD Lettuce", qty: 0.14, unit: "CT", yieldPct: 100 },
      { item: "PROD Tomato", qty: 1.60, unit: "OZ-wt", yieldPct: 100 },
      // Classic fries
      { item: "GROC Fries", qty: 8, unit: "OZ-wt", yieldPct: 100 },
      { item: "GROC Salt Iodized", qty: 0.10, unit: "Gram", yieldPct: 100 },
      { item: "PAPER Fry Boat", qty: 1, unit: "CT", yieldPct: 100 },
      // Sauce cup
      { item: "Chris N Eddy's Sauce", qty: 2.8, unit: "OZ-fl", yieldPct: 100 },
      { item: "PAPER Cup Portion 3.25-5.5oz", qty: 1, unit: "Each", yieldPct: 100 },
      { item: "PAPER Lid Portion 3.25-5.5oz", qty: 1, unit: "Each", yieldPct: 100 },
      // Packaging
      { item: "GROC Ketchup Packet", qty: 2, unit: "CT", yieldPct: 100 },
      { item: "PAPER Bag Plastic Takeout", qty: 0.75, unit: "CT", yieldPct: 100 },
      { item: "PAPER Container Takeout Medium", qty: 0.75, unit: "Each", yieldPct: 100 },
      { item: "PAPER Napkins", qty: 5, unit: "Each", yieldPct: 100 },
    ],
    batchRefs: [{ batch: "grilled_onion", qty: 4, unit: "OZ-fl" }], // 2× grilled onion
  },
  // Combo 3: same as Combo 2
  {
    name: "Combo 3",
    otterName: "Combo 3",
    otterCategory: "Combos",
    foodCost: 9.32,
    ingredients: [
      { item: "BAKE Slider Bun", qty: 2, unit: "Each", yieldPct: 100 },
      { item: "Chris N Eddy's Sauce", qty: 2.4, unit: "OZ-fl", yieldPct: 100 },
      { item: "DAIRY Butter", qty: 20, unit: "Gram", yieldPct: 100 },
      { item: "DAIRY Cheese American", qty: 4, unit: "Each", yieldPct: 100 },
      { item: "MEAT Beef Ground", qty: 6, unit: "OZ-wt", yieldPct: 100 },
      { item: "PROD Lettuce", qty: 0.14, unit: "CT", yieldPct: 100 },
      { item: "PROD Tomato", qty: 1.60, unit: "OZ-wt", yieldPct: 100 },
      { item: "GROC Fries", qty: 8, unit: "OZ-wt", yieldPct: 100 },
      { item: "GROC Salt Iodized", qty: 0.10, unit: "Gram", yieldPct: 100 },
      { item: "PAPER Fry Boat", qty: 1, unit: "CT", yieldPct: 100 },
      { item: "Chris N Eddy's Sauce", qty: 2.8, unit: "OZ-fl", yieldPct: 100 },
      { item: "PAPER Cup Portion 3.25-5.5oz", qty: 1, unit: "Each", yieldPct: 100 },
      { item: "PAPER Lid Portion 3.25-5.5oz", qty: 1, unit: "Each", yieldPct: 100 },
      { item: "GROC Ketchup Packet", qty: 2, unit: "CT", yieldPct: 100 },
      { item: "PAPER Bag Plastic Takeout", qty: 0.75, unit: "CT", yieldPct: 100 },
      { item: "PAPER Container Takeout Medium", qty: 0.75, unit: "Each", yieldPct: 100 },
      { item: "PAPER Napkins", qty: 5, unit: "Each", yieldPct: 100 },
    ],
    batchRefs: [{ batch: "grilled_onion", qty: 4, unit: "OZ-fl" }],
  },

  // ── Modifiers ──
  {
    name: "Make it a Triple",
    otterName: "Make it a Triple",
    otterCategory: "Slider #1 Mods",
    foodCost: 0.58,
    ingredients: [
      { item: "DAIRY Cheese American", qty: 1, unit: "Each", yieldPct: 100 },
      { item: "MEAT Beef Ground", qty: 1.5, unit: "OZ-wt", yieldPct: 100 },
    ],
  },
  {
    name: "Upgrade to Cheese Fries",
    otterName: "Add Cheese",
    otterCategory: "Upgrade Your Fries",
    foodCost: 0.29,
    ingredients: [
      { item: "DAIRY Cheese American", qty: 2, unit: "Each", yieldPct: 100 },
      { item: "PAPER Fork Plastic", qty: 1, unit: "CT", yieldPct: 100 },
    ],
  },
  {
    name: "Upgrade to Loaded Fries",
    otterName: "Loaded",
    otterCategory: "Upgrade Your Fries",
    foodCost: 1.16,
    ingredients: [
      { item: "Chris N Eddy's Sauce", qty: 3, unit: "OZ-fl", yieldPct: 100 },
      { item: "DAIRY Cheese American", qty: 2, unit: "Each", yieldPct: 100 },
      { item: "PAPER Fork Plastic", qty: 1, unit: "CT", yieldPct: 100 },
    ],
    batchRefs: [{ batch: "grilled_onion", qty: 3, unit: "OZ-fl" }],
  },
]

// ─── Flatten a recipe into final ingredient list ───

interface FlatIngredient {
  ingredientName: string
  quantity: number
  unit: string
}

function flattenRecipe(recipe: R365Recipe): FlatIngredient[] {
  // Accumulator: canonical name → { qty, unit }
  const acc = new Map<string, { qty: number; unit: string }>()

  function addIngredient(item: string, qty: number, r365Unit: string) {
    const name = stripPrefix(item)
    const { unit, factor } = mapUnit(r365Unit)
    const convertedQty = qty * factor
    const existing = acc.get(name)
    if (existing) {
      existing.qty += convertedQty
    } else {
      acc.set(name, { qty: convertedQty, unit })
    }
  }

  // Direct ingredients
  for (const ing of recipe.ingredients) {
    addIngredient(ing.item, ing.qty, ing.unit)
  }

  // Expand batch references (grilled onion only — sauce is now purchased)
  if (recipe.batchRefs) {
    for (const ref of recipe.batchRefs) {
      if (ref.batch === "grilled_onion") {
        const expanded = expandGrilledOnion(ref.qty) // ref.qty is in OZ-fl
        for (const sub of expanded) {
          addIngredient(sub.item, sub.qty, sub.unit)
        }
      }
    }
  }

  return Array.from(acc.entries()).map(([name, { qty, unit }]) => ({
    ingredientName: name,
    quantity: Math.round(qty * 10000) / 10000,
    unit,
  }))
}

// ─── Main ───

async function main() {
  const { prisma } = await import("../src/lib/prisma")

  console.log("═".repeat(60))
  console.log("R365 Recipe Seed — Chris N Eddy's Hollywood")
  console.log("═".repeat(60))
  console.log(`Store ID: ${HOLLYWOOD_STORE_ID}`)
  console.log(`Recipes to import: ${MENU_RECIPES.length}`)
  console.log()

  // Step 1: Delete old mismatched recipes from previous seed runs
  const oldRecipes = await prisma.recipe.findMany({
    where: { storeId: HOLLYWOOD_STORE_ID, notes: "Imported from R365" },
    select: { id: true, itemName: true, category: true },
  })
  if (oldRecipes.length > 0) {
    await prisma.recipe.deleteMany({
      where: { id: { in: oldRecipes.map((r) => r.id) } },
    })
    console.log(`Cleaned up ${oldRecipes.length} old R365 recipes`)
  }

  let created = 0
  let updated = 0

  for (const r365Recipe of MENU_RECIPES) {
    const flatIngredients = flattenRecipe(r365Recipe)

    // Use explicit Otter mapping or fall back to R365 name
    const itemName = r365Recipe.otterName ?? r365Recipe.name
    const category = r365Recipe.otterCategory ?? "Menu"

    const existing = await prisma.recipe.findUnique({
      where: {
        storeId_itemName_category: {
          storeId: HOLLYWOOD_STORE_ID,
          itemName,
          category,
        },
      },
    })

    await prisma.$transaction(async (tx) => {
      const recipe = await tx.recipe.upsert({
        where: {
          storeId_itemName_category: {
            storeId: HOLLYWOOD_STORE_ID,
            itemName,
            category,
          },
        },
        create: {
          storeId: HOLLYWOOD_STORE_ID,
          itemName,
          category,
          servingSize: 1,
          foodCostOverride: r365Recipe.foodCost,
          notes: `Imported from R365`,
          isAiGenerated: false,
          isConfirmed: true,
        },
        update: {
          foodCostOverride: r365Recipe.foodCost,
          notes: `Imported from R365`,
          isConfirmed: true,
        },
      })

      // Replace ingredients
      await tx.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } })
      if (flatIngredients.length > 0) {
        await tx.recipeIngredient.createMany({
          data: flatIngredients.map((ing) => ({
            recipeId: recipe.id,
            ingredientName: ing.ingredientName,
            quantity: ing.quantity,
            unit: ing.unit,
          })),
        })
      }

      const action = existing ? "Updated" : "Created"
      if (existing) updated++
      else created++

      console.log(
        `  ${action}: ${itemName} [${category}] — ${flatIngredients.length} ingredients, $${r365Recipe.foodCost.toFixed(2)} food cost`
      )
    })
  }

  console.log()
  console.log(`Done: ${created} created, ${updated} updated`)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error("Seed failed:", err)
  process.exit(1)
})
