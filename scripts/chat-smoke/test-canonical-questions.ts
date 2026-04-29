/**
 * Integration smoke test for the chat routing layer. For each canonical
 * question, runs `streamText` with the same tool set + system prompt the
 * /api/chat route uses, asserts the expected tool family fired, and prints
 * the final answer + tool trace. Owner is the first user with stores in
 * DATABASE_URL2.
 *
 * Run: npx tsx --env-file=.env.local scripts/chat-smoke/test-canonical-questions.ts
 *      npx tsx --env-file=.env.local scripts/chat-smoke/test-canonical-questions.ts --only=3
 */

if (process.env.DATABASE_URL2) {
  process.env.DATABASE_URL = process.env.DATABASE_URL2
}

interface CanonicalQuestion {
  ask: string
  /** At least one of these tool names must have been called for the case to pass. */
  expectAny: string[]
  /** When set, every name listed must have been called. */
  expectAll?: string[]
}

const QUESTIONS: CanonicalQuestion[] = [
  {
    ask: "What were total sales last week?",
    expectAny: ["getDailySales"],
  },
  {
    ask: "How did sales last month compare to the month before?",
    expectAny: ["getDailySales"],
  },
  {
    ask: "What hour are we busiest on Saturdays?",
    expectAny: ["getHourlyTrend"],
  },
  {
    ask: "What share of sales is DoorDash vs Uber Eats lately?",
    expectAny: ["getPlatformBreakdown", "getDailySales"],
  },
  {
    ask: "What are our top 5 items by revenue this month?",
    expectAny: ["getCogsByItem"],
  },
  {
    ask: "What's the price of the chocolate shake at Hollywood?",
    expectAny: ["getMenuPrices"],
  },
  {
    ask: "What's the cost of cheese?",
    expectAny: ["getIngredientPrices"],
  },
  {
    // Note: when searchInvoices returns no relevant hits, the model is
    // *expected* to refuse rather than total irrelevant rows. So we only
    // assert that the search ran; sumInvoiceLines is conditional.
    ask: "What did we spend on chicken thighs in March?",
    expectAny: ["searchInvoices"],
  },
  {
    ask: "Find a vanilla milkshake on our menu.",
    expectAny: ["searchMenuItems", "getMenuPrices"],
  },
  {
    // The system prompt injects the owner's store list, so the model
    // typically answers from context without a tool call. Either path
    // (listStores or none) is acceptable.
    ask: "Which stores do I run?",
    expectAny: ["listStores", "__none__"],
  },
  {
    ask: "How are customers feeling about our service this month?",
    // Refusal — no tool calls expected. We mark this as ok if zero tools fired.
    expectAny: ["__none__"],
  },
  {
    ask: "What will sales look like next week?",
    expectAny: ["__none__"],
  },
]

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

  // Same wrapping as /api/chat/route.ts
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

      let ok = false
      if (q.expectAny.includes("__none__")) {
        ok = calledTools.length === 0
      } else {
        ok = q.expectAny.some((name) => calledTools.includes(name))
        if (ok && q.expectAll) {
          ok = q.expectAll.every((name) => calledTools.includes(name))
        }
      }

      if (ok) {
        pass++
        console.log("   ✓ pass")
      } else {
        fail++
        const reason = q.expectAny.includes("__none__")
          ? `expected refusal (no tool calls), got: ${calledTools.join(", ")}`
          : `expected one of [${q.expectAny.join(", ")}]${q.expectAll ? ` AND all of [${q.expectAll.join(", ")}]` : ""}, got [${calledTools.join(", ")}]`
        failures.push({ idx: i + 1, ask: q.ask, reason })
        console.log(`   ✗ fail — ${reason}`)
      }
    } catch (err) {
      fail++
      const msg = err instanceof Error ? err.message : String(err)
      failures.push({ idx: i + 1, ask: q.ask, reason: `threw: ${msg}` })
      console.log(`   ✗ fail — ${msg}`)
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`pass: ${pass}   fail: ${fail}`)
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
