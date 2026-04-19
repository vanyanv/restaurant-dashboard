import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import OpenAI from "openai"
import type { AiRecipeSuggestion } from "@/types/product-usage"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY env var is required")
  return new OpenAI({ apiKey, timeout: 60_000 })
}

export async function POST(request: Request) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.strict)
  if (limited) return limited

  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { storeId, items } = body as {
    storeId: string
    items: { itemName: string; category: string }[]
  }

  if (!storeId || !items?.length) {
    return NextResponse.json(
      { error: "storeId and items are required" },
      { status: 400 }
    )
  }

  // Verify ownership
  const store = await prisma.store.findFirst({
    where: { id: storeId, ownerId: session.user.id },
  })
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 })
  }

  // Get invoice products to inform the AI about available ingredients
  const invoiceWhere = {
    ownerId: session.user.id,
    storeId,
    invoiceDate: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
  }

  const lineItems = await prisma.invoiceLineItem.findMany({
    where: { invoice: invoiceWhere },
    select: {
      productName: true,
      category: true,
      unit: true,
    },
    distinct: ["productName"],
  })

  // Get existing recipes for context (owner-level)
  const existingRecipes = await prisma.recipe.findMany({
    where: { ownerId: session.user.id },
    include: { ingredients: true },
    take: 10,
  })

  const ingredientList = lineItems.map(
    (li) => `${li.productName} (${li.category ?? "Other"}, ${li.unit ?? "unit"})`
  )

  const existingRecipeContext = existingRecipes.map(
    (r) =>
      `${r.itemName} (${r.category}): ${r.ingredients.map((i) => `${i.quantity} ${i.unit} ${i.ingredientName}`).join(", ")}`
  )

  const client = getClient()

  const prompt = `You are a restaurant recipe analyst for ChrisNEddys, a slider restaurant. Based on the available ingredients from their invoices and existing recipe patterns, suggest recipes for the following menu items.

## Available Ingredients (from recent invoices)
${ingredientList.join("\n")}

## Existing Configured Recipes (for pattern reference)
${existingRecipeContext.length > 0 ? existingRecipeContext.join("\n") : "No recipes configured yet. This is a slider restaurant — menu includes sliders (small burgers on potato rolls), combos (slider + fries), shakes (vanilla/chocolate/strawberry using soft-serve mix + syrups), fries, and sodas/drinks."}

## Menu Items Needing Recipes
${items.map((i) => `- ${i.itemName} (${i.category})`).join("\n")}

For each menu item, suggest a recipe with realistic ingredient quantities per serving. Return JSON:
{
  "suggestions": [
    {
      "itemName": "exact item name from above",
      "category": "exact category from above",
      "confidence": 0.0-1.0,
      "ingredients": [
        {
          "ingredientName": "canonical ingredient name matching invoice products",
          "quantity": number,
          "unit": "EA|LB|OZ|CS|GAL|SLICE|PUMP|PORTION"
        }
      ],
      "reasoning": "Brief explanation of ingredient choices"
    }
  ]
}

Guidelines:
- Use ingredient names that match or closely relate to the invoice products listed above
- For sliders: typically 1-2 patties, 1 bun (Martin's potato roll), cheese slices, produce
- For combos: same as the slider/item + fries portion + drink
- For shakes: soft-serve ice cream mix portion + flavor syrup pumps
- For fries: frozen fry portion + small amount of frying oil
- Quantities should be per-serving (1 slider, 1 combo, 1 shake, etc.)
- Keep ingredient names clean and canonical (e.g., "Martin's Potato Roll" not the full Sysco name)
- confidence: 0.9+ if clear match to invoice products, 0.7-0.9 if reasonable guess, <0.7 if uncertain`

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 3000,
    })

    const content = response.choices[0]?.message?.content
    if (!content) {
      return NextResponse.json({ suggestions: [] })
    }

    const parsed = JSON.parse(content)
    const suggestions: AiRecipeSuggestion[] = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : []

    return NextResponse.json({ suggestions })
  } catch (err) {
    console.error("AI recipe suggestion failed:", err)
    return NextResponse.json(
      { error: "AI generation failed. Please try again." },
      { status: 500 }
    )
  }
}
