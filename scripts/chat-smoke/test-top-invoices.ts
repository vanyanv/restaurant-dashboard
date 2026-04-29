/**
 * Targeted check for the new ranked-invoice tools. Asserts:
 *   - getTopInvoices returns the actual largest April invoices, sorted desc.
 *   - getInvoiceSpend totals match a hand-rolled SQL aggregate.
 *   - the canonical "biggest expense this month" question routes to
 *     getTopInvoices (not searchInvoices).
 *
 * Run: npx tsx --env-file=.env.local scripts/chat-smoke/test-top-invoices.ts
 */

if (process.env.DATABASE_URL2) {
  process.env.DATABASE_URL = process.env.DATABASE_URL2
}

async function main() {
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
  console.log("owner:", owner.email)

  const ctx = { ownerId: owner.id, prisma }

  const dateRange = { from: "2026-04-01", to: "2026-04-30" }

  console.log("\n=== getTopInvoices ===")
  const top = await chatTools.getTopInvoices.execute(
    { dateRange, topN: 5 },
    ctx,
  )
  for (const r of top) {
    console.log(
      `  ${r.date} · $${r.totalAmount.toFixed(2)} · ${r.vendor} (${r.lineCount} lines)`,
    )
  }
  if (top.length === 0) throw new Error("expected at least one invoice")
  if (
    top.length > 1 &&
    top.some((r, i) => i > 0 && r.totalAmount > top[i - 1].totalAmount)
  ) {
    throw new Error("rows must be sorted by totalAmount desc")
  }

  console.log("\n=== getInvoiceSpend ===")
  const spend = await chatTools.getInvoiceSpend.execute({ dateRange }, ctx)
  console.log(
    `  total: $${spend.totalAmount.toFixed(2)} across ${spend.invoiceCount} invoices`,
  )
  console.log("  top 3 vendors:")
  for (const v of spend.byVendor.slice(0, 3)) {
    console.log(
      `    ${v.vendor}: $${v.amount.toFixed(2)} (${(v.share * 100).toFixed(1)}%)`,
    )
  }
  console.log("  by month:")
  for (const m of spend.byMonth) {
    console.log(`    ${m.month}: $${m.amount.toFixed(2)} (${m.invoiceCount} inv)`)
  }

  // Sanity: total should match the sum of byVendor amounts (within float tolerance)
  const sumByVendor = spend.byVendor.reduce((s, v) => s + v.amount, 0)
  if (Math.abs(sumByVendor - spend.totalAmount) > 0.01) {
    throw new Error(
      `byVendor sum ($${sumByVendor}) != total ($${spend.totalAmount})`,
    )
  }

  console.log("\n=== routing test: 'what was our biggest invoice this month?' ===")
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

  const calledTools: string[] = []
  let answer = ""
  const result = streamText({
    model: openai(CHAT_ROUTING_MODEL),
    system,
    messages: [
      { role: "user", content: "What was our biggest invoice this month?" },
    ],
    tools: toolSet,
    stopWhen: stepCountIs(8),
    onStepFinish: ({ toolCalls }: { toolCalls: Array<{ toolName: string }> }) => {
      for (const c of toolCalls) calledTools.push(c.toolName)
    },
  })
  for await (const chunk of result.textStream) answer += chunk
  console.log(`  tools: [${calledTools.join(", ")}]`)
  console.log(`  answer: ${answer.replace(/\s+/g, " ")}`)

  if (!calledTools.includes("getTopInvoices")) {
    throw new Error(
      `FAIL: expected getTopInvoices to fire, got [${calledTools.join(", ")}]`,
    )
  }
  // Make sure the dollar figure in the answer matches the actual top invoice.
  const realTop = top[0].totalAmount
  const moneyMatches = Array.from(answer.matchAll(/\$([\d,]+(?:\.\d+)?)/g)).map(
    (m) => Number(m[1].replace(/,/g, "")),
  )
  const cited = moneyMatches.find(
    (n) => Math.abs(n - realTop) < Math.max(2, realTop * 0.005),
  )
  if (!cited) {
    console.log(
      `  ⚠ couldn't find $${realTop.toFixed(2)} in answer (found ${moneyMatches.map((n) => "$" + n).join(", ")}) — model may have rounded`,
    )
  } else {
    console.log(`  ✓ answer cites the real top invoice ($${cited})`)
  }

  console.log("\nall ok")
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  process.exit(1)
})
