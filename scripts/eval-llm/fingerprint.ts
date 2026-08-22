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
import { CHAT_ROUTING_MODEL } from "@/lib/chat/openai-client"
import { composeSystemPrompt } from "@/lib/chat/system-prompt"
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
    "chat-tool-choice": sha(
      CHAT_ROUTING_MODEL,
      `${evalSystemPrompt()}\n\n# Tools\n${toolCatalogue()}`,
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
