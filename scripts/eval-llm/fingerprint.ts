/**
 * What the golden set was last run against.
 *
 * A paid eval cannot sit in `npm test`, which leaves the obvious hole: edit a
 * prompt, never re-run the eval, and the committed scorecard describes a prompt
 * that no longer ships. This closes it for free — the fingerprint is checked on
 * every push, and it only moves when something that reaches the model moves.
 *
 * Fingerprints are taken over the RENDERED prompt, not the source file. Hashing
 * the file would fire on a comment edit and stay silent when a constant changes
 * the instructions through interpolation — VERDICT_MAX_CHARS is a number in one
 * module and a sentence in the prompt. The model name goes into the hash too: a
 * model swap invalidates a scorecard exactly as thoroughly as a prompt rewrite.
 */

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { VERDICT_MODEL, buildVerdictPrompt } from "@/lib/decision-verdict-llm"
import { PROPOSAL_MODEL, buildProposalPrompt } from "@/lib/proposal-llm"
import { ADJUDICATOR_MODEL, buildAdjudicatorPrompt } from "@/lib/ingredient-match-llm"
import {
  CHAT_CLASSIFIER_MODEL,
  CHAT_REASONING_EFFORT,
  CHAT_ROUTING_MODEL,
} from "@/lib/chat/openai-client"
import {
  GROUP_HINTS,
  NAV_TOOL_GROUPS,
  TOOL_GROUPS,
  activeToolsForPage,
} from "@/lib/chat/tool-groups"
import { composeSystemPrompt, renderToolGuide } from "@/lib/chat/system-prompt"
import { chatTools } from "@/lib/chat/tools"

import {
  ADJUDICATOR_CASES,
  CHAT_CONTEXT,
  PROPOSAL_CASES,
  VERDICT_CASES,
} from "./cases"

export const FINGERPRINTED_FEATURES = [
  "verdict",
  "proposal",
  "adjudicator",
  "chat-tool-choice",
] as const

export type FingerprintedFeature = (typeof FINGERPRINTED_FEATURES)[number]

export const MODELS: Record<FingerprintedFeature, string> = {
  verdict: VERDICT_MODEL,
  proposal: PROPOSAL_MODEL,
  adjudicator: ADJUDICATOR_MODEL,
  "chat-tool-choice": CHAT_ROUTING_MODEL,
}

const sha = (model: string, prompt: string): string =>
  createHash("sha256").update(`${model}\n---\n${prompt}`).digest("hex").slice(0, 16)

/**
 * The tool catalogue as the model sees it for routing.
 *
 * Names and descriptions only. The argument schemas matter for whether a call
 * succeeds, but routing — which is what this eval grades — is decided from the
 * catalogue text, and zod schemas do not serialise to anything stable enough to
 * hash. Sorted so a reordered import cannot move the fingerprint.
 */
export function toolCatalogue(): string {
  return Object.entries(chatTools)
    .map(([name, tool]) => `${name}: ${(tool as { description?: string }).description ?? ""}`)
    .sort()
    .join("\n")
}

/** The exact system prompt the tool-choice eval sends. Frozen, no database. */
export function evalSystemPrompt(): string {
  return composeSystemPrompt(CHAT_CONTEXT)
}

/**
 * THE PROMPT PRODUCTION ACTUALLY SENDS, PER PAGE.
 *
 * `evalSystemPrompt()` renders the UNNARROWED guide, which is what a turn
 * gets only when no department was established. Every question asked from a
 * Counter page is narrowed, so the live golden set grades a prompt most
 * readers never receive, and the largest behavioural change in the chat --
 * cutting the guide and the offered schemas to the page's department -- was
 * outside the free gate entirely.
 *
 * Hashing the guide each nav id renders closes that. It does not make the
 * live run cover narrowed turns (that needs cases carrying a pageId), but it
 * does mean a change to `renderToolGuide`, to `TOOL_GROUPS`, or to a guide
 * block's tool names moves the fingerprint and demands a re-run, which is the
 * thing the free gate is for.
 *
 * Sorted by page id so the map's declaration order cannot move the hash.
 */
export function narrowedGuides(): string {
  const all = Object.keys(chatTools)
  return Object.keys(NAV_TOOL_GROUPS)
    .sort()
    .map((page) => {
      const active = activeToolsForPage(page)
      const { guide } = renderToolGuide(all, active)
      return `## ${page} [${[...(active ?? [])].sort().join(",")}]\n${guide}`
    })
    .join("\n")
}

/**
 * The department list and hints the tool-group classifier is given.
 *
 * Not the classifier's full prompt template — that lives in
 * `tool-group-classifier.ts` and is built around exactly this list. What
 * changes in practice is the list and its hints, and a change to either moves
 * which tools a turn carries.
 */
export function classifierCatalogue(): string {
  return (Object.keys(TOOL_GROUPS) as Array<keyof typeof TOOL_GROUPS>)
    .map((g) => `${g}: ${GROUP_HINTS[g]}`)
    .sort()
    .join("\n")
}

export function promptFingerprints(): Record<FingerprintedFeature, string> {
  return {
    // The first case, not all of them: the fingerprint tracks the *template*,
    // and every case renders through the same one. Hashing all of them would
    // make adding a case look like a prompt change.
    verdict: sha(VERDICT_MODEL, buildVerdictPrompt(VERDICT_CASES[0].facts)),
    proposal: sha(PROPOSAL_MODEL, buildProposalPrompt(PROPOSAL_CASES[0].input)),
    adjudicator: sha(
      ADJUDICATOR_MODEL,
      buildAdjudicatorPrompt({ cases: ADJUDICATOR_CASES[0].cases }),
    ),
    /*
     * Model, EFFORT, the system prompt, the tool catalogue and the classifier's
     * own prompt.
     *
     * Effort and the classifier were both outside this hash, and both decide
     * what the model does with the prompt that is inside it. `/api/chat`'s own
     * note records `minimal` degrading tool routing — the exact behaviour this
     * feature grades — so the setting could have moved from `low` to `minimal`
     * with the recorded scorecard going on describing a run that no longer
     * happened. The classifier is the same argument: `GROUP_HINTS` decides
     * which schemas a turn carries when the page establishes no department, so
     * editing one of those lines changes what the model is offered without
     * touching a single character of the prompt.
     */
    "chat-tool-choice": sha(
      `${CHAT_ROUTING_MODEL}:${CHAT_REASONING_EFFORT}:${CHAT_CLASSIFIER_MODEL}`,
      `${evalSystemPrompt()}\n\n# Tools\n${toolCatalogue()}\n\n# Classifier\n${classifierCatalogue()}` +
        `\n\n# Narrowed\n${narrowedGuides()}`,
    ),
  }
}

export interface FingerprintRecord {
  sha256: string
  model: string
  /** ISO date of the live run that produced the numbers below. */
  evaluatedAt: string
  cases: number
  passed: number
  passRate: number
  costUsd: number
  /** The gate this feature must clear. */
  floor: number
  /**
   * The prompt changed and the paid eval has NOT been re-run against it.
   *
   * The fingerprint tripwire has exactly one failure mode: somebody edits a
   * prompt, finds the test red, pastes in the new hash, and the committed
   * scorecard now vouches for a run that never happened. That is the
   * permanently-green gate this repo has fixed four times elsewhere.
   *
   * So a hash may be refreshed without the eval, but only wearing this, and
   * `tests/scripts/eval-llm-fingerprint.test.ts` holds the other half of the
   * bargain: a record marked pending must have `passed: 0`, `passRate: 0` and
   * `costUsd: 0`. There is no way to record a pass you did not measure.
   */
  pendingReEval?: boolean
  /** Why it is pending and what to run. Required when `pendingReEval`. */
  pendingReason?: string
}

export const FINGERPRINTS_PATH = join(__dirname, "fingerprints.json")

export function recordedFingerprints(): Record<FingerprintedFeature, FingerprintRecord> {
  return JSON.parse(readFileSync(FINGERPRINTS_PATH, "utf8"))
}

/** Floors the live runner gates on, read from the same file the test checks. */
export function floors(): Record<string, number> {
  const recorded = recordedFingerprints()
  return Object.fromEntries(
    FINGERPRINTED_FEATURES.map((f) => [f, recorded[f]?.floor ?? 1]),
  )
}
