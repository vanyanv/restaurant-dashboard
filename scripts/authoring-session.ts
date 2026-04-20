// scripts/authoring-session.ts
//
// Interactive-ish authoring helper — each batch is a named function at the
// bottom. Edit the `main()` body to pick which batches to run, then:
//
//   npx tsx scripts/authoring-session.ts --commit
//
// Dry-run by default. Idempotent where reasonable: looks up canonicals/
// recipes by name, creates only when missing.

import fs from "fs"
import path from "path"

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
    if (!process.env[key]) process.env[key] = val
  }
}
loadEnvLocal()

const COMMIT = process.argv.includes("--commit")

async function main() {
  const { prisma } = await import("../src/lib/prisma")

  const ctx = await buildContext(prisma)
  console.log(`\n=== ${COMMIT ? "COMMIT" : "DRY-RUN"} authoring session ===\n`)
  console.log(`owner=${ctx.ownerId.slice(0, 10)}…  stores=${ctx.storeIds.length}`)

  // --- Batch 1 (already applied — idempotent re-runs are safe): cost corrections ---
  await setCanonicalCostLocked(ctx, {
    name: "chris & eddy's house sauce",
    recipeUnit: "oz",
    costPerRecipeUnit: 0.18,
    reason: "Owner-provided: $0.18/oz",
  })
  await setCanonicalCostLocked(ctx, {
    name: "packer lettuce boston hydroponic",
    recipeUnit: "each",
    costPerRecipeUnit: 0.15,
    reason: "Re-interpret as per-leaf (~15 leaves/head). Owner approved.",
  })
  const addLettuce = await upsertRecipe(ctx, {
    itemName: "Mod: Add Lettuce",
    category: "Modifier",
    isSellable: false,
    notes: "Otter 'Add Lettuce' modifier. 0.5 leaf per use.",
    ingredients: [
      { canonicalName: "packer lettuce boston hydroponic", quantity: 0.5, unit: "each", displayAs: "Lettuce (leaf)" },
    ],
  })
  await setRecipeOverride(ctx, {
    itemName: "Extra Chris N Eddy's Sauce",
    foodCostOverride: 0.5,
    reason: "$0.50 per premade cup (owner)",
  })
  await mapOtterSubItemsToRecipe(ctx, {
    skuIds: ["75d439a0-02f4-4e81-a722-4f45293c4a20", "54475bc8-6b40-4e8c-969d-56fe4ef04c47"],
    recipe: addLettuce,
    displayName: "Add Lettuce",
  })

  // ============================================================
  // Batch 2: onion/tomato/sauce modifiers + composites (Eddy's/Chris's Way)
  // ============================================================

  const addGrilledOnion = await upsertRecipe(ctx, {
    itemName: "Mod: Add Grilled Onion",
    category: "Modifier",
    isSellable: false,
    notes:
      "Otter 'Add Grilled Onion' modifier. 0.03 lb onion (owner spec) + small bit of butter for the griddle.",
    ingredients: [
      { canonicalName: "packer onion sweet fresh", quantity: 0.03, unit: "lb", displayAs: "Onion (grilled)" },
      { canonicalName: "whole frozen butter solid usda aa unsalted", quantity: 0.002, unit: "lb", displayAs: "Butter (griddle)" },
    ],
  })

  const addRawOnion = await upsertRecipe(ctx, {
    itemName: "Mod: Add Raw Onion",
    category: "Modifier",
    isSellable: false,
    notes: "Otter 'Add Raw Onion' modifier. 0.019 lb per slice (matches existing recipe pattern for a thin slice).",
    ingredients: [
      { canonicalName: "packer onion sweet fresh", quantity: 0.019, unit: "lb", displayAs: "Onion (raw slice)" },
    ],
  })

  const addTomato = await upsertRecipe(ctx, {
    itemName: "Mod: Add Tomato",
    category: "Modifier",
    isSellable: false,
    notes: "Otter 'Add Tomato' modifier. 0.05 lb per slice (~0.8 oz off a 5x6 fresh tomato).",
    ingredients: [
      { canonicalName: "imported fresh tomato bulk 5x6 fresh", quantity: 0.05, unit: "lb", displayAs: "Tomato (slice)" },
    ],
  })

  const addSauce = await upsertRecipe(ctx, {
    itemName: "Mod: Add Sauce",
    category: "Modifier",
    isSellable: false,
    notes: "Otter 'Add Sauce' modifier. 0.5 oz extra squirt of house sauce on top.",
    ingredients: [
      { canonicalName: "chris & eddy's house sauce", quantity: 0.5, unit: "oz", displayAs: "House sauce (extra squirt)" },
    ],
  })

  // Composites — reference the above via component sub-recipe.
  const eddysWay = await upsertRecipe(ctx, {
    itemName: "Mod: Eddy's Way",
    category: "Modifier",
    isSellable: false,
    notes: "Owner: Eddy's Way = Add Grilled Onion + Add Sauce.",
    ingredients: [
      { kind: "component", componentRecipeId: addGrilledOnion.id, componentLabel: addGrilledOnion.itemName, quantity: 1, unit: "serving" },
      { kind: "component", componentRecipeId: addSauce.id, componentLabel: addSauce.itemName, quantity: 1, unit: "serving" },
    ],
  })

  const chrisWay = await upsertRecipe(ctx, {
    itemName: "Mod: Chris's Way",
    category: "Modifier",
    isSellable: false,
    notes: "Owner: Chris's Way = Lettuce + Tomato + Raw Onion + Sauce.",
    ingredients: [
      { kind: "component", componentRecipeId: addLettuce.id, componentLabel: addLettuce.itemName, quantity: 1, unit: "serving" },
      { kind: "component", componentRecipeId: addTomato.id, componentLabel: addTomato.itemName, quantity: 1, unit: "serving" },
      { kind: "component", componentRecipeId: addRawOnion.id, componentLabel: addRawOnion.itemName, quantity: 1, unit: "serving" },
      { kind: "component", componentRecipeId: addSauce.id, componentLabel: addSauce.itemName, quantity: 1, unit: "serving" },
    ],
  })

  // Map all Otter sub-item SKUs for these modifiers.
  await mapOtterSubItemsToRecipe(ctx, {
    skuIds: [
      "f340db0a-fbb7-4f33-b34f-773fdc86a8a0", // "Add Grilled Onion"
      "6a32667a-fd3a-4283-8c39-a32b1d6198fe", // "Add Grilled Onions" (plural)
    ],
    recipe: addGrilledOnion,
    displayName: "Add Grilled Onion",
  })

  await mapOtterSubItemsToRecipe(ctx, {
    skuIds: [
      "6874b38f-7cfb-42a9-af74-9c539a1b39e2", // "Add Raw Onion"
      "f0871b2f-c109-475b-a0a0-ff147093046d", // "Add Raw Onions" (plural)
    ],
    recipe: addRawOnion,
    displayName: "Add Raw Onion",
  })

  await mapOtterSubItemsToRecipe(ctx, {
    skuIds: [
      "1930f18f-c50e-41bb-a5ec-6c629da68eb8", // "Add Tomato"
      "00877479-69bd-4ade-a85b-faef3fd7c7b0", // "Add Tomato" (2nd SKU)
    ],
    recipe: addTomato,
    displayName: "Add Tomato",
  })

  await mapOtterSubItemsToRecipe(ctx, {
    skuIds: [
      "66f7c404-6da9-433e-9ac9-2764b42b0036", // "Add Sauce"
      "4e48f9e5-075f-4e58-be99-4789da946eca", // " Add Sauce" (leading space)
    ],
    recipe: addSauce,
    displayName: "Add Sauce",
  })

  await mapOtterSubItemsToRecipe(ctx, {
    skuIds: ["ecee2347-604d-42b5-9314-d592b917bc75"],
    recipe: eddysWay,
    displayName: "Eddy Way",
  })

  await mapOtterSubItemsToRecipe(ctx, {
    skuIds: ["9a9fee6b-4603-4769-85fd-49b63da7b848"],
    recipe: chrisWay,
    displayName: "Chris Way",
  })

  // ============================================================
  // Batch 3: American cheese + pickle canonicals + modifier recipes
  // ============================================================
  //
  // New invoice lines (Premier Deli Services, Inc.):
  //   - sku=644  "American Cheese Yellow 160"  qty=25 LB* unitPrice=$3.85 ext=$2877.50
  //     Math: $3.85/lb × 29.87 lb/case × 25 cases = $2877.50 ✓
  //           Case = 6 packs × 160 slices × 0.5 oz = 30 lb
  //           Cost/slice = $2877.50 / (25 × 6 × 160) = $0.1199 ≈ $0.12
  //   - sku=813  "Pickle Chips Sandwich Cut 1/8""  qty=4 EA unitPrice=$36 ext=$144
  //     Math: 4 cases × ~1000 chips = 4000 chips; $144 / 4000 = $0.036/chip

  // Run the seed so canonicals exist for these new SKUs + line items are FK-linked.
  {
    const { seedCanonicalIngredientsFromInvoices } = await import("../src/lib/canonical-ingredients")
    const seedResult = await seedCanonicalIngredientsFromInvoices(ctx.ownerId)
    console.log(
      `\n  [seed] created ${seedResult.canonicalsCreated} canonicals, ${seedResult.skuMatchesCreated} sku matches, ${seedResult.aliasesCreated} aliases (${seedResult.skipped} skipped)`
    )
  }

  await setCanonicalCostLocked(ctx, {
    name: "american cheese yellow 160",
    recipeUnit: "each",
    costPerRecipeUnit: 0.12,
    reason: "Owner: 25 cases × 6 packs × 160 slices, $2877.50 total → $0.12/slice. Locked (confirm 6 vs 8 packs).",
  })

  await setCanonicalCostLocked(ctx, {
    name: "pickle chips sandwich cut 1/8\"",
    recipeUnit: "each",
    costPerRecipeUnit: 0.036,
    reason: "Owner: 4 cases × ~1000 chips, $144 total → $0.036/chip.",
  })

  const addCheeseSlider = await upsertRecipe(ctx, {
    itemName: "Mod: Add Cheese",
    category: "Modifier",
    isSellable: false,
    notes: "Otter 'Add Cheese' modifier on a slider. 1 slice per use.",
    ingredients: [
      { canonicalName: "american cheese yellow 160", quantity: 1, unit: "each", displayAs: "American cheese (slice)" },
    ],
  })

  const addExtraCheese = await upsertRecipe(ctx, {
    itemName: "Mod: Add Extra Cheese",
    category: "Modifier",
    isSellable: false,
    notes: "Otter 'Add Extra Cheese' modifier. 1 additional slice.",
    ingredients: [
      { canonicalName: "american cheese yellow 160", quantity: 1, unit: "each", displayAs: "American cheese (slice)" },
    ],
  })

  const removeCheese = await upsertRecipe(ctx, {
    itemName: "Mod: Remove Cheese",
    category: "Modifier",
    isSellable: false,
    notes: "Otter 'Remove Cheese' modifier. Zero-cost line.",
    foodCostOverride: 0,
    ingredients: [],
  })

  const addPickle = await upsertRecipe(ctx, {
    itemName: "Mod: Add Pickle",
    category: "Modifier",
    isSellable: false,
    notes: "Otter 'Add Pickle' modifier. 3 pickle chips per use (owner).",
    ingredients: [
      { canonicalName: "pickle chips sandwich cut 1/8\"", quantity: 3, unit: "each", displayAs: "Pickle chips" },
    ],
  })

  const extraPickles = await upsertRecipe(ctx, {
    itemName: "Mod: Extra Pickles",
    category: "Modifier",
    isSellable: false,
    notes: "Otter 'Extra Pickles' modifier. 1 extra pickle chip (owner).",
    ingredients: [
      { canonicalName: "pickle chips sandwich cut 1/8\"", quantity: 1, unit: "each", displayAs: "Pickle chip (extra)" },
    ],
  })

  // Otter "Add Cheese" has two SKUs:
  //   ea9881ab... (31 uses, no sub-header)      → Add Cheese on slider → Mod: Add Cheese
  //   b37c9a2e... (11 uses, "Upgrade Your Fries") → leave it mapped to the existing
  //     "Add Cheese" recipe (category=Upgrade Your Fries, override=$0.29).
  // We only map the slider-context SKU here; the fries-context one will pick up
  // the existing recipe via name match in the materializer, or can be mapped
  // explicitly later.
  await mapOtterSubItemsToRecipe(ctx, {
    skuIds: ["ea9881ab-0bc7-4d01-9c8b-10b8c6ae34de"],
    recipe: addCheeseSlider,
    displayName: "Add Cheese",
  })

  await mapOtterSubItemsToRecipe(ctx, {
    skuIds: ["eba304ba-863a-4e73-9c74-fc7aaa2d4b59"],
    recipe: addExtraCheese,
    displayName: "Add Extra Cheese",
  })

  await mapOtterSubItemsToRecipe(ctx, {
    skuIds: [
      "7d8d049b-9d32-41cf-ae04-060929562beb", // "Remove Cheese"
      "9f29835a-9d1a-47de-97a4-ddb1372c2a6e", // " Remove Cheese" (leading space)
    ],
    recipe: removeCheese,
    displayName: "Remove Cheese",
  })

  await mapOtterSubItemsToRecipe(ctx, {
    skuIds: [
      "de2c09aa-18a0-4247-9238-f22a6d61a3a0", // "Add Pickle"
      "60b9d8c1-bc50-4744-ad58-22c6a0d1a78e", // "Add Pickles" (plural, same meaning)
    ],
    recipe: addPickle,
    displayName: "Add Pickle",
  })

  await mapOtterSubItemsToRecipe(ctx, {
    skuIds: ["2ae1dbea-a91a-44af-a3d8-d9a98d771381"],
    recipe: extraPickles,
    displayName: "Extra Pickles",
  })

  // ============================================================
  // Batch 4: fries-cheese, meat-and-cheese, make-it-a-triple
  // ============================================================
  //
  // Decisions from owner:
  //   - "Add Cheese" on fries = 2 slices American cheese → $0.24.
  //     This IS the existing "Add Cheese" recipe (category: Upgrade Your Fries,
  //     override $0.29). Replacing the override with bound ingredients.
  //   - "Meat and Cheese" = plain slider, nothing else. Cost-neutral modifier
  //     (no additive cost — strips base toppings client-side, but doesn't
  //     change what we bought).
  //   - "Make it a Triple" = +1 patty (1.5 oz ground beef, matching other
  //     slider recipes) + 1 cheese slice. Updating existing recipe.

  // Update "Add Cheese" (Upgrade Your Fries). Keep sellable flag, drop override.
  const fryCheese = await upsertRecipe(ctx, {
    itemName: "Add Cheese",
    category: "Upgrade Your Fries",
    isSellable: true,
    notes: "Cheese-fries upgrade. 2 slices American cheese (owner).",
    ingredients: [
      { canonicalName: "american cheese yellow 160", quantity: 2, unit: "each", displayAs: "American cheese (slice)" },
    ],
  })

  // Update "Make it a Triple" (Slider #1 Mods). +1 patty + 1 cheese slice.
  const makeTriple = await upsertRecipe(ctx, {
    itemName: "Make it a Triple",
    category: "Slider #1 Mods",
    isSellable: true,
    notes: "+1 patty (1.5 oz ground beef) + 1 cheese slice (owner).",
    ingredients: [
      { canonicalName: "ground beef fine grnd 73/27 creekstone", quantity: 1.5, unit: "oz", displayAs: "Ground beef (patty)" },
      { canonicalName: "american cheese yellow 160", quantity: 1, unit: "each", displayAs: "American cheese (slice)" },
    ],
  })

  // Zero-cost modifier: "Meat and Cheese" — plain, no additive ingredients.
  const meatAndCheese = await upsertRecipe(ctx, {
    itemName: "Mod: Meat and Cheese",
    category: "Modifier",
    isSellable: false,
    notes: "Otter 'Meat and Cheese' modifier = slider served plain: bun + meat + cheese only, no toppings (no sauce, lettuce, tomato, onion, pickle). Cost-neutral at the modifier layer — the base slider recipe already includes bun+meat+cheese, and we don't refund removed toppings against COGS. Slight over-count of topping cost on these orders is acceptable.",
    foodCostOverride: 0,
    ingredients: [],
  })

  // Map Otter SKUs.
  await mapOtterSubItemsToRecipe(ctx, {
    skuIds: ["b37c9a2e-b30b-482f-9b61-263571c0a4d2"], // "Add Cheese" (Upgrade Your Fries context)
    recipe: fryCheese,
    displayName: "Add Cheese",
  })

  await mapOtterSubItemsToRecipe(ctx, {
    skuIds: ["460834db-f5ce-4587-80ad-838e1d748bb6"], // "Meat and Cheese"
    recipe: meatAndCheese,
    displayName: "Meat and Cheese",
  })

  await mapOtterSubItemsToRecipe(ctx, {
    skuIds: ["1f190153-0507-4946-b7c0-79293559ad19"], // "Make it a Triple " (trailing space in Otter name)
    recipe: makeTriple,
    displayName: "Make it a Triple",
  })

  // ============================================================
  // Batch 5: bind ingredients on the 6 core slider/cheese recipes
  // ============================================================
  //
  // Using existing quantities verbatim. Unit conversions (oz ↔ lb, etc.)
  // applied automatically by the recipe-cost walker. Overrides are cleared.
  //
  // Flags to verify:
  //   - Triple Slider  Onion 0.2626 LB  (expected ~0.057 LB for 3 slices)
  //   - Lettuce 0.05 EA / 0.07 EA / 0.14 EA values date from per-head canonical;
  //     with new per-leaf canonical these may be too low. Owner to confirm.

  await upsertRecipe(ctx, {
    itemName: "Single Slider",
    category: "A La Carte",
    isSellable: true,
    notes: "Base single-patty slider. Bun + 1 patty + 1 cheese slice. No default toppings (added via modifiers).",
    ingredients: [
      { canonicalName: "martins bread potato roll sandwich 3.5 inch", quantity: 1, unit: "each", displayAs: "Slider Bun" },
      { canonicalName: "american cheese yellow 160", quantity: 1, unit: "each", displayAs: "American Cheese" },
      { canonicalName: "ground beef fine grnd 73/27 creekstone", quantity: 1.5, unit: "oz", displayAs: "Ground Beef (patty)" },
    ],
  })

  await upsertRecipe(ctx, {
    itemName: "Double Slider",
    category: "A La Carte",
    isSellable: true,
    notes: "Base: 1 bun + 2 patties + 2 cheese. Sauce/butter/toppings all come via modifiers (Chris's Way, Eddy's Way, Add Sauce, Add Lettuce, etc.).",
    ingredients: [
      { canonicalName: "martins bread potato roll sandwich 3.5 inch", quantity: 1, unit: "each", displayAs: "Slider Bun" },
      { canonicalName: "american cheese yellow 160", quantity: 2, unit: "each", displayAs: "American Cheese" },
      { canonicalName: "ground beef fine grnd 73/27 creekstone", quantity: 3, unit: "oz", displayAs: "Ground Beef (2 patties)" },
    ],
  })

  await upsertRecipe(ctx, {
    itemName: "Triple Slider",
    category: "A La Carte",
    isSellable: true,
    notes: "Base: 1 bun + 3 patties + 3 cheese. Sauce/butter/toppings all via modifiers.",
    ingredients: [
      { canonicalName: "martins bread potato roll sandwich 3.5 inch", quantity: 1, unit: "each", displayAs: "Slider Bun" },
      { canonicalName: "american cheese yellow 160", quantity: 3, unit: "each", displayAs: "American Cheese" },
      { canonicalName: "ground beef fine grnd 73/27 creekstone", quantity: 4.5, unit: "oz", displayAs: "Ground Beef (3 patties)" },
    ],
  })

  await upsertRecipe(ctx, {
    itemName: "The Quad",
    category: "Secret Menu",
    isSellable: true,
    notes: "Base: 1 bun + 4 patties + 4 cheese. Same pattern as other sliders — modifications added after.",
    ingredients: [
      { canonicalName: "martins bread potato roll sandwich 3.5 inch", quantity: 1, unit: "each", displayAs: "Slider Bun" },
      { canonicalName: "american cheese yellow 160", quantity: 4, unit: "each", displayAs: "American Cheese" },
      { canonicalName: "ground beef fine grnd 73/27 creekstone", quantity: 6, unit: "oz", displayAs: "Ground Beef (4 patties)" },
    ],
  })

  await upsertRecipe(ctx, {
    itemName: "Grilled Cheese",
    category: "On The Side",
    isSellable: true,
    notes: "2 cheese slices + bun + butter (griddled).",
    ingredients: [
      { canonicalName: "martins bread potato roll sandwich 3.5 inch", quantity: 1, unit: "each", displayAs: "Slider Bun" },
      { canonicalName: "american cheese yellow 160", quantity: 2, unit: "each", displayAs: "American Cheese" },
      { canonicalName: "whole frozen butter solid usda aa unsalted", quantity: 0.16, unit: "oz", displayAs: "Butter (griddle)" },
    ],
  })

  await upsertRecipe(ctx, {
    itemName: "Extra Chris N Eddy's Sauce",
    category: "On The Side",
    isSellable: true,
    notes: "Premade sauce cup ($0.50 from supplier). Override-only; no ingredient bindings so $0.50 sticks as the reported cost.",
    foodCostOverride: 0.5,
    ingredients: [],
  })

  // ============================================================
  // Batch 6: fries + combos
  // ============================================================
  //
  // Owner spec:
  //   - Regular (Straight Cut) Fries = fries + fry boat
  //   - Cheese Fries = fries + fry boat + 2 cheese + fork
  //   - Loaded Fries = fries + fry boat + 2 cheese + sauce (3× burger = 3.6 oz) +
  //                    grilled onions (2× Mod: Add Grilled Onion) + fork
  //   - Combos = Slider(s) + Fries (no drink)
  //     - 1 Slider Combo = 1 Double Slider + Fries
  //     - 2 Slider Combo = 2 Double Sliders + Fries
  //     - Combo 3 = 2 Triple Sliders + Fries

  const straightCutFries = await upsertRecipe(ctx, {
    itemName: "Straight Cut Fries",
    category: "A La Carte",
    isSellable: true,
    notes: "Regular fries. 0.5 lb cut potato fries + 1 fry boat.",
    ingredients: [
      { canonicalName: "lamb potato fry ss 1/4 stealth", quantity: 0.5, unit: "lb", displayAs: "Fries" },
      { canonicalName: "tray food paper #50 1/2 lb white red check", quantity: 1, unit: "each", displayAs: "Fry Boat" },
    ],
  })

  const cheeseFries = await upsertRecipe(ctx, {
    itemName: "Cheese Fries",
    category: "A La Carte",
    isSellable: true,
    notes: "Regular fries + 2 cheese slices + fork.",
    ingredients: [
      { kind: "component", componentRecipeId: straightCutFries.id, componentLabel: straightCutFries.itemName, quantity: 1, unit: "serving", displayAs: "Straight Cut Fries (base)" },
      { canonicalName: "american cheese yellow 160", quantity: 2, unit: "each", displayAs: "American Cheese" },
      { canonicalName: "cutlery fork full size extra heavy black pp", quantity: 1, unit: "each", displayAs: "Fork" },
    ],
  })

  // Need the Mod: Add Grilled Onion id (it was created earlier in this script run,
  // so we can look it up from DB in case it's already there).
  const addGrilledOnionLookup = await ctx.prisma.recipe.findFirst({
    where: { ownerId: ctx.ownerId, itemName: "Mod: Add Grilled Onion" },
    select: { id: true, itemName: true },
  })

  const loadedFries = await upsertRecipe(ctx, {
    itemName: "Loaded Fries",
    category: "A La Carte",
    isSellable: true,
    notes: "Fries + 2 cheese + sauce (3× a burger's 1.2 oz = 3.6 oz) + 2× grilled onion (2× Mod: Add Grilled Onion) + fork.",
    ingredients: [
      { kind: "component", componentRecipeId: straightCutFries.id, componentLabel: straightCutFries.itemName, quantity: 1, unit: "serving", displayAs: "Straight Cut Fries (base)" },
      { canonicalName: "american cheese yellow 160", quantity: 2, unit: "each", displayAs: "American Cheese" },
      { canonicalName: "chris & eddy's house sauce", quantity: 3.6, unit: "oz", displayAs: "House Sauce (3× burger)" },
      ...(addGrilledOnionLookup
        ? [{ kind: "component" as const, componentRecipeId: addGrilledOnionLookup.id, componentLabel: addGrilledOnionLookup.itemName, quantity: 2, unit: "serving", displayAs: "Grilled onion (2× burger)" }]
        : []),
      { canonicalName: "cutlery fork full size extra heavy black pp", quantity: 1, unit: "each", displayAs: "Fork" },
    ],
  })

  // "Loaded" upgrade modifier (Upgrade Your Fries) — the delta from regular to loaded.
  const loadedUpgrade = await upsertRecipe(ctx, {
    itemName: "Loaded",
    category: "Upgrade Your Fries",
    isSellable: true,
    notes: "Fry upgrade: the 'loaded' toppings added on top of regular fries — 2 cheese + 3.6 oz sauce + 2× grilled onion + fork. (Excludes the base fries themselves.)",
    ingredients: [
      { canonicalName: "american cheese yellow 160", quantity: 2, unit: "each", displayAs: "American Cheese" },
      { canonicalName: "chris & eddy's house sauce", quantity: 3.6, unit: "oz", displayAs: "House Sauce" },
      ...(addGrilledOnionLookup
        ? [{ kind: "component" as const, componentRecipeId: addGrilledOnionLookup.id, componentLabel: addGrilledOnionLookup.itemName, quantity: 2, unit: "serving", displayAs: "Grilled onion (2×)" }]
        : []),
      { canonicalName: "cutlery fork full size extra heavy black pp", quantity: 1, unit: "each", displayAs: "Fork" },
    ],
  })

  // Map the "Loaded" Otter sub-items to the Loaded upgrade recipe.
  await mapOtterSubItemsToRecipe(ctx, {
    skuIds: [
      "37f7707b-147a-4a4e-929a-2f254ed03e4a", // "Loaded" (no sub-header)
      "7d951979-7953-4536-ad78-9b4c6ec84ce3", // "Loaded" (Upgrade Your Fries sub-header)
    ],
    recipe: loadedUpgrade,
    displayName: "Loaded",
  })

  // Combos — slider(s) + fries + minimal takeout packaging (bag + napkins).
  const doubleSliderLookup = await ctx.prisma.recipe.findFirst({
    where: { ownerId: ctx.ownerId, itemName: "Double Slider" },
    select: { id: true, itemName: true },
  })
  const tripleSliderLookup = await ctx.prisma.recipe.findFirst({
    where: { ownerId: ctx.ownerId, itemName: "Triple Slider" },
    select: { id: true, itemName: true },
  })
  if (!doubleSliderLookup || !tripleSliderLookup) throw new Error("Slider recipes not found for combo composition")

  // Every combo includes one premade Extra Chris N Eddy's Sauce cup ($0.50 supplier cost).
  const extraSauceLookup = await ctx.prisma.recipe.findFirst({
    where: { ownerId: ctx.ownerId, itemName: "Extra Chris N Eddy's Sauce" },
    select: { id: true, itemName: true },
  })
  if (!extraSauceLookup) throw new Error("Extra Chris N Eddy's Sauce recipe not found for combo composition")

  await upsertRecipe(ctx, {
    itemName: "1 Slider Combo",
    category: "Combos",
    isSellable: true,
    notes: "1 Double Slider + Straight Cut Fries + premade sauce cup + takeout bag + 2 napkins. No drinks.",
    ingredients: [
      { kind: "component", componentRecipeId: doubleSliderLookup.id, componentLabel: doubleSliderLookup.itemName, quantity: 1, unit: "serving" },
      { kind: "component", componentRecipeId: straightCutFries.id, componentLabel: straightCutFries.itemName, quantity: 1, unit: "serving" },
      { kind: "component", componentRecipeId: extraSauceLookup.id, componentLabel: extraSauceLookup.itemName, quantity: 1, unit: "serving", displayAs: "Sauce cup (included)" },
      { canonicalName: "chrsned bag plas tshirt logo ptsbchrisneddy", quantity: 1, unit: "each", displayAs: "Takeout Bag" },
      { canonicalName: "napkin dispenser 2-ply 8.5 x 6.5 white", quantity: 2, unit: "each", displayAs: "Napkins" },
    ],
  })

  await upsertRecipe(ctx, {
    itemName: "2 Slider Combo",
    category: "Combos",
    isSellable: true,
    notes: "2 Double Sliders + Straight Cut Fries + premade sauce cup + takeout bag + 3 napkins. No drinks.",
    ingredients: [
      { kind: "component", componentRecipeId: doubleSliderLookup.id, componentLabel: doubleSliderLookup.itemName, quantity: 2, unit: "serving" },
      { kind: "component", componentRecipeId: straightCutFries.id, componentLabel: straightCutFries.itemName, quantity: 1, unit: "serving" },
      { kind: "component", componentRecipeId: extraSauceLookup.id, componentLabel: extraSauceLookup.itemName, quantity: 1, unit: "serving", displayAs: "Sauce cup (included)" },
      { canonicalName: "chrsned bag plas tshirt logo ptsbchrisneddy", quantity: 1, unit: "each", displayAs: "Takeout Bag" },
      { canonicalName: "napkin dispenser 2-ply 8.5 x 6.5 white", quantity: 3, unit: "each", displayAs: "Napkins" },
    ],
  })

  await upsertRecipe(ctx, {
    itemName: "Combo 3",
    category: "Combos",
    isSellable: true,
    notes: "2 Triple Sliders + Straight Cut Fries + premade sauce cup + takeout bag + 3 napkins. No drinks.",
    ingredients: [
      { kind: "component", componentRecipeId: tripleSliderLookup.id, componentLabel: tripleSliderLookup.itemName, quantity: 2, unit: "serving" },
      { kind: "component", componentRecipeId: straightCutFries.id, componentLabel: straightCutFries.itemName, quantity: 1, unit: "serving" },
      { kind: "component", componentRecipeId: extraSauceLookup.id, componentLabel: extraSauceLookup.itemName, quantity: 1, unit: "serving", displayAs: "Sauce cup (included)" },
      { canonicalName: "chrsned bag plas tshirt logo ptsbchrisneddy", quantity: 1, unit: "each", displayAs: "Takeout Bag" },
      { canonicalName: "napkin dispenser 2-ply 8.5 x 6.5 white", quantity: 3, unit: "each", displayAs: "Napkins" },
    ],
  })

  // ============================================================
  // Batch 7: drinks + shakes
  // ============================================================
  //
  // Cost math:
  //   Fountain: 1 cup ($0.097) + 1 lid ($0.007) + 1 oz syrup ($0.195) ≈ $0.30
  //   Mexican bottle: 500 ml × $0.0039/ml ≈ $1.94
  //   Water: 16.9 oz × $0.017/oz ≈ $0.28
  //   Shake: 8 oz ice cream mix ($0.80) + cup + lid + optional 1 oz syrup

  // Fix stale canonical data.
  await setCanonicalCostLocked(ctx, {
    name: "greeno cup pet 20 oz c&d pet",
    recipeUnit: "each",
    costPerRecipeUnit: 0.097,
    reason: "Most recent invoice: 2 CS × pack=1000 × 20oz @ $96.55/CS → $0.097/cup. Auto-hydrate mis-picked unit=oz.",
  })
  await setCanonicalCostLocked(ctx, {
    name: "syrup hi-c fruit punch flashin",
    recipeUnit: "gal",
    costPerRecipeUnit: 26.09,
    reason: "Every Hi-C invoice line is consistently $130.45/5gal = $26.09/gal. Auto-hydrate had extracted $0 from bad pricing data on one line.",
  })

  // Fountain drinks — single fountain-drink sub-recipe structure for each flavor.
  const fountainRecipes = [
    { name: "Coca Cola (20 oz cup)", syrup: "syrup coca cola classic" },
    { name: "Diet Coke (20 oz cup)", syrup: "syrup diet coca cola" },
    { name: "Coke Zero (20 oz cup)", syrup: "syrup coca cola zero sugar" },
    { name: "Sprite (20 oz cup)", syrup: "syrup sprite" },
    { name: "Orange Fanta (20 oz cup)", syrup: "syrup orange fanta" },
    { name: "Hi-C (20 oz cup)", syrup: "syrup hi-c fruit punch flashin" },
  ]
  const fountainMade: Array<{ id: string; itemName: string }> = []
  for (const f of fountainRecipes) {
    const r = await upsertRecipe(ctx, {
      itemName: f.name,
      category: "Drinks",
      isSellable: true,
      notes: `20 oz fountain drink. 1 cup + 1 lid + 1 oz ${f.syrup} (ice not tracked).`,
      ingredients: [
        { canonicalName: "greeno cup pet 20 oz c&d pet", quantity: 1, unit: "each", displayAs: "20 oz Cup" },
        { canonicalName: "greeno lid flat with hole 20 oz pe pet", quantity: 1, unit: "each", displayAs: "20 oz Lid" },
        { canonicalName: f.syrup, quantity: 1, unit: "fl oz", displayAs: "Syrup (fountain)" },
      ],
    })
    fountainMade.push(r)
  }

  // Bottled drinks.
  const mexCoke = await upsertRecipe(ctx, {
    itemName: "Mexican Coke 500ml",
    category: "Drinks",
    isSellable: true,
    notes: "500 ml glass-bottle Mexican Coke. One bottle.",
    ingredients: [
      { canonicalName: "soda coke mexican glass", quantity: 500, unit: "ml", displayAs: "Mexican Coke bottle (500 ml)" },
    ],
  })
  const mexFanta = await upsertRecipe(ctx, {
    itemName: "Mexican Fanta 500ml",
    category: "Drinks",
    isSellable: true,
    notes: "500 ml glass-bottle Mexican Orange Fanta. One bottle.",
    ingredients: [
      { canonicalName: "soda orange fanta mexican glass", quantity: 500, unit: "ml", displayAs: "Mexican Fanta bottle (500 ml)" },
    ],
  })
  const water = await upsertRecipe(ctx, {
    itemName: "Water",
    category: "Drinks",
    isSellable: true,
    notes: "16.9 oz Crystal Geyser spring water bottle.",
    ingredients: [
      { canonicalName: "water crystal geyser spring", quantity: 16.9, unit: "oz", displayAs: "Water bottle" },
    ],
  })

  // Shakes (20 oz cup). 8 oz ice cream mix per 20 oz shake (expands when whipped).
  const vanillaShake = await upsertRecipe(ctx, {
    itemName: "Vanilla Shake (20 oz cup)",
    category: "Shakes",
    isSellable: true,
    notes: "20 oz vanilla soft-serve shake. 8 oz vanilla mix + cup + lid.",
    ingredients: [
      { canonicalName: "whole class ice cream mix soft serve vanilla 5%", quantity: 8, unit: "oz", displayAs: "Vanilla Ice Cream Mix" },
      { canonicalName: "greeno cup pet 20 oz c&d pet", quantity: 1, unit: "each", displayAs: "20 oz Cup" },
      { canonicalName: "greeno lid flat with hole 20 oz pe pet", quantity: 1, unit: "each", displayAs: "20 oz Lid" },
    ],
  })
  const chocolateShake = await upsertRecipe(ctx, {
    itemName: "Chocolate Shake (20 oz cup)",
    category: "Shakes",
    isSellable: true,
    notes: "20 oz chocolate shake. 8 oz vanilla mix + 1 oz chocolate syrup + cup + lid.",
    ingredients: [
      { canonicalName: "whole class ice cream mix soft serve vanilla 5%", quantity: 8, unit: "oz", displayAs: "Vanilla Ice Cream Mix" },
      { canonicalName: "lyon medium syrup chocolate free flow", quantity: 1, unit: "fl oz", displayAs: "Chocolate Syrup" },
      { canonicalName: "greeno cup pet 20 oz c&d pet", quantity: 1, unit: "each", displayAs: "20 oz Cup" },
      { canonicalName: "greeno lid flat with hole 20 oz pe pet", quantity: 1, unit: "each", displayAs: "20 oz Lid" },
    ],
  })
  const strawberryShake = await upsertRecipe(ctx, {
    itemName: "Strawberry Shake (20 oz cup)",
    category: "Shakes",
    isSellable: true,
    notes: "20 oz strawberry shake. 8 oz vanilla mix + 1 oz strawberry syrup + cup + lid.",
    ingredients: [
      { canonicalName: "whole class ice cream mix soft serve vanilla 5%", quantity: 8, unit: "oz", displayAs: "Vanilla Ice Cream Mix" },
      { canonicalName: "lyon medium syrup strawberry rtu", quantity: 1, unit: "fl oz", displayAs: "Strawberry Syrup" },
      { canonicalName: "greeno cup pet 20 oz c&d pet", quantity: 1, unit: "each", displayAs: "20 oz Cup" },
      { canonicalName: "greeno lid flat with hole 20 oz pe pet", quantity: 1, unit: "each", displayAs: "20 oz Lid" },
    ],
  })

  // Map shakes — Otter has both "Vanilla Shake" and "Vanilla Shake (20 oz cup)" as distinct items; point both at the same recipe.
  await mapOtterItemsToRecipe(ctx, {
    otterItemNames: ["Vanilla Shake", "Vanilla Shake (20 oz cup)"],
    recipe: vanillaShake,
  })
  await mapOtterItemsToRecipe(ctx, {
    otterItemNames: ["Chocolate Shake", "Chocolate Shake (20 oz cup)"],
    recipe: chocolateShake,
  })
  await mapOtterItemsToRecipe(ctx, {
    otterItemNames: ["Strawberry Shake", "Strawberry Shake (20 oz cup)", "Strawberry Shake "],
    recipe: strawberryShake,
  })

  // Map Mexican bottles (Otter names without "500ml" suffix).
  await mapOtterItemsToRecipe(ctx, {
    otterItemNames: ["Mexican Coke", "Mexican Coke 500ml"],
    recipe: mexCoke,
  })
  await mapOtterItemsToRecipe(ctx, {
    otterItemNames: ["Mexican Fanta", "Mexican Fanta 500ml"],
    recipe: mexFanta,
  })
  await mapOtterItemsToRecipe(ctx, { otterItemNames: ["Water"], recipe: water })

  // Single Patty Slider is Otter's alternate name for Single Slider.
  const singleSliderLookup = await ctx.prisma.recipe.findFirst({
    where: { ownerId: ctx.ownerId, itemName: "Single Slider" },
    select: { id: true, itemName: true },
  })
  if (singleSliderLookup) {
    await mapOtterItemsToRecipe(ctx, {
      otterItemNames: ["Single Patty Slider"],
      recipe: singleSliderLookup,
    })
  }

  // Map "Soda" generic to Coca Cola as a safe default (owner can remap).
  await mapOtterItemsToRecipe(ctx, {
    otterItemNames: ["Soda"],
    recipe: fountainMade[0], // Coca Cola (20 oz cup)
  })

  // ============================================================
  // Batch 8: owner specs — shake qty fix, specialty items, side/pickle redefinition
  // ============================================================
  //
  // Shake mix: invoice CS = 6 × 64oz = 384oz. Owner: 25 shakes per case.
  // Per shake = 384/25 = 15.36 oz of mix.
  //
  // Yellow chilies: 5-gal container = 600 chilies. Canonical gal → each.
  // Per side: 2.5 chilies + 2.5oz portion cup + lid ≈ $0.23.
  //
  // Extra Pickles redefined: 2-3 pickles in a 2.5oz cup + lid (a side-style
  // portion), not a single loose chip on a burger.

  // Fix Yellow Peppers canonical to per-chili.
  await setCanonicalCostLocked(ctx, {
    name: "peppers whole yellow",
    recipeUnit: "each",
    costPerRecipeUnit: 0.0814,
    reason: "5-gal bucket = 600 chilies @ $48.85 → $0.0814/chili.",
  })

  // Fix lid portion canonical: invoice extraction gave nonsense unit=oz. Use
  // owner estimate for per-lid cost. Can be refined later with better invoice data.
  await setCanonicalCostLocked(ctx, {
    name: "lid portion plastic 1.5, 2, 2.5 oz",
    recipeUnit: "each",
    costPerRecipeUnit: 0.015,
    reason: "Estimate: portion lid, ~$0.015/each. Invoice extraction was bad (unit=oz, cost=$1.05/oz nonsense).",
  })

  // Update shakes: 15.36 oz mix per shake (not 8 oz).
  await upsertRecipe(ctx, {
    itemName: "Vanilla Shake (20 oz cup)",
    category: "Shakes",
    isSellable: true,
    notes: "25 shakes per case (6 × 64oz = 384 oz) → 15.36 oz mix per shake. Vanilla mix only.",
    ingredients: [
      { canonicalName: "whole class ice cream mix soft serve vanilla 5%", quantity: 15.36, unit: "oz", displayAs: "Vanilla Ice Cream Mix" },
      { canonicalName: "greeno cup pet 20 oz c&d pet", quantity: 1, unit: "each", displayAs: "20 oz Cup" },
      { canonicalName: "greeno lid flat with hole 20 oz pe pet", quantity: 1, unit: "each", displayAs: "20 oz Lid" },
    ],
  })
  await upsertRecipe(ctx, {
    itemName: "Chocolate Shake (20 oz cup)",
    category: "Shakes",
    isSellable: true,
    notes: "Vanilla mix (15.36 oz) + 1 oz chocolate syrup + cup + lid.",
    ingredients: [
      { canonicalName: "whole class ice cream mix soft serve vanilla 5%", quantity: 15.36, unit: "oz", displayAs: "Vanilla Ice Cream Mix" },
      { canonicalName: "lyon medium syrup chocolate free flow", quantity: 1, unit: "fl oz", displayAs: "Chocolate Syrup" },
      { canonicalName: "greeno cup pet 20 oz c&d pet", quantity: 1, unit: "each", displayAs: "20 oz Cup" },
      { canonicalName: "greeno lid flat with hole 20 oz pe pet", quantity: 1, unit: "each", displayAs: "20 oz Lid" },
    ],
  })
  await upsertRecipe(ctx, {
    itemName: "Strawberry Shake (20 oz cup)",
    category: "Shakes",
    isSellable: true,
    notes: "Vanilla mix (15.36 oz) + 1 oz strawberry syrup + cup + lid.",
    ingredients: [
      { canonicalName: "whole class ice cream mix soft serve vanilla 5%", quantity: 15.36, unit: "oz", displayAs: "Vanilla Ice Cream Mix" },
      { canonicalName: "lyon medium syrup strawberry rtu", quantity: 1, unit: "fl oz", displayAs: "Strawberry Syrup" },
      { canonicalName: "greeno cup pet 20 oz c&d pet", quantity: 1, unit: "each", displayAs: "20 oz Cup" },
      { canonicalName: "greeno lid flat with hole 20 oz pe pet", quantity: 1, unit: "each", displayAs: "20 oz Lid" },
    ],
  })

  // Side of Yellow Chilies — new recipe.
  const sideChilies = await upsertRecipe(ctx, {
    itemName: "Side of Yellow Chilies",
    category: "On The Side",
    isSellable: true,
    notes: "~2.5 pickled yellow chilies in a 2.5 oz portion cup + lid.",
    ingredients: [
      { canonicalName: "peppers whole yellow", quantity: 2.5, unit: "each", displayAs: "Yellow Chilies" },
      { canonicalName: "cup portion plastic 2 oz clear", quantity: 1, unit: "each", displayAs: "2.5 oz Portion Cup" },
      { canonicalName: "lid portion plastic 1.5, 2, 2.5 oz", quantity: 1, unit: "each", displayAs: "2.5 oz Lid" },
    ],
  })
  await mapOtterItemsToRecipe(ctx, {
    otterItemNames: ["Side of Yellow Chilies"],
    recipe: sideChilies,
  })

  // Redefine Extra Pickles as a cup-style side (not loose chip).
  await upsertRecipe(ctx, {
    itemName: "Mod: Extra Pickles",
    category: "Modifier",
    isSellable: false,
    notes: "Redefined: ~2.5 pickle chips in a 2.5 oz portion cup + lid. Same structure as Side of Yellow Chilies.",
    ingredients: [
      { canonicalName: "pickle chips sandwich cut 1/8\"", quantity: 2.5, unit: "each", displayAs: "Pickle Chips" },
      { canonicalName: "cup portion plastic 2 oz clear", quantity: 1, unit: "each", displayAs: "2.5 oz Portion Cup" },
      { canonicalName: "lid portion plastic 1.5, 2, 2.5 oz", quantity: 1, unit: "each", displayAs: "2.5 oz Lid" },
    ],
  })

  // Specialty items.
  const twoSliderComboLookup = await ctx.prisma.recipe.findFirst({
    where: { ownerId: ctx.ownerId, itemName: "2 Slider Combo" },
    select: { id: true, itemName: true },
  })
  const oneSliderComboLookup = await ctx.prisma.recipe.findFirst({
    where: { ownerId: ctx.ownerId, itemName: "1 Slider Combo" },
    select: { id: true, itemName: true },
  })
  if (!twoSliderComboLookup || !oneSliderComboLookup) throw new Error("combo lookups failed")

  // Family Box = 2 × (2 Slider Combo). Composite of already-composed combos.
  const familyBox = await upsertRecipe(ctx, {
    itemName: "The Family Box",
    category: "Combos",
    isSellable: true,
    notes: "Owner: 2 × '2 Slider Combo'. Everything 2 of them would include (sauce cups, bags, napkins, fries).",
    ingredients: [
      { kind: "component", componentRecipeId: twoSliderComboLookup.id, componentLabel: twoSliderComboLookup.itemName, quantity: 2, unit: "serving" },
    ],
  })
  await mapOtterItemsToRecipe(ctx, { otterItemNames: ["The Family Box"], recipe: familyBox })

  // The Triple Pack = 3 Double Sliders + Fries + sauce cup + bag + napkins.
  const triplePack = await upsertRecipe(ctx, {
    itemName: "The Triple Pack",
    category: "Combos",
    isSellable: true,
    notes: "Owner: 3 Double Sliders + Straight Cut Fries + premade sauce cup + takeout bag + 3 napkins. (Name refers to 'triple pack of sliders', not triple sliders.)",
    ingredients: [
      { kind: "component", componentRecipeId: doubleSliderLookup.id, componentLabel: doubleSliderLookup.itemName, quantity: 3, unit: "serving" },
      { kind: "component", componentRecipeId: straightCutFries.id, componentLabel: straightCutFries.itemName, quantity: 1, unit: "serving" },
      { kind: "component", componentRecipeId: extraSauceLookup.id, componentLabel: extraSauceLookup.itemName, quantity: 1, unit: "serving", displayAs: "Sauce cup (included)" },
      { canonicalName: "chrsned bag plas tshirt logo ptsbchrisneddy", quantity: 1, unit: "each", displayAs: "Takeout Bag" },
      { canonicalName: "napkin dispenser 2-ply 8.5 x 6.5 white", quantity: 3, unit: "each", displayAs: "Napkins" },
    ],
  })
  await mapOtterItemsToRecipe(ctx, { otterItemNames: ["The Triple Pack"], recipe: triplePack })

  // Signature Slider Fries & Drink Combo — base (no drink; drink comes in as a modifier).
  const sigCombo = await upsertRecipe(ctx, {
    itemName: "Signature Slider Fries & Drink Combo",
    category: "Combos",
    isSellable: true,
    notes: "Double Slider + Fries + premade sauce cup + bag + 2 napkins. Drink choice arrives as a '+ Drink' modifier (Coca Cola, Mexican Coke, shake, etc.) and its cost folds in at COGS time.",
    ingredients: [
      { kind: "component", componentRecipeId: doubleSliderLookup.id, componentLabel: doubleSliderLookup.itemName, quantity: 1, unit: "serving" },
      { kind: "component", componentRecipeId: straightCutFries.id, componentLabel: straightCutFries.itemName, quantity: 1, unit: "serving" },
      { kind: "component", componentRecipeId: extraSauceLookup.id, componentLabel: extraSauceLookup.itemName, quantity: 1, unit: "serving", displayAs: "Sauce cup (included)" },
      { canonicalName: "chrsned bag plas tshirt logo ptsbchrisneddy", quantity: 1, unit: "each", displayAs: "Takeout Bag" },
      { canonicalName: "napkin dispenser 2-ply 8.5 x 6.5 white", quantity: 2, unit: "each", displayAs: "Napkins" },
    ],
  })
  await mapOtterItemsToRecipe(ctx, {
    otterItemNames: ["Signature Slider Fries & Drink Combo"],
    recipe: sigCombo,
  })

  // Map the "+ Drink" Otter sub-items (from the Signature Combo drink choice) to their respective drink recipes.
  // skuIds for these are pulled from the DB earlier; safe to query dynamically.
  const drinkSubItems = await ctx.prisma.otterOrderSubItem.findMany({
    where: { subHeader: "Combo Drink choice" },
    select: { name: true, skuId: true },
    distinct: ["skuId"],
  })
  const drinkBySkuName = new Map<string, string>()
  for (const s of drinkSubItems) drinkBySkuName.set(s.skuId, s.name)

  // Normalize "+ X" sub-item names to the matching recipe name.
  const drinkMap: Array<{ subName: string; recipeName: string }> = [
    { subName: "+ Coca Cola (20 oz cup)", recipeName: "Coca Cola (20 oz cup)" },
    { subName: "+  Coke Zero (20 oz cup)", recipeName: "Coke Zero (20 oz cup)" },
    { subName: "+ Sprite (20 oz cup)", recipeName: "Sprite (20 oz cup)" },
    { subName: "+ Orange Fanta (20 oz cup)", recipeName: "Orange Fanta (20 oz cup)" },
    { subName: "+ Mexican Coke 500ml", recipeName: "Mexican Coke 500ml" },
    { subName: "+ Strawberry Shake (20 oz cup)", recipeName: "Strawberry Shake (20 oz cup)" },
  ]
  for (const m of drinkMap) {
    const recipe = await ctx.prisma.recipe.findFirst({
      where: { ownerId: ctx.ownerId, itemName: m.recipeName },
      select: { id: true, itemName: true },
    })
    if (!recipe) continue
    const skus = drinkSubItems.filter((s) => s.name === m.subName).map((s) => s.skuId)
    if (skus.length === 0) continue
    await mapOtterSubItemsToRecipe(ctx, {
      skuIds: skus,
      recipe,
      displayName: m.subName,
    })
  }

  // Chris N Eddy's Slider = Double Slider
  await mapOtterItemsToRecipe(ctx, {
    otterItemNames: ["Chris N Eddy's Slider", "Signature Double Patty & Cheese Slider (Chris' or Eddy's Way)"],
    recipe: doubleSliderLookup,
  })

  // "X and Fries" Otter items → existing combo recipes.
  await mapOtterItemsToRecipe(ctx, { otterItemNames: ["1 Slider and Fries"], recipe: oneSliderComboLookup })
  await mapOtterItemsToRecipe(ctx, { otterItemNames: ["2 Sliders and Fries"], recipe: twoSliderComboLookup })
  const combo3Lookup = await ctx.prisma.recipe.findFirst({
    where: { ownerId: ctx.ownerId, itemName: "Combo 3" },
    select: { id: true, itemName: true },
  })
  if (combo3Lookup) {
    await mapOtterItemsToRecipe(ctx, { otterItemNames: ["2 Triples and Fries"], recipe: combo3Lookup })
  }

  // "Straight-Cut Fries" (hyphen) + trailing-space variants → same recipe.
  await mapOtterItemsToRecipe(ctx, {
    otterItemNames: ["Straight-Cut Fries", "Straight Cut Fries ", "Straight Cut Fries"],
    recipe: straightCutFries,
  })

  await prisma.$disconnect()

  if (!COMMIT) {
    console.log(`\n(dry-run — re-run with --commit to apply)\n`)
  }
}

// ---------------------------- helpers ----------------------------

type PrismaLike = Awaited<ReturnType<typeof import("../src/lib/prisma").prisma.$transaction>> extends infer _ ? typeof import("../src/lib/prisma").prisma : never

type Ctx = {
  prisma: typeof import("../src/lib/prisma").prisma
  ownerId: string
  storeIds: string[]
}

async function buildContext(prisma: Ctx["prisma"]): Promise<Ctx> {
  const user = await prisma.user.findFirst({ select: { id: true } })
  if (!user) throw new Error("No user found.")
  const stores = await prisma.store.findMany({
    where: { ownerId: user.id, isActive: true },
    select: { id: true },
  })
  return { prisma, ownerId: user.id, storeIds: stores.map((s) => s.id) }
}

async function setCanonicalCostLocked(
  ctx: Ctx,
  input: { name: string; recipeUnit: string; costPerRecipeUnit: number; reason: string }
) {
  const c = await ctx.prisma.canonicalIngredient.findFirst({
    where: { ownerId: ctx.ownerId, name: input.name },
    select: { id: true, recipeUnit: true, costPerRecipeUnit: true, costLocked: true },
  })
  if (!c) {
    console.log(`  [canonical] NOT FOUND: ${input.name} — skipping`)
    return
  }
  console.log(
    `  [canonical] ${input.name}\n` +
      `      before:  unit=${c.recipeUnit ?? "-"}  cost=${c.costPerRecipeUnit ?? "-"}  locked=${c.costLocked}\n` +
      `      after:   unit=${input.recipeUnit}  cost=$${input.costPerRecipeUnit}  locked=true  [${input.reason}]`
  )
  if (!COMMIT) return
  await ctx.prisma.canonicalIngredient.update({
    where: { id: c.id },
    data: {
      recipeUnit: input.recipeUnit,
      costPerRecipeUnit: input.costPerRecipeUnit,
      costSource: "manual",
      costLocked: true,
      costUpdatedAt: new Date(),
    },
  })
}

type IngredientInput =
  | {
      kind?: "canonical"
      canonicalName: string
      quantity: number
      unit: string
      displayAs?: string
    }
  | {
      kind: "component"
      componentRecipeId: string
      componentLabel: string
      quantity: number
      unit: string
      displayAs?: string
    }

async function upsertRecipe(
  ctx: Ctx,
  input: {
    itemName: string
    category: string
    isSellable: boolean
    notes?: string
    foodCostOverride?: number | null
    ingredients: IngredientInput[]
  }
): Promise<{ id: string; itemName: string }> {
  const existing = await ctx.prisma.recipe.findFirst({
    where: { ownerId: ctx.ownerId, itemName: input.itemName, category: input.category },
    select: { id: true },
  })

  // Resolve each ingredient → either a canonicalId or a componentRecipeId.
  type Resolved = {
    in: IngredientInput
    canonicalId: string | null
    componentRecipeId: string | null
    label: string
  }
  const resolved: Resolved[] = []
  for (const i of input.ingredients) {
    if (i.kind === "component") {
      resolved.push({
        in: i,
        canonicalId: null,
        componentRecipeId: i.componentRecipeId.startsWith("(") ? null : i.componentRecipeId,
        label: i.componentLabel,
      })
    } else {
      const cn = await ctx.prisma.canonicalIngredient.findFirst({
        where: { ownerId: ctx.ownerId, name: i.canonicalName },
        select: { id: true },
      })
      resolved.push({
        in: i,
        canonicalId: cn?.id ?? null,
        componentRecipeId: null,
        label: i.canonicalName,
      })
    }
  }

  console.log(
    `\n  [recipe] ${input.itemName}  [${input.category}]  ${existing ? "(exists — will replace ingredients)" : "(new)"}`
  )
  for (const r of resolved) {
    const hasRef = r.canonicalId || r.componentRecipeId
    const kind = r.componentRecipeId ? "🍱 sub-recipe" : "🥬"
    const tag = hasRef ? `✓ ${kind}` : "✗ MISSING"
    const display = r.in.displayAs ? ` (${r.in.displayAs})` : ""
    console.log(`      ${tag}  ${r.in.quantity} ${r.in.unit}  ${r.label}${display}`)
  }
  const missing = resolved.some((r) => !r.canonicalId && !r.componentRecipeId)
  if (missing) {
    console.log(`      ⚠️  one or more refs missing — recipe not written`)
    return { id: existing?.id ?? "(would be new)", itemName: input.itemName }
  }

  if (!COMMIT) return { id: existing?.id ?? "(would be new)", itemName: input.itemName }

  let recipeId: string
  if (existing) {
    await ctx.prisma.recipeIngredient.deleteMany({ where: { recipeId: existing.id } })
    await ctx.prisma.recipe.update({
      where: { id: existing.id },
      data: {
        notes: input.notes ?? null,
        isSellable: input.isSellable,
        foodCostOverride: input.foodCostOverride ?? null,
        updatedAt: new Date(),
      },
    })
    recipeId = existing.id
  } else {
    const created = await ctx.prisma.recipe.create({
      data: {
        ownerId: ctx.ownerId,
        itemName: input.itemName,
        category: input.category,
        servingSize: 1,
        isSellable: input.isSellable,
        notes: input.notes ?? null,
        foodCostOverride: input.foodCostOverride ?? null,
      },
      select: { id: true },
    })
    recipeId = created.id
  }

  for (const r of resolved) {
    await ctx.prisma.recipeIngredient.create({
      data: {
        recipeId,
        canonicalIngredientId: r.canonicalId,
        componentRecipeId: r.componentRecipeId,
        quantity: r.in.quantity,
        unit: r.in.unit,
        ingredientName: r.in.displayAs ?? null,
      },
    })
  }

  return { id: recipeId, itemName: input.itemName }
}

async function setRecipeOverride(
  ctx: Ctx,
  input: { itemName: string; foodCostOverride: number; reason: string }
) {
  const r = await ctx.prisma.recipe.findFirst({
    where: { ownerId: ctx.ownerId, itemName: input.itemName },
    select: { id: true, foodCostOverride: true },
  })
  if (!r) {
    console.log(`  [recipe-override] NOT FOUND: ${input.itemName} — skipping`)
    return
  }
  console.log(
    `  [recipe-override] ${input.itemName}: ${r.foodCostOverride ?? "-"} → $${input.foodCostOverride}  [${input.reason}]`
  )
  if (!COMMIT) return
  await ctx.prisma.recipe.update({
    where: { id: r.id },
    data: { foodCostOverride: input.foodCostOverride },
  })
}

async function mapOtterItemsToRecipe(
  ctx: Ctx,
  input: { otterItemNames: string[]; recipe: { id: string; itemName: string } }
) {
  console.log(`\n  [item map] ${input.otterItemNames.length} Otter item(s) → ${input.recipe.itemName}`)
  for (const n of input.otterItemNames) console.log(`      "${n}"`)
  if (!COMMIT) return
  if (input.recipe.id === "(would be new)") return
  for (const name of input.otterItemNames) {
    for (const storeId of ctx.storeIds) {
      await ctx.prisma.otterItemMapping.upsert({
        where: { storeId_otterItemName: { storeId, otterItemName: name } },
        create: { storeId, otterItemName: name, recipeId: input.recipe.id },
        update: { recipeId: input.recipe.id, confirmedAt: new Date() },
      })
    }
  }
}

async function mapOtterSubItemsToRecipe(
  ctx: Ctx,
  input: { skuIds: string[]; recipe: { id: string; itemName: string }; displayName: string }
) {
  console.log(`\n  [sub-item map] ${input.skuIds.length} SKU(s) → ${input.recipe.itemName}`)
  for (const sku of input.skuIds) {
    console.log(`      sku=${sku.slice(0, 8)}…  name="${input.displayName}"`)
  }
  if (!COMMIT) return
  if (input.recipe.id === "(would be new)") {
    console.log(`      ⚠️  recipe not written (dry-run or missing canonicals), skipping mapping`)
    return
  }
  for (const sku of input.skuIds) {
    for (const storeId of ctx.storeIds) {
      await ctx.prisma.otterSubItemMapping.upsert({
        where: { storeId_skuId: { storeId, skuId: sku } },
        create: {
          storeId,
          skuId: sku,
          otterSubItemName: input.displayName,
          recipeId: input.recipe.id,
        },
        update: {
          otterSubItemName: input.displayName,
          recipeId: input.recipe.id,
          confirmedAt: new Date(),
        },
      })
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
