import fs from "fs"
import path from "path"
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue
    const i = t.indexOf("="); if (i === -1) continue
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvLocal()

type Prisma = Awaited<ReturnType<typeof import("../src/lib/prisma")["prisma"]["$transaction"]>> extends unknown ? any : any

async function main() {
  const { prisma } = await import("../src/lib/prisma")

  const stores = await prisma.store.findMany({ select: { id: true } })
  const storeIds = stores.map((s: { id: string }) => s.id)
  const ownerId = (await prisma.recipe.findFirst({ select: { ownerId: true } }))!.ownerId

  async function canonicalIdByName(name: string): Promise<string> {
    const c = await prisma.canonicalIngredient.findFirst({ where: { ownerId, name } })
    if (!c) throw new Error(`Canonical not found: ${name}`)
    return c.id
  }
  async function recipeIdByName(itemName: string, category: string): Promise<string> {
    const r = await prisma.recipe.findUnique({ where: { ownerId_itemName_category: { ownerId, itemName, category } } })
    if (!r) throw new Error(`Recipe not found: ${itemName} [${category}]`)
    return r.id
  }

  type Line =
    | { kind: "canonical"; name: string; quantity: number; unit: string }
    | { kind: "component"; recipeName: string; recipeCategory: string; quantity: number; unit: string }

  async function upsertRecipe(itemName: string, category: string, opts: {
    servingSize?: number
    foodCostOverride?: number | null
    isSellable?: boolean
    lines?: Line[]
  }): Promise<string> {
    const existing = await prisma.recipe.findUnique({ where: { ownerId_itemName_category: { ownerId, itemName, category } } })
    if (existing) {
      if (opts.foodCostOverride !== undefined || opts.isSellable !== undefined) {
        await prisma.recipe.update({
          where: { id: existing.id },
          data: {
            ...(opts.foodCostOverride !== undefined ? { foodCostOverride: opts.foodCostOverride } : {}),
            ...(opts.isSellable !== undefined ? { isSellable: opts.isSellable } : {}),
          },
        })
      }
      console.log(`  recipe exists: [${category}] ${itemName}`)
      return existing.id
    }
    const r = await prisma.recipe.create({
      data: {
        ownerId,
        itemName,
        category,
        servingSize: opts.servingSize ?? 1,
        foodCostOverride: opts.foodCostOverride ?? null,
        isSellable: opts.isSellable ?? true,
        isConfirmed: true,
      },
    })
    console.log(`  recipe created: [${category}] ${itemName}`)
    if (opts.lines?.length) {
      for (const ln of opts.lines) {
        if (ln.kind === "canonical") {
          const canonicalIngredientId = await canonicalIdByName(ln.name)
          await prisma.recipeIngredient.create({
            data: { recipeId: r.id, canonicalIngredientId, quantity: ln.quantity, unit: ln.unit, ingredientName: ln.name },
          })
        } else {
          const componentRecipeId = await recipeIdByName(ln.recipeName, ln.recipeCategory)
          await prisma.recipeIngredient.create({
            data: { recipeId: r.id, componentRecipeId, quantity: ln.quantity, unit: ln.unit, ingredientName: ln.recipeName },
          })
        }
      }
    }
    return r.id
  }

  console.log("=== 1. CREATE / UPDATE RECIPES ===\n")

  const singlePatty = await upsertRecipe("Single Patty", "A La Carte", {
    lines: [{ kind: "canonical", name: "ground beef fine grnd 73/27 creekstone", quantity: 1.5, unit: "oz" }],
  })

  const reverseBun = await upsertRecipe("The Reverse Bun", "Secret Menu", { foodCostOverride: 0 })

  const mexicanSprite = await upsertRecipe("Mexican Sprite 500ml", "Drinks", {
    lines: [{ kind: "canonical", name: "soda sprite mexican glass crv inc", quantity: 500, unit: "ml" }],
  })

  const minuteMaid = await upsertRecipe("Minute Maid (20 oz cup)", "Drinks", { foodCostOverride: 0.30 })

  const twoGrilledCheeseFries = await upsertRecipe("2 Grilled Cheeses and Fries", "Combos", {
    lines: [
      { kind: "component", recipeName: "Grilled Cheese", recipeCategory: "On The Side", quantity: 2, unit: "serving" },
      { kind: "component", recipeName: "Straight Cut Fries", recipeCategory: "A La Carte", quantity: 1, unit: "serving" },
      { kind: "component", recipeName: "Extra Chris N Eddy's Sauce", recipeCategory: "On The Side", quantity: 1, unit: "serving" },
      { kind: "canonical", name: "chrsned bag plas tshirt logo ptsbchrisneddy", quantity: 1, unit: "each" },
      { kind: "canonical", name: "napkin dispenser 2-ply 8.5 x 6.5 white", quantity: 3, unit: "each" },
    ],
  })

  const modMakeHalal = await upsertRecipe("Mod: Make Halal", "Modifier", { foodCostOverride: 0, isSellable: false })
  const modNoSalt = await upsertRecipe("Mod: No Salt", "Modifier", { foodCostOverride: 0, isSellable: false })
  const modLightOnions = await upsertRecipe("Mod: Light Onions", "Modifier", { foodCostOverride: 0, isSellable: false })
  const modReverseBun = await upsertRecipe("Mod: Reverse Bun", "Modifier", { foodCostOverride: 0, isSellable: false })
  // -$0.07 = subtracts 2 servings of Mod: Add Grilled Onion from base Loaded Fries
  const modLoadedPlain = await upsertRecipe("Mod: Loaded Plain (Cheese & Sauce Only)", "Modifier", { foodCostOverride: -0.0701, isSellable: false })

  // Chris's Way with grilled onion substituted for raw. Lettuce + tomato + grilled onion + sauce.
  const modChrisWaySubGrilled = await upsertRecipe("Mod: Chris's Way (Sub Grilled Onions)", "Modifier", {
    isSellable: false,
    lines: [
      { kind: "component", recipeName: "Mod: Add Lettuce", recipeCategory: "Modifier", quantity: 1, unit: "serving" },
      { kind: "component", recipeName: "Mod: Add Tomato", recipeCategory: "Modifier", quantity: 1, unit: "serving" },
      { kind: "component", recipeName: "Mod: Add Grilled Onion", recipeCategory: "Modifier", quantity: 1, unit: "serving" },
      { kind: "component", recipeName: "Mod: Add Sauce", recipeCategory: "Modifier", quantity: 1, unit: "serving" },
    ],
  })

  console.log("\n=== 2. UPSERT OtterItemMappings (SKU-BASED) ===\n")

  const itemMappings: Array<{ skuId: string; otterItemName: string; recipeId: string }> = [
    { skuId: "b7e9cf72-eef5-4d8a-92e7-083989036e7d", otterItemName: "Loaded Fries", recipeId: await recipeIdByName("Loaded Fries", "A La Carte") },
    { skuId: "d6c3cc58-e094-42ea-9584-f30d403b079f", otterItemName: "Cheese Fries", recipeId: await recipeIdByName("Cheese Fries", "A La Carte") },
    { skuId: "e563b12d-91ac-495d-8cfb-40135f319584", otterItemName: "Grilled Cheese", recipeId: await recipeIdByName("Grilled Cheese", "On The Side") },
    { skuId: "2fa1e11e-537a-4dd7-91d2-6619479481b7", otterItemName: "Grilled Cheese ", recipeId: await recipeIdByName("Grilled Cheese", "On The Side") },
    { skuId: "c69305b8-cc06-43d8-a04e-644e867c33c6", otterItemName: "Diet Coke (20 oz cup)", recipeId: await recipeIdByName("Diet Coke (20 oz cup)", "Drinks") },
    { skuId: "ca24c79c-407b-4b29-afe3-858f460e8ef8", otterItemName: "Hi-C (20 oz cup)", recipeId: await recipeIdByName("Hi-C (20 oz cup)", "Drinks") },
    { skuId: "6a9330fe-7b7e-4276-874a-7bbbde07fc39", otterItemName: "Triple Slider", recipeId: await recipeIdByName("Triple Slider", "A La Carte") },
    { skuId: "c66e8208-15ba-4efb-a4f7-95786e388f63", otterItemName: "Triple Patty Slider", recipeId: await recipeIdByName("Triple Slider", "A La Carte") },
    { skuId: "12538a71-8be7-4f4e-a0ed-94bac0c368f5", otterItemName: "The Quad", recipeId: await recipeIdByName("The Quad", "Secret Menu") },
    { skuId: "b0891985-0805-4dd8-a8b6-740340febe7c", otterItemName: "Double Slider", recipeId: await recipeIdByName("Double Slider", "A La Carte") },
    { skuId: "a5d107e3-6176-4aa2-b352-a12af49a24fe", otterItemName: "Single Slider", recipeId: await recipeIdByName("Single Slider", "A La Carte") },
    { skuId: "c36c0d96-552d-405d-b56e-82ffe671bfc2", otterItemName: "2 Slider Combo", recipeId: await recipeIdByName("2 Slider Combo", "Combos") },
    { skuId: "98f5346f-8e29-43ae-a743-dc12e64a6f1c", otterItemName: "1 Slider Combo", recipeId: await recipeIdByName("1 Slider Combo", "Combos") },
    { skuId: "c9d13817-5666-48fb-83e2-2a26b8b99604", otterItemName: "Extra Chris N Eddy's Sauce", recipeId: await recipeIdByName("Extra Chris N Eddy's Sauce", "On The Side") },
    { skuId: "939b08ae-b5fe-4ffd-8d29-ade4932ca224", otterItemName: "Extra Sauce ", recipeId: await recipeIdByName("Extra Chris N Eddy's Sauce", "On The Side") },
    { skuId: "4579aad4-31ca-4c67-ac98-ae27687b67af", otterItemName: "Coca Cola (20 oz cup)", recipeId: await recipeIdByName("Coca Cola (20 oz cup)", "Drinks") },
    { skuId: "52bed975-59db-4602-9284-fc366a8b47b6", otterItemName: "Sprite (20 oz cup)", recipeId: await recipeIdByName("Sprite (20 oz cup)", "Drinks") },
    { skuId: "deff58b4-db3f-43ee-94c6-28156986391e", otterItemName: "Orange Fanta (20 oz cup)", recipeId: await recipeIdByName("Orange Fanta (20 oz cup)", "Drinks") },
    { skuId: "0a6133c4-0b72-433c-be51-f215abde0c3b", otterItemName: "Coke Zero (20 oz cup)", recipeId: await recipeIdByName("Coke Zero (20 oz cup)", "Drinks") },
    { skuId: "f71e054a-a3af-4395-9876-64c2a1b44cde", otterItemName: "Minute Maid (20 oz cup)", recipeId: minuteMaid },
    { skuId: "07767b1e-d5f9-44fd-adbb-30479be79ada", otterItemName: "Bottle of Water", recipeId: await recipeIdByName("Water", "Drinks") },
    { skuId: "eed73253-3fa9-40d3-bd15-89077e516a48", otterItemName: "Mexican Sprite", recipeId: mexicanSprite },
    { skuId: "f5c32076-2bdb-4c13-b60a-b45b19738e28", otterItemName: "Mexican Sprite 500ml", recipeId: mexicanSprite },
    { skuId: "9596911e-b184-4001-b0da-ad8acccf1df2", otterItemName: "The Reverse Bun", recipeId: reverseBun },
    { skuId: "076caea2-76de-420f-bf58-4174cf4889f8", otterItemName: "Single Patty", recipeId: singlePatty },
    { skuId: "683589f6-3267-4a0f-a681-dbf5f5e55255", otterItemName: "2 Grilled Cheeses and Fries", recipeId: twoGrilledCheeseFries },
  ]

  for (const m of itemMappings) {
    for (const storeId of storeIds) {
      const existing = await prisma.otterItemMapping.findUnique({
        where: { storeId_otterItemName: { storeId, otterItemName: m.otterItemName } },
      })
      if (existing) {
        if (existing.skuId !== m.skuId || existing.recipeId !== m.recipeId) {
          await prisma.otterItemMapping.update({
            where: { id: existing.id },
            data: { skuId: m.skuId, recipeId: m.recipeId, confirmedAt: new Date() },
          })
          console.log(`  updated: ${m.otterItemName} @ ${storeId.slice(-8)}`)
        }
      } else {
        await prisma.otterItemMapping.create({
          data: { storeId, otterItemName: m.otterItemName, skuId: m.skuId, recipeId: m.recipeId },
        })
        console.log(`  created: ${m.otterItemName} @ ${storeId.slice(-8)}`)
      }
    }
  }

  console.log("\n=== 3. UPSERT OtterSubItemMappings (MODIFIER SKUs) ===\n")

  const subMappings: Array<{ skuId: string; otterSubItemName: string; recipeId: string }> = [
    { skuId: "54475bc8-6b4f-4240-88d7-d0452bc0fd88", otterSubItemName: "Add Lettuce", recipeId: await recipeIdByName("Mod: Add Lettuce", "Modifier") },
    { skuId: "69a0af0f-e7f2-4910-837e-b2e88d7d2082", otterSubItemName: "Chris Way - Sub Grilled Onions", recipeId: modChrisWaySubGrilled },
    { skuId: "08793db2-b097-412c-af88-94ab727ef3cf", otterSubItemName: "Make it Halal", recipeId: modMakeHalal },
    { skuId: "ebeebe94-e305-4162-80f8-a788abc8523d", otterSubItemName: "Make them Halal", recipeId: modMakeHalal },
    { skuId: "bdc8d14e-6446-43c1-82af-b3889375de67", otterSubItemName: "Loaded - Cheese & Sauce Only", recipeId: modLoadedPlain },
    { skuId: "ea6dfb2f-8c42-4696-a657-e0c3bc71e084", otterSubItemName: "Light Onions", recipeId: modLightOnions },
    { skuId: "08db2a53-e798-4289-9fcf-32e30ea67938", otterSubItemName: "Reverse Bun", recipeId: modReverseBun },
    { skuId: "cc968dad-65eb-4015-a98b-25719efa6b8f", otterSubItemName: "Add Extra Sliced Cheese", recipeId: await recipeIdByName("Mod: Add Extra Cheese", "Modifier") },
    { skuId: "3799c813-1269-49d4-8546-9f21cc39d9fc", otterSubItemName: "1 Slice of Cheese", recipeId: await recipeIdByName("Mod: Add Cheese", "Modifier") },
    { skuId: "16d409bd-3997-4faa-8410-dff4ff9e771d", otterSubItemName: "Extra Onion", recipeId: await recipeIdByName("Mod: Add Raw Onion", "Modifier") },
    { skuId: "fa8d643c-6e2c-4810-a192-f7e72db23bcc", otterSubItemName: "No Salt", recipeId: modNoSalt },
  ]

  for (const m of subMappings) {
    for (const storeId of storeIds) {
      const existing = await prisma.otterSubItemMapping.findUnique({
        where: { storeId_skuId: { storeId, skuId: m.skuId } },
      })
      if (existing) {
        if (existing.recipeId !== m.recipeId || existing.otterSubItemName !== m.otterSubItemName) {
          await prisma.otterSubItemMapping.update({
            where: { id: existing.id },
            data: { recipeId: m.recipeId, otterSubItemName: m.otterSubItemName, confirmedAt: new Date() },
          })
          console.log(`  updated: ${m.otterSubItemName} @ ${storeId.slice(-8)}`)
        }
      } else {
        await prisma.otterSubItemMapping.create({
          data: { storeId, skuId: m.skuId, otterSubItemName: m.otterSubItemName, recipeId: m.recipeId },
        })
        console.log(`  created: ${m.otterSubItemName} @ ${storeId.slice(-8)}`)
      }
    }
  }

  console.log("\n=== DONE ===")
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
