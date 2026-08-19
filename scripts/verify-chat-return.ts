/**
 * Live check that the model actually files an Answer Block.
 *
 * The Answer Block degrades silently: if `fileReturn` is never called the chat
 * falls back to the old prose layout and looks fine, so a broken contract is
 * invisible in the UI. This script runs real turns through the same system
 * prompt and tool set `/api/chat` builds, then reports what was filed and
 * which form it would render.
 *
 *   npx tsx --env-file=.env.local scripts/verify-chat-return.ts
 *   npx tsx --env-file=.env.local scripts/verify-chat-return.ts "your question"
 *
 * Costs a handful of gpt-5-mini calls with tools. Run it after touching the
 * filing rules in system-prompt.ts or the fileReturn schema.
 *
 * One-time local setup: the tool registry reaches server actions that import
 * `server-only`, a module Next resolves internally and npm never installs, so
 * tsx cannot resolve it. Stub it once:
 *
 *   mkdir -p node_modules/server-only
 *   echo 'module.exports = {};' > node_modules/server-only/index.js
 *   echo '{"name":"server-only","main":"index.js"}' > node_modules/server-only/package.json
 *
 * It lives only in node_modules, is never committed, and the Next build does
 * not use it (the bundler aliases `server-only` to its own copy).
 */
import { convertToModelMessages, stepCountIs, streamText, tool, type ToolSet } from "ai"
import { openai } from "@ai-sdk/openai"
import { prisma } from "@/lib/prisma"
import { chatTools } from "@/lib/chat/tools"
import { buildSystemPrompt } from "@/lib/chat/system-prompt"
import { CHAT_ROUTING_MODEL } from "@/lib/chat/openai-client"
import { selectFiledReturn, returnForm, type ReturnPart } from "@/lib/chat/return"

/** Each probe names the form the filing rules say it should produce. */
const PROBES: Array<{ q: string; expect: "full" | "short" | "empty"; why: string }> = [
  {
    q: "How were sales last week?",
    expect: "full",
    why: "a comparison — should file two or three figures",
  },
  {
    // Deliberately unambiguous. An open-ended "best day" invites a clarifying
    // question, which is a different turn shape and files nothing by design.
    q: "What were net sales last Saturday?",
    expect: "short",
    why: "one fact — should file one figure, not three padded ones",
  },
  {
    q: "How do customers feel about the new fries?",
    expect: "empty",
    why: "out of scope — should file department 'No data' with no figures",
  },
]

async function main() {
  const custom = process.argv.slice(2).filter((a) => !a.startsWith("-"))
  const probes = custom.length
    ? custom.map((q) => ({ q, expect: null as null, why: "custom probe" }))
    : PROBES

  const owner = await prisma.user.findFirst({
    where: { role: "OWNER" },
    select: { id: true, accountId: true, email: true },
  })
  if (!owner) {
    console.error("No OWNER user found — cannot build an owner-scoped prompt.")
    process.exit(1)
  }
  console.log(`Model: ${CHAT_ROUTING_MODEL}`)
  console.log(`Owner: ${owner.email}\n`)

  const ctx = { ownerId: owner.id, accountId: owner.accountId, prisma }
  const toolSet: ToolSet = Object.fromEntries(
    Object.values(chatTools).map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: t.parameters,
        execute: async (args: unknown) => t.execute(args as never, ctx) as Promise<unknown>,
      }),
    ]),
  )
  const system = await buildSystemPrompt(owner.accountId)

  let failures = 0

  for (const probe of probes) {
    console.log("─".repeat(72))
    console.log(`ASK  ${probe.q}`)
    console.log(`WANT ${probe.expect ?? "(any)"} — ${probe.why}\n`)

    const started = Date.now()
    const parts: ReturnPart[] = []
    const toolsCalled: string[] = []

    const result = streamText({
      model: openai(CHAT_ROUTING_MODEL),
      system,
      messages: await convertToModelMessages([
        { id: "u1", role: "user", parts: [{ type: "text", text: probe.q }] },
      ] as never),
      tools: toolSet,
      stopWhen: stepCountIs(15),
      onStepFinish: ({ toolResults }) => {
        for (const tr of toolResults) {
          toolsCalled.push(tr.toolName)
          parts.push({
            type: `tool-${tr.toolName}`,
            toolName: tr.toolName,
            state: "output-available",
            output: tr.output,
          })
        }
      },
    })

    const text = await result.text
    const seconds = ((Date.now() - started) / 1000).toFixed(1)

    const filed = selectFiledReturn(parts)
    console.log(`tools  ${toolsCalled.join(" → ") || "(none)"}`)
    console.log(`time   ${seconds}s`)

    if (!filed) {
      failures++
      console.log("\n  ✗ NO RETURN FILED — this turn falls back to the prose layout.")
      console.log(`  text: ${text.slice(0, 200)}\n`)
      continue
    }

    const form = returnForm(filed)
    const ok = probe.expect === null || form === probe.expect
    if (!ok) failures++

    console.log(`\n  ${ok ? "✓" : "✗"} filed a ${form} return`)
    console.log(`  verdict     ${filed.verdict}`)
    console.log(`  department  ${filed.department}`)
    console.log(`  scope       ${filed.scope || "(none)"}`)
    for (const f of filed.figures) {
      const d = f.delta ? ` ${f.delta}${f.direction ? ` (${f.direction})` : ""}` : ""
      console.log(`  figure      ${f.value.padEnd(12)} ${f.label}${d}`)
    }
    if (filed.followUps.length) {
      for (const q of filed.followUps) console.log(`  follow-up   ${q}`)
    }
    const note = text.trim().split("\n")[0]
    console.log(`  note        ${note.slice(0, 90)}${note.length > 90 ? "…" : ""}`)
    console.log()
  }

  console.log("─".repeat(72))
  console.log(failures === 0 ? "All probes filed as expected." : `${failures} probe(s) off.`)
  await prisma.$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
