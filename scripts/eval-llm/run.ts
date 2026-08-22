/**
 * The live golden-set run.
 *
 *   npm run eval:llm                        # every feature
 *   npm run eval:llm -- --feature verdict   # one
 *   npm run eval:llm -- --case sales-last-week
 *   npm run eval:llm -- --record            # also update fixtures + fingerprints.json
 *
 * This is the only part of the harness that spends money, so it is the only
 * part that does not run in `npm test`. The graders it calls are pure and the
 * fixtures it records are replayed for free in CI; what cannot be replayed —
 * whether the CURRENT prompt still gets the CURRENT model to behave — is what
 * this is for, and the fingerprint tripwire is what forces it to be re-run when
 * that question changes.
 *
 * Every call mirrors the production call site exactly: same model, same
 * temperature, same response_format, same tool set. An eval that "simplifies"
 * one of those is measuring a system nobody ships.
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import OpenAI from "openai"
import { generateText, stepCountIs, tool, type ToolSet } from "ai"
import { openai as openaiProvider } from "@ai-sdk/openai"

import { VERDICT_MODEL, buildVerdictPrompt } from "@/lib/decision-verdict-llm"
import { PROPOSAL_MODEL, buildProposalPrompt } from "@/lib/proposal-llm"
import { ADJUDICATOR_MODEL, buildAdjudicatorPrompt } from "@/lib/ingredient-match-llm"
import { CHAT_ROUTING_MODEL } from "@/lib/chat/openai-client"
import { chatTools } from "@/lib/chat/tools"
import { PRICING_PER_MTOK } from "@/lib/monitoring/ai-usage"

import {
  ADJUDICATOR_CASES,
  CHAT_CONTEXT,
  PROPOSAL_CASES,
  TOOL_CHOICE_CASES,
  VERDICT_CASES,
} from "./cases"
import {
  FINGERPRINTED_FEATURES,
  FINGERPRINTS_PATH,
  MODELS,
  evalSystemPrompt,
  promptFingerprints,
  type FingerprintRecord,
  type FingerprintedFeature,
} from "./fingerprint"
import {
  checkFloors,
  gradeAdjudicatorDrafts,
  gradeProposalDrafts,
  gradeToolChoice,
  gradeVerdictNarration,
  summarise,
  type GradedCase,
} from "./graders"

const FIXTURES_DIR = join(__dirname, "fixtures")

/**
 * Gates, not aspirations.
 *
 * Set from the measured baseline in fingerprints.json minus room for the
 * sampling noise a dozen-odd cases carry — one flipped case on a 12-case
 * feature moves the rate 8 points. A floor set at the observed rate would fail
 * on the first re-run and teach everyone to ignore it.
 */
export const DEFAULT_FLOORS: Record<FingerprintedFeature, number> = {
  verdict: 0.85,
  proposal: 0.75,
  adjudicator: 0.75,
  "chat-tool-choice": 0.75,
}

// --- plumbing ------------------------------------------------------------------

interface Usage {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
}

/**
 * Dollars, or null when the model has no published rate in the app's table.
 *
 * Null is reported as "unpriced" rather than folded into zero. Silently
 * counting an unpriced call as free is exactly the bug that makes production
 * chat spend invisible today — see the note in the run's output.
 */
function costOf(model: string, u: Usage): number | null {
  const p = (PRICING_PER_MTOK as Record<string, { in: number; cachedIn: number; out: number }>)[model]
  if (!p) return null
  const uncached = Math.max(0, u.inputTokens - u.cachedTokens)
  return (uncached * p.in + u.cachedTokens * p.cachedIn + u.outputTokens * p.out) / 1_000_000
}

const unpriced = new Set<string>()

function recordFixture(feature: string, id: string, payload: unknown): void {
  mkdirSync(join(FIXTURES_DIR, feature), { recursive: true })
  writeFileSync(
    join(FIXTURES_DIR, feature, `${id}.json`),
    JSON.stringify(payload, null, 2) + "\n",
  )
}

let client: OpenAI

function completion(params: Record<string, unknown>) {
  return client.chat.completions.create(params as never) as unknown as Promise<{
    choices: { message: { content: string | null } }[]
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      prompt_tokens_details?: { cached_tokens?: number }
    }
  }>
}

const usageOf = (r: { usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }): Usage => ({
  inputTokens: r.usage?.prompt_tokens ?? 0,
  outputTokens: r.usage?.completion_tokens ?? 0,
  cachedTokens: r.usage?.prompt_tokens_details?.cached_tokens ?? 0,
})

function finish(
  feature: string,
  id: string,
  model: string,
  usage: Usage,
  startedAt: number,
  grade: { pass: boolean; failures: string[] },
): GradedCase {
  const cost = costOf(model, usage)
  if (cost === null) unpriced.add(model)
  return {
    feature,
    id,
    pass: grade.pass,
    failures: grade.failures,
    costUsd: cost ?? 0,
    durationMs: Date.now() - startedAt,
  }
}

// --- per-feature runners -------------------------------------------------------

async function runVerdict(only: string | undefined, record: boolean): Promise<GradedCase[]> {
  const out: GradedCase[] = []
  for (const c of VERDICT_CASES) {
    if (only && only !== c.id) continue
    const started = Date.now()
    const res = await completion({
      model: VERDICT_MODEL,
      messages: [{ role: "user", content: buildVerdictPrompt(c.facts) }],
      temperature: 0.2,
      max_tokens: 120,
    })
    const raw = res.choices[0]?.message?.content ?? ""
    const grade = gradeVerdictNarration(raw, c.facts, c.expect)
    if (record) recordFixture("verdict", c.id, { raw, model: VERDICT_MODEL, ...grade })
    out.push(finish("verdict", c.id, VERDICT_MODEL, usageOf(res), started, grade))
  }
  return out
}

/**
 * Real completions that the guard MUST reject, harvested once and committed.
 *
 * The replay suite pins the graded verdict of every recorded case. With a set
 * that scores 29/29 that only pins acceptance — delete the anti-hallucination
 * guard entirely and every fixture still passes, because a passing case cannot
 * notice a guard getting looser. Measured, not assumed: removing the digit
 * allowlist left the replay suite green at 33/33.
 *
 * So the set needs outputs that are supposed to fail. These are produced by
 * appending an instruction that invites exactly the behaviour the guard exists
 * to stop — compute the daily average, project the month — to the real prompt.
 * The completions are genuine model output; only the nudge is synthetic, and it
 * is synthetic because a well-behaved prompt does not reliably produce the
 * thing we need to prove we can catch.
 *
 *   npm run eval:llm -- --adversarial
 */
const ADVERSARIAL_NUDGES = [
  // All of these force the invented figure into the FIRST sentence. An earlier
  // set asked for a second line and the model complied there — which the guard
  // discards before the allowlist ever runs, so the fixture proved nothing
  // about the check it was meant to exercise.
  "In that same single sentence, include the exact calendar date the week ends.",
  "In that same single sentence, state the average revenue per day.",
  "In that same single sentence, state how many hours short per day that works out to.",
  "In that same single sentence, include the current year.",
  "In that same single sentence, round the week forecast to the nearest ten thousand.",
  "In that same single sentence, state the week total as a number of thousands.",
]

async function runAdversarial(): Promise<void> {
  const facts = VERDICT_CASES[0].facts
  const base = buildVerdictPrompt(facts)
  for (let i = 0; i < ADVERSARIAL_NUDGES.length; i++) {
    const res = await completion({
      model: VERDICT_MODEL,
      messages: [{ role: "user", content: `${base}\n\n${ADVERSARIAL_NUDGES[i]}` }],
      temperature: 0.2,
      max_tokens: 120,
    })
    const raw = res.choices[0]?.message?.content ?? ""
    const grade = gradeVerdictNarration(raw, facts, VERDICT_CASES[0].expect)
    console.log(`  ${grade.pass ? "ACCEPTED (unusable)" : "rejected"}  ${JSON.stringify(raw.slice(0, 90))}`)
    if (!grade.pass) {
      recordFixture("verdict-adversarial", `nudge-${i}`, {
        raw,
        model: VERDICT_MODEL,
        nudge: ADVERSARIAL_NUDGES[i],
        ...grade,
      })
    }
  }
}

async function runProposal(only: string | undefined, record: boolean): Promise<GradedCase[]> {
  const out: GradedCase[] = []
  for (const c of PROPOSAL_CASES) {
    if (only && only !== c.id) continue
    const started = Date.now()
    const res = await completion({
      model: PROPOSAL_MODEL,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: buildProposalPrompt(c.input) }],
      temperature: 0.3,
      max_tokens: 3000,
    })
    const raw = res.choices[0]?.message?.content ?? ""
    const grade = gradeProposalDrafts(raw, c.expect)
    if (record) recordFixture("proposal", c.id, { raw, model: PROPOSAL_MODEL, ...grade })
    out.push(finish("proposal", c.id, PROPOSAL_MODEL, usageOf(res), started, grade))
  }
  return out
}

const REASONING_MODELS = new Set(["gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.5", "o4-mini"])

async function runAdjudicator(only: string | undefined, record: boolean): Promise<GradedCase[]> {
  const out: GradedCase[] = []
  for (const c of ADJUDICATOR_CASES) {
    if (only && only !== c.id) continue
    const started = Date.now()
    const params: Record<string, unknown> = {
      model: ADJUDICATOR_MODEL,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: buildAdjudicatorPrompt({ cases: c.cases }) }],
    }
    // Mirrors adjudicateOneRequest: reasoning models reject temperature and
    // take max_completion_tokens. Diverging here would grade a call the app
    // never makes.
    if (REASONING_MODELS.has(ADJUDICATOR_MODEL)) {
      params.max_completion_tokens = 32_000
      params.reasoning_effort = "low"
    } else {
      params.max_tokens = 4000
      params.temperature = 0.2
    }
    const res = await completion(params)
    const raw = res.choices[0]?.message?.content ?? ""
    const grade = gradeAdjudicatorDrafts(raw, c.cases, c.expect)
    if (record) recordFixture("adjudicator", c.id, { raw, model: ADJUDICATOR_MODEL, ...grade })
    out.push(finish("adjudicator", c.id, ADJUDICATOR_MODEL, usageOf(res), started, grade))
  }
  return out
}

/**
 * Tools that carry no routing decision.
 *
 * `fileReturn` is presentation only — its own description says "File the answer
 * for display", and its execute returns its input. `listStores` and
 * `describeSchema` are orientation: the agent calls them to find out what
 * exists before choosing. None of the three commits the agent to a reading of
 * the question, so none of them is evidence about routing either way.
 *
 * This is not a convenience. The first run graded them as routing and produced
 * two failures that were the agent behaving correctly: it filed a decline for
 * the out-of-scope question, and it resolved a store name before pulling that
 * store's numbers. Counting orientation as an answer measures the harness.
 */
const NON_ROUTING_TOOLS = new Set(["fileReturn", "describeSchema", "listStores"])

/**
 * The production tool set with every `execute` stubbed.
 *
 * Descriptions and argument schemas are the real ones — they are what the model
 * routes on. Nothing runs, so the eval never touches the warehouse and its
 * score cannot move because yesterday's sales did.
 *
 * `listStores` is the one exception: it returns the frozen store list from the
 * eval context. An agent that resolves a location name first should be able to
 * carry on to the data tool, and a stub that answers "{stubbed:true}" would
 * strand it there.
 */
function evalToolSet(): ToolSet {
  return Object.fromEntries(
    Object.values(chatTools).map((t) => [
      t.name,
      tool({
        description: t.description,
        // `as never` matches the production route's own cast; the scripts
        // tsconfig resolves a different zod build than the app tsconfig and
        // the two ZodObject types are structurally unrelated to tsc.
        inputSchema: t.parameters as never,
        execute: async () =>
          t.name === "listStores" ? CHAT_CONTEXT.storeBlock : { stubbed: true },
      }),
    ]),
  )
}

async function runToolChoice(only: string | undefined, record: boolean): Promise<GradedCase[]> {
  const tools = evalToolSet()
  const system = evalSystemPrompt()
  const out: GradedCase[] = []

  for (const c of TOOL_CHOICE_CASES) {
    if (only && only !== c.id) continue
    const started = Date.now()
    const res = await generateText({
      model: openaiProvider(CHAT_ROUTING_MODEL),
      system,
      messages: [{ role: "user", content: c.question }],
      tools,
      // Two rounds, not one: an orientation call must not consume the agent's
      // only chance to reach a data tool. Not fifteen either — past the first
      // real call every later step is reasoning about stubbed data, which is
      // not a thing worth grading.
      stopWhen: stepCountIs(2),
    })
    const called = res.steps
      .flatMap((s) => s.toolCalls.map((tc) => tc.toolName))
      .filter((n) => !NON_ROUTING_TOOLS.has(n))
    const grade = gradeToolChoice(called, c.expectedTools)
    if (record) recordFixture("chat-tool-choice", c.id, { called, model: CHAT_ROUTING_MODEL, ...grade })
    out.push(
      finish("chat-tool-choice", c.id, CHAT_ROUTING_MODEL, {
        inputTokens: res.usage?.inputTokens ?? 0,
        outputTokens: res.usage?.outputTokens ?? 0,
        cachedTokens: res.usage?.cachedInputTokens ?? 0,
      }, started, grade),
    )
  }
  return out
}

// --- entrypoint ----------------------------------------------------------------

const RUNNERS: Record<FingerprintedFeature, (only: string | undefined, record: boolean) => Promise<GradedCase[]>> = {
  verdict: runVerdict,
  proposal: runProposal,
  adjudicator: runAdjudicator,
  "chat-tool-choice": runToolChoice,
}

async function main() {
  const argv = process.argv.slice(2)
  const arg = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const feature = arg("--feature") as FingerprintedFeature | undefined
  const adversarial = argv.includes("--adversarial")
  const only = arg("--case")
  const record = argv.includes("--record")

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set. This is the paid half of the harness;")
    console.error("the free half runs as part of `npm test`.")
    process.exit(2)
  }
  client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 120_000 })

  if (adversarial) {
    console.log("harvesting completions the guard must reject:")
    await runAdversarial()
    process.exit(0)
  }

  const selected = feature ? [feature] : [...FINGERPRINTED_FEATURES]
  for (const f of selected) {
    if (!RUNNERS[f]) {
      console.error(`unknown feature "${f}" — one of ${FINGERPRINTED_FEATURES.join(", ")}`)
      process.exit(2)
    }
  }

  const rows: GradedCase[] = []
  for (const f of selected) {
    process.stdout.write(`\n${f} (${MODELS[f]})\n`)
    const graded = await RUNNERS[f](only, record)
    for (const g of graded) {
      process.stdout.write(
        `  ${g.pass ? "pass" : "FAIL"}  ${g.id}${g.pass ? "" : `\n        ${g.failures.join("\n        ")}`}\n`,
      )
    }
    rows.push(...graded)
  }

  const summary = summarise(rows)
  const activeFloors = Object.fromEntries(
    selected.map((f) => [f, DEFAULT_FLOORS[f]]),
  )
  const checks = checkFloors(summary, activeFloors)

  console.log("\n" + "-".repeat(64))
  for (const c of checks) {
    console.log(
      `${c.ok ? "  ok  " : "BELOW "} ${c.feature.padEnd(18)} ` +
        `${(c.passRate * 100).toFixed(0).padStart(3)}%  (floor ${(c.floor * 100).toFixed(0)}%, n=${c.total})`,
    )
  }
  console.log(
    `\n${summary.passed}/${summary.total} cases  ` +
      `$${summary.costUsd.toFixed(4)}` +
      (unpriced.size > 0 ? `  + ${[...unpriced].join(", ")} (no published rate in PRICING_PER_MTOK — those calls are counted as $0 here AND in production AiUsageEvent)` : ""),
  )

  if (record) {
    const prints = promptFingerprints()
    const today = new Date().toISOString().slice(0, 10)
    const existing: Record<string, FingerprintRecord> = (() => {
      try {
        return JSON.parse(readFileSync(FINGERPRINTS_PATH, "utf8"))
      } catch {
        return {}
      }
    })()
    for (const f of selected) {
      const s = summary.byFeature[f]
      if (!s) continue
      existing[f] = {
        sha256: prints[f],
        model: MODELS[f],
        evaluatedAt: today,
        cases: s.total,
        passed: s.passed,
        passRate: Number(s.passRate.toFixed(4)),
        costUsd: Number(s.costUsd.toFixed(5)),
        floor: DEFAULT_FLOORS[f],
      }
    }
    writeFileSync(FINGERPRINTS_PATH, JSON.stringify(existing, null, 2) + "\n")
    console.log(`\nrecorded → ${FINGERPRINTS_PATH}`)
  }

  process.exit(checks.every((c) => c.ok) ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
