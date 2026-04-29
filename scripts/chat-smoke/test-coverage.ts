/**
 * Phase 2 coverage smoke test. Drives ~25 canonical questions through the
 * full chat tool surface (v1 + Phase 2 additions). Each case asserts at
 * least one tool from `expectAny` fired and that the model's prose body
 * obeys the show-don't-list rule for entity tools (≤2 sentences).
 *
 * Run: npx tsx --env-file=.env.local scripts/chat-smoke/test-coverage.ts
 *      npx tsx --env-file=.env.local scripts/chat-smoke/test-coverage.ts --only=7
 */

if (process.env.DATABASE_URL2) {
  process.env.DATABASE_URL = process.env.DATABASE_URL2
}

interface CoverageQuestion {
  ask: string
  /** At least one of these must have fired. `__none__` = expected refusal. */
  expectAny: string[]
  /** When set, every name listed must have been called. */
  expectAll?: string[]
  /** When true, the model is expected to defer to an inline card; the
   *  prose body must be ≤2 sentences. */
  showDontList?: boolean
}

const QUESTIONS: CoverageQuestion[] = [
  // ── Sales (legacy)
  { ask: "What were total sales last week?", expectAny: ["getDailySales", "compareSales"] },
  { ask: "What hour are we busiest on Saturdays?", expectAny: ["getHourlyTrend"] },
  { ask: "What share of sales is DoorDash vs Uber Eats lately?", expectAny: ["getPlatformBreakdown", "getDailySales"] },
  // ── compareSales (Phase 2)
  { ask: "How does this week compare to last week?", expectAny: ["compareSales", "getDailySales"] },
  { ask: "March vs February — net sales delta?", expectAny: ["compareSales", "getDailySales"] },
  // ── Per-store (Phase 2)
  { ask: "Which store is doing best this month?", expectAny: ["getStoreBreakdown"] },
  { ask: "What are our fixed costs at every location?", expectAny: ["getOperationalCosts"] },
  { ask: "What's our COGS target?", expectAny: ["getOperationalCosts"] },
  // ── Menu — show, don't list
  { ask: "What's the price of the chocolate shake at Hollywood?", expectAny: ["getMenuPrices", "getMenuItemDetails", "searchMenuItems"] },
  { ask: "How's the chocolate shake doing this month?", expectAny: ["getMenuItemDetails", "searchMenuItems"], showDontList: true },
  { ask: "Top 5 best sellers this month.", expectAny: ["getTopMenuItems"] },
  { ask: "Find a vanilla milkshake on our menu.", expectAny: ["searchMenuItems", "getMenuPrices"] },
  // ── Recipes (Phase 2) — show, don't list
  { ask: "What's in the slider recipe?", expectAny: ["getRecipeByName", "searchRecipes"], showDontList: true },
  { ask: "Show me the burger recipe.", expectAny: ["getRecipeByName", "searchRecipes"], showDontList: true },
  { ask: "Do we have a recipe for fries?", expectAny: ["searchRecipes", "getRecipeByName"] },
  // ── COGS / ingredients
  { ask: "What are our top 5 items by revenue this month?", expectAny: ["getCogsByItem", "getTopMenuItems"] },
  { ask: "What's the cost of cheese?", expectAny: ["getIngredientPrices"] },
  // ── Invoices — show, don't list (the originally-broken question)
  { ask: "Show me the biggest invoice from April.", expectAny: ["getTopInvoices", "getInvoiceById"], showDontList: true },
  { ask: "What was our biggest expense this month?", expectAny: ["getTopInvoices", "getInvoiceSpend"] },
  { ask: "Top 5 invoices this month.", expectAny: ["getTopInvoices"] },
  { ask: "How much did we spend on supplies last month?", expectAny: ["getInvoiceSpend"] },
  { ask: "Who's our biggest vendor?", expectAny: ["getInvoiceSpend"] },
  { ask: "What did we spend on chicken thighs in March?", expectAny: ["searchInvoices"] },
  // ── Refunds (Phase 2)
  { ask: "How much did we refund last week?", expectAny: ["getRefunds"] },
  { ask: "Which platform had the most refunds last month?", expectAny: ["getRefunds"] },
  // ── Refusals (still hold from v1)
  { ask: "How are customers feeling about our service this month?", expectAny: ["__none__"] },
  { ask: "What will sales look like next week?", expectAny: ["__none__"] },
]

function sentenceCount(text: string): number {
  // Cheap split on `.`/`?`/`!` followed by space or end. Strips the
  // provenance footer first so it doesn't inflate the count.
  const stripped = text.replace(/\n+\s*From\s+[^\n]+$/i, "").trim()
  return stripped
    .split(/[.!?]+\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .length
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--only="))
  const only = arg ? Number(arg.split("=")[1]) : null

  const { prisma } = await import("../../src/lib/prisma")
  const { chatTools } = await import("../../src/lib/chat/tools")
  const { buildSystemPrompt } = await import("../../src/lib/chat/system-prompt")
  const { CHAT_ROUTING_MODEL } = await import("../../src/lib/chat/openai-client")
  const { streamText, tool, stepCountIs } = await import("ai")
  const { openai } = await import("@ai-sdk/openai")

  const owner = await prisma.user.findFirst({
    where: { ownedStores: { some: {} } },
    select: { id: true, email: true },
  })
  if (!owner) throw new Error("no owner with stores found")
  console.log(`owner: ${owner.email}\nmodel: ${CHAT_ROUTING_MODEL}\n`)

  const ctx = { ownerId: owner.id, prisma }
  const system = await buildSystemPrompt(owner.id)

  const toolSet = Object.fromEntries(
    Object.values(chatTools).map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: t.parameters,
        execute: async (args: unknown) =>
          (t.execute as (a: unknown, c: typeof ctx) => Promise<unknown>)(
            args,
            ctx,
          ),
      }),
    ]),
  )

  let pass = 0
  let fail = 0
  const failures: Array<{ idx: number; ask: string; reason: string }> = []

  for (let i = 0; i < QUESTIONS.length; i++) {
    if (only !== null && only !== i + 1) continue
    const q = QUESTIONS[i]
    console.log(`\n━━ Q${i + 1}: ${q.ask}`)

    const calledTools: string[] = []
    let answer = ""

    try {
      const result = streamText({
        model: openai(CHAT_ROUTING_MODEL),
        system,
        messages: [{ role: "user", content: q.ask }],
        tools: toolSet,
        stopWhen: stepCountIs(8),
        onStepFinish: ({ toolCalls }: { toolCalls: Array<{ toolName: string }> }) => {
          for (const c of toolCalls) calledTools.push(c.toolName)
        },
      })

      for await (const chunk of result.textStream) {
        answer += chunk
      }

      console.log(`   tools: [${calledTools.join(", ") || "(none)"}]`)
      console.log(`   answer: ${answer.replace(/\s+/g, " ").slice(0, 240)}…`)

      const reasons: string[] = []

      let toolOk = false
      if (q.expectAny.includes("__none__")) {
        toolOk = calledTools.length === 0
        if (!toolOk) reasons.push(`expected refusal, got: ${calledTools.join(", ")}`)
      } else {
        toolOk = q.expectAny.some((name) => calledTools.includes(name))
        if (toolOk && q.expectAll) {
          const missing = q.expectAll.filter((n) => !calledTools.includes(n))
          if (missing.length > 0) {
            toolOk = false
            reasons.push(`missing required tools: ${missing.join(", ")}`)
          }
        }
        if (!toolOk && reasons.length === 0) {
          reasons.push(
            `expected one of [${q.expectAny.join(", ")}], got [${calledTools.join(", ")}]`,
          )
        }
      }

      // Style guards.
      if (answer.includes("—") || answer.includes(" -- ")) {
        reasons.push("answer contains an em dash")
      }
      if (q.showDontList && sentenceCount(answer) > 2) {
        reasons.push(
          `show-don't-list: prose body has ${sentenceCount(answer)} sentences (≤2 expected)`,
        )
      }

      if (reasons.length === 0 && toolOk) {
        pass++
        console.log("   ✓ pass")
      } else {
        fail++
        const msg = reasons.join(" | ")
        failures.push({ idx: i + 1, ask: q.ask, reason: msg })
        console.log(`   ✗ fail — ${msg}`)
      }
    } catch (err) {
      fail++
      const msg = err instanceof Error ? err.message : String(err)
      failures.push({ idx: i + 1, ask: q.ask, reason: `threw: ${msg}` })
      console.log(`   ✗ fail — ${msg}`)
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`pass: ${pass}   fail: ${fail}   total: ${pass + fail}`)
  if (failures.length) {
    console.log("\nfailures:")
    for (const f of failures) {
      console.log(`  Q${f.idx}: ${f.ask}\n     ${f.reason}`)
    }
  }
  await prisma.$disconnect()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
