# Ingredient Auto-Match Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-link new invoice line items to canonical ingredients with zero errors against the human-confirmed matches already in the database, deferring to human review whenever certainty is not reached.

> **Superseded by measurement (2026-07-28).** Two things in this plan turned out wrong and the tasks below still carry the original wording:
> - **Gold set is 260 cases, not 486.** 486 counted distinct `(vendor, sku, productName)` triples; keyed on what the matcher actually consumes — the product name — there are 260 distinct decisions, covering 68 of the 75 canonicals that matched lines touch. Read "486" below as "the gold set".
> - **Auto-create is cancelled.** At `FLOOR=0.72`, 88 of 260 cases that *have* a correct existing ingredient classify as `new` and would create duplicates (33.8%). Lowering FLOOR to 0.44 routes all 88 to human review and costs nothing — auto-link coverage is flat at 147 across that whole range. Tasks 8-13 must not wire `new` to creation.

**Architecture:** A layered resolution ladder runs after the existing deterministic matcher: cross-store exact name (free) → pgvector similarity with a runner-up margin guard → an LLM adjudicator over only the ambiguous band → auto-create gated on a low-similarity floor. Every auto-action writes an `IngredientMatchDecision` audit row that is reversible in one click, and an undo permanently suppresses that pairing. Thresholds are not guessed — they are selected by an offline bake-off against existing confirmed matches, which is built and run **before** any feature code depends on it.

**Tech Stack:** TypeScript, Next.js 15 App Router, Prisma 7 / Postgres (Neon) with pgvector, OpenAI (chat + `text-embedding-3-small`), Vitest, tsx scripts.

## Global Constraints

- **Provider is OpenAI only.** No second LLM provider is introduced. Reuse the patterns in `src/lib/proposal-llm.ts`.
- **Migrations:** `prisma db push` plus a hand-written `prisma/manual-migrations/YYYY-MM-DD_*.sql`. **Never `prisma migrate dev`** — it would reset the Neon production database.
- **Dashboard UI** on `/dashboard/**` must follow `docs/frontend-patterns.md`: editorial tokens only (`--ink`, `--ink-muted`, `--ink-faint`, `--paper`, `--hairline`, `--hairline-bold`, `--accent`), never generic Tailwind palette colors. Numbers render DM Sans 500–600 with `tabular-nums lining-nums`; captions/SKUs in JetBrains Mono; Fraunces italic for prose and display titles only. Sections are `.inv-panel`, not shadcn `<Card>`. Interactive rows use the `.inv-row` hover pattern.
- **File size:** keep new files under 400 lines. Splitting or restructuring any existing file over 400 lines requires reading `docs/refactor-playbook.md` first.
- **Tests** live in `tests/lib/*.test.ts`, run with `npm test` (Vitest, node environment, `@` aliased to `src`). Prisma is mocked with `vi.mock("@/lib/prisma", () => ({ prisma: {} }))` — see `tests/lib/cogs-materializer.test.ts`.
- **OpenAI budget is ~$5.** Eval rounds are sized deliberately; do not run full-set LLM arms without the shortlist round first.
- **Commits** carry no `Co-Authored-By: Claude` line.

## Ship Gate

Tasks 1–7 exist to answer one question before any feature code is written:

> Of everything this ladder chooses to auto-link, does it disagree with the human-confirmed matches even once?

**The gate passes** when some (arm, threshold set) achieves **zero errors on the full gold set**, with coverage high enough to be worth building. Coverage at the zero-error point is the headline number.

**If no arm passes**, stop. Do not implement Tasks 8–13 as specified. The documented fallback is the pre-filled one-click proposal — the runner-up design option, which needs no accuracy guarantee. Report the numbers and re-decide.

### Gate result (Tasks 1-4, 2026-07-28)

**Passed for auto-link, on vector similarity alone.** At HIGH=0.72 / MARGIN=0.10, under grouped k-fold by `expectedCanonicalId`: **147/147 correct, 0 wrong, 56.5% coverage** (64.6% excluding two provably mislabeled gold cases, since corrected in production by `c5550a0`). Token overlap — the heuristic shipping today — is **disqualified**: its zero-error tuning threshold produced 2 wrong on held-out ingredients.

Qualifications that belong with that number:
- Safety sits in the **gate, not the matcher**. The top pick is wrong on 11 of 260 cases; all 11 are abstained. Two wrong picks are excluded by a margin under 0.01, and embedding scores drift up to 0.0017 between identical runs — the buffer is thin relative to measurement noise.
- 260 cases cover 68 ingredient families, so the honest 95% bound on the true error rate is ~6%, not 0%.
- Every gold case is one the deterministic SKU layer already resolves, so these are upper bounds.

Tasks 5-7 proceed for **coverage**, not safety. An LLM arm earns its place only by resolving abstentions correctly; buying coverage with any wrong link fails.

Tasks 8–13 are intentionally specified at interface level rather than full code, because the gate's outcome (which model, which thresholds, or fallback) materially changes them. Expand them into full bite-sized steps once Task 7 reports.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/ingredient-embedding-sync.ts` | Write/refresh one `CanonicalIngredientEmbedding` row (Task 1) |
| `src/lib/ingredient-match-scoring.ts` | Pure: candidate classification, thresholds, query-text builder (Task 2) |
| `src/lib/ingredient-match-llm.ts` | Prompt build + defensive parse for the adjudicator (Task 5) |
| `src/lib/ingredient-auto-match.ts` | Session-free orchestration of the ladder (Task 9) |
| `src/app/actions/ingredient-auto-match-actions.ts` | `listRecentAutoMatches`, `undoAutoMatch` (Task 10) |
| `src/app/dashboard/ingredients/components/auto-match-activity.tsx` | Activity strip (Task 12) |
| `scripts/eval-ingredient-match/gold.ts` | Build the gold set from confirmed matches (Task 3) |
| `scripts/eval-ingredient-match/arms.ts` | One resolver per arm (Tasks 4, 6) |
| `scripts/eval-ingredient-match/run.ts` | CLI runner (Tasks 4, 6, 7) |
| `scripts/eval-ingredient-match/report.ts` | Markdown report into `runs/` (Task 4) |
| `tests/lib/ingredient-match-scoring.test.ts` | Task 2 |
| `tests/lib/ingredient-match-llm.test.ts` | Task 5 |
| `tests/lib/ingredient-auto-match.test.ts` | Tasks 9, 10 |

---

### Task 1: Embedding write-back

Today `CanonicalIngredientEmbedding` is written only by `scripts/backfill-embeddings.ts`, run by hand. Creating a `CanonicalIngredient` writes no embedding, and there is no cron. Coverage is 76/76 right now purely by luck of a recent manual run. The vector layer decays from the next ingredient onward unless this lands first.

**Files:**
- Create: `src/lib/ingredient-embedding-sync.ts`
- Modify: `src/app/actions/ingredient-match-actions.ts:252-264` (the `newCanonical` create path in `confirmSkuMatch`)
- Test: `tests/lib/ingredient-embedding-sync.test.ts`

**Interfaces:**
- Consumes: `embed`, `toVectorLiteral` from `@/lib/chat/embeddings`; `prisma` from `@/lib/prisma`
- Produces: `buildCanonicalIngredientText(name, category, aliasNames): string`, `syncCanonicalEmbedding(canonicalId: string): Promise<"written" | "unchanged" | "skipped">`

Note `buildCanonicalIngredientText` already exists inside `scripts/backfill-embeddings.ts`. Move it into the new lib module and have the script import it, so the two paths cannot drift — a drift here silently changes what vectors mean.

- [ ] **Step 1: Write the failing test for the text builder**

```ts
import { describe, it, expect, vi } from "vitest"
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
import { buildCanonicalIngredientText } from "@/lib/ingredient-embedding-sync"

describe("buildCanonicalIngredientText", () => {
  it("folds name, category and aliases into one string", () => {
    const text = buildCanonicalIngredientText("Ground Beef 73/27", "Protein", [
      "GRND BEEF 73/27 CREEKSTONE",
    ])
    expect(text).toContain("Ground Beef 73/27")
    expect(text).toContain("Protein")
    expect(text).toContain("GRND BEEF 73/27 CREEKSTONE")
  })

  it("omits the category segment when null", () => {
    const text = buildCanonicalIngredientText("Kosher Salt", null, [])
    expect(text).toContain("Kosher Salt")
    expect(text.toLowerCase()).not.toContain("null")
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- ingredient-embedding-sync`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module, moving the builder out of the backfill script**

Read the current implementation at `scripts/backfill-embeddings.ts` (search `buildCanonicalIngredientText`) and move it verbatim into `src/lib/ingredient-embedding-sync.ts`, exported. Then add:

```ts
import { prisma } from "@/lib/prisma"
import { embed, toVectorLiteral, snapshotHash } from "@/lib/chat/embeddings"

// snapshotHash MUST be the shared one from chat/embeddings.ts — it normalizes
// (lowercase + whitespace collapse) before hashing. Defining a local raw-text
// hash here makes this path and scripts/backfill-embeddings.ts disagree about
// whether a row changed, so each would spuriously re-embed the other's rows —
// the exact drift this task exists to remove.

/**
 * Write or refresh one canonical's embedding row. Idempotent: re-running with
 * unchanged text is a no-op, so callers never pay for a redundant embed.
 * Never throws — an embedding failure must not fail the mutation that
 * triggered it.
 */
export async function syncCanonicalEmbedding(
  canonicalId: string
): Promise<"written" | "unchanged" | "skipped"> {
  try {
    const ci = await prisma.canonicalIngredient.findUnique({
      where: { id: canonicalId },
      select: {
        id: true, ownerId: true, accountId: true, name: true, category: true,
        aliases: { select: { rawName: true } },
      },
    })
    if (!ci) return "skipped"

    const text = buildCanonicalIngredientText(
      ci.name, ci.category, ci.aliases.map((a) => a.rawName)
    )
    const hash = snapshotHash(text)

    const existing = await prisma.$queryRawUnsafe<Array<{ contentSnapshot: string }>>(
      `SELECT "contentSnapshot" FROM "CanonicalIngredientEmbedding"
        WHERE "canonicalIngredientId" = $1`,
      canonicalId,
    )
    if (existing[0]?.contentSnapshot === hash) return "unchanged"

    const vec = await embed(text)
    await prisma.$executeRawUnsafe(
      `DELETE FROM "CanonicalIngredientEmbedding" WHERE "canonicalIngredientId" = $1`,
      canonicalId,
    )
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CanonicalIngredientEmbedding"
         (id, "canonicalIngredientId", "ownerId", "accountId", "category", "name",
          "contentSnapshot", embedding, "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7::vector, NOW())`,
      canonicalId, ci.ownerId, ci.accountId, ci.category, ci.name, hash,
      toVectorLiteral(vec),
    )
    return "written"
  } catch (e) {
    console.warn("[syncCanonicalEmbedding] failed:", e)
    return "skipped"
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- ingredient-embedding-sync`
Expected: PASS.

- [ ] **Step 5: Point the backfill script at the shared builder**

In `scripts/backfill-embeddings.ts`, delete the local `buildCanonicalIngredientText` definition and import it from `../src/lib/ingredient-embedding-sync`. Leave the rest of the script alone.

- [ ] **Step 6: Call it from the canonical-create path**

In `src/app/actions/ingredient-match-actions.ts`, after the `prisma.canonicalIngredient.create(...)` block that assigns `canonicalId = created.id` (around line 254–264):

```ts
    await syncCanonicalEmbedding(created.id)
```

Add the import at the top: `import { syncCanonicalEmbedding } from "@/lib/ingredient-embedding-sync"`. It never throws, so no try/catch is needed.

- [ ] **Step 7: Verify nothing regressed**

Run: `npm test && npx tsc --noEmit`
Expected: all green.

Then confirm the refactor did not change what gets embedded — re-running the backfill must report every canonical as skipped, because the shared builder produces byte-identical text to the old inline one:

```bash
npx tsx scripts/backfill-embeddings.ts --ingredients-only
```

Expected: 76 canonicals, **0 embedded, 76 skipped**. Any non-zero embed count means the moved builder changed its output, which would silently shift every vector's meaning — stop and diff the two implementations before continuing.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ingredient-embedding-sync.ts tests/lib/ingredient-embedding-sync.test.ts \
        scripts/backfill-embeddings.ts src/app/actions/ingredient-match-actions.ts
git commit -m "feat(ingredients): write embedding on canonical create, share snapshot builder"
```

---

### Task 2: Pure scoring and classification

The whole safety argument rests on this module, and it has no I/O — so it is fully testable and must be written first.

**Files:**
- Create: `src/lib/ingredient-match-scoring.ts`
- Test: `tests/lib/ingredient-match-scoring.test.ts`

**Interfaces:**
- Produces:
  - `type MatchCandidate = { canonicalIngredientId: string; name: string; score: number }`
  - `type Classification = { kind: "auto"; candidate: MatchCandidate; margin: number } | { kind: "ambiguous"; candidates: MatchCandidate[] } | { kind: "new" }`
  - `const THRESHOLDS: { HIGH: number; MARGIN: number; FLOOR: number; LLM_ACCEPT: number }`
  - `classifyCandidates(candidates: MatchCandidate[], t?: typeof THRESHOLDS): Classification`
  - `buildMatchQueryText(input: { productName: string; vendorName: string; unit: string | null }): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest"
import {
  classifyCandidates, buildMatchQueryText, THRESHOLDS,
  type MatchCandidate,
} from "@/lib/ingredient-match-scoring"

const c = (name: string, score: number): MatchCandidate => ({
  canonicalIngredientId: `id-${name}`, name, score,
})

describe("classifyCandidates", () => {
  it("auto-links a clear winner above HIGH with sufficient margin", () => {
    const r = classifyCandidates([c("Ground Beef 73/27", 0.95), c("Ground Beef 80/20", 0.80)])
    expect(r.kind).toBe("auto")
    if (r.kind === "auto") {
      expect(r.candidate.name).toBe("Ground Beef 73/27")
      expect(r.margin).toBeCloseTo(0.15)
    }
  })

  it("refuses to auto-link a near-tie even when both score very high", () => {
    // The load-bearing guard: "GRND BEEF 73/27" must not silently pick a grade.
    const r = classifyCandidates([c("Ground Beef 73/27", 0.93), c("Ground Beef 80/20", 0.92)])
    expect(r.kind).toBe("ambiguous")
  })

  it("sends the mid band to the adjudicator", () => {
    const r = classifyCandidates([c("Ground Beef 73/27", 0.80), c("Chuck Roll", 0.60)])
    expect(r.kind).toBe("ambiguous")
  })

  it("reports 'new' when every candidate is below FLOOR", () => {
    const r = classifyCandidates([c("Ground Beef 73/27", 0.51), c("Chuck Roll", 0.40)])
    expect(r.kind).toBe("new")
  })

  it("reports 'new' for an empty pantry", () => {
    expect(classifyCandidates([]).kind).toBe("new")
  })

  it("auto-links a lone high-scoring candidate (no runner-up to tie with)", () => {
    expect(classifyCandidates([c("Kosher Salt", 0.97)]).kind).toBe("auto")
  })

  it("does not assume input is sorted", () => {
    const r = classifyCandidates([c("Chuck Roll", 0.40), c("Kosher Salt", 0.97)])
    expect(r.kind).toBe("auto")
    if (r.kind === "auto") expect(r.candidate.name).toBe("Kosher Salt")
  })

  it("caps the ambiguous shortlist at five candidates", () => {
    const many = Array.from({ length: 12 }, (_, i) => c(`ing-${i}`, 0.80 - i * 0.001))
    const r = classifyCandidates(many)
    expect(r.kind).toBe("ambiguous")
    if (r.kind === "ambiguous") expect(r.candidates).toHaveLength(5)
  })

  it("honours injected thresholds", () => {
    const strict = { ...THRESHOLDS, HIGH: 0.99 }
    expect(classifyCandidates([c("Kosher Salt", 0.95)], strict).kind).toBe("ambiguous")
  })
})

describe("buildMatchQueryText", () => {
  it("includes product, vendor and unit", () => {
    const t = buildMatchQueryText({
      productName: "GRND BEEF 73/27", vendorName: "Sysco", unit: "CS",
    })
    expect(t).toContain("GRND BEEF 73/27")
    expect(t).toContain("Sysco")
    expect(t).toContain("CS")
  })

  it("omits a null unit without leaving a dangling separator", () => {
    const t = buildMatchQueryText({ productName: "Kosher Salt", vendorName: "Sysco", unit: null })
    expect(t).not.toMatch(/\|\s*$/)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- ingredient-match-scoring`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// Pure classification for invoice-line → canonical-ingredient matching.
// No I/O: every safety property of auto-matching is decided here and is
// therefore fully testable. Thresholds are set by the offline bake-off
// (scripts/eval-ingredient-match), never guessed in place.

export type MatchCandidate = {
  canonicalIngredientId: string
  name: string
  /** Cosine similarity 0..1 — higher is closer. */
  score: number
}

export type Classification =
  | { kind: "auto"; candidate: MatchCandidate; margin: number }
  | { kind: "ambiguous"; candidates: MatchCandidate[] }
  | { kind: "new" }

/**
 * Calibrated by scripts/eval-ingredient-match against the account's confirmed
 * matches. HIGH/MARGIN gate a silent auto-link; FLOOR gates auto-creation
 * (below it, nothing in the pantry is close enough to be a duplicate);
 * LLM_ACCEPT gates accepting the adjudicator's answer.
 */
export const THRESHOLDS = {
  HIGH: 0.9,
  MARGIN: 0.05,
  FLOOR: 0.72,
  LLM_ACCEPT: 0.85,
} as const

const SHORTLIST = 5

export function classifyCandidates(
  candidates: MatchCandidate[],
  t: { HIGH: number; MARGIN: number; FLOOR: number; LLM_ACCEPT: number } = THRESHOLDS
): Classification {
  if (candidates.length === 0) return { kind: "new" }

  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  const top = sorted[0]
  if (top.score < t.FLOOR) return { kind: "new" }

  const runnerUp = sorted[1]?.score ?? 0
  const margin = top.score - runnerUp

  // Both conditions required. A high score with a close runner-up is exactly
  // the grade/size-variant case ("73/27" vs "80/20") where a silent pick is
  // worse than asking — it would move COGS with no signal that it guessed.
  if (top.score >= t.HIGH && margin >= t.MARGIN) {
    return { kind: "auto", candidate: top, margin }
  }

  return { kind: "ambiguous", candidates: sorted.slice(0, SHORTLIST) }
}

export function buildMatchQueryText(input: {
  productName: string
  vendorName: string
  unit: string | null
}): string {
  return [input.productName, input.vendorName, input.unit]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join(" | ")
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npm test -- ingredient-match-scoring`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingredient-match-scoring.ts tests/lib/ingredient-match-scoring.test.ts
git commit -m "feat(ingredients): pure candidate classification with runner-up margin guard"
```

---

### Task 3: Gold-set builder

**Files:**
- Create: `scripts/eval-ingredient-match/gold.ts`
- Modify: `package.json` (add `"eval:ingredient-match": "tsx scripts/eval-ingredient-match/run.ts"`)

**Interfaces:**
- Produces: `type GoldCase`, `buildGoldSet(): Promise<{ cases: GoldCase[]; excluded: number; pantrySize: number }>`, `loadEnvLocal(): Promise<void>`

```ts
export type GoldCase = {
  /** Stable across runs: normalized vendor + sku-or-name. */
  id: string
  vendorName: string
  sku: string | null
  productName: string
  unit: string | null
  expectedCanonicalId: string
  expectedCanonicalName: string
  source: "sku" | "alias"
  occurrences: number
}
```

- [ ] **Step 1: Create the module**

Copy `loadEnvLocal()` verbatim from `scripts/eval-chat/run.ts:253-274` into this file (the eval scripts run outside Next, so `.env.local` is not auto-loaded).

Query every matched line item grouped to distinct `(normalized vendor, sku, productName) → canonical`:

```ts
const rows = await prisma.$queryRawUnsafe<Array<{
  vendorName: string; sku: string | null; productName: string; unit: string | null
  canonicalIngredientId: string; canonicalName: string
  matchSource: string | null; occurrences: number
}>>(`
  SELECT i."vendorName", li.sku, li."productName", li.unit,
         li."canonicalIngredientId", ci.name AS "canonicalName",
         li."matchSource", COUNT(*)::int AS occurrences
    FROM "InvoiceLineItem" li
    JOIN "Invoice" i ON i.id = li."invoiceId"
    JOIN "CanonicalIngredient" ci ON ci.id = li."canonicalIngredientId"
   WHERE li."canonicalIngredientId" IS NOT NULL
   GROUP BY i."vendorName", li.sku, li."productName", li.unit,
            li."canonicalIngredientId", ci.name, li."matchSource"
`)
```

- [ ] **Step 2: Apply the leakage exclusion**

`buildCanonicalIngredientText` folds alias `rawName`s into the canonical's embedding text. Any gold case whose `productName` is an alias raw name is therefore being scored against its own answer key, and would inflate vector accuracy in a way that vanishes on real new products. Exclude them:

```ts
const aliasNames = new Set(
  (await prisma.ingredientAlias.findMany({ select: { rawName: true } }))
    .map((a) => a.rawName.trim().toLowerCase())
)
const kept = rows.filter((r) => !aliasNames.has(r.productName.trim().toLowerCase()))
```

Report `excluded = rows.length - kept.length` so the report can state it plainly.

- [ ] **Step 3: Normalize vendor and build stable ids**

Use `normalizeVendorName` from `../../src/lib/vendor-normalize`, and key **unconditionally on the product name** — never on sku:

```ts
const vendor = normalizeVendorName(r.vendorName)
const id = `${vendor}::name::${r.productName.trim().toLowerCase()}`
```

Do **not** reuse the review inbox's `vendor::sku::X` key here. That key groups lines for a human to triage; this key identifies a distinct matcher input. The matcher under test consumes a product name, and the sku path is a separate deterministic layer the eval suppresses — so two name spellings of one sku are two real test cases. Keying on sku collapses them and discards the hard ones: measured on live data, `(vendor, sku)` yields 126 keys where `(vendor, lower(name))` yields 323. Keep `sku` as a field on the case for reporting and stratification, just not as its identity.

Collapse duplicate ids by summing `occurrences`, keeping the most frequent `expectedCanonicalId`. If one id maps to two different canonicals, **drop it and warn** — the human data itself is ambiguous there and it cannot fairly be scored.

- [ ] **Step 4: Verify the gold set against known counts**

Run: `npx tsx scripts/eval-ingredient-match/gold.ts --summary`

Expected, matching the measurements taken on 2026-07-28:
- total distinct pairs before exclusion: **486**
- excluded (alias leakage): around **19**
- pantry size: **76**
- any "one id → two canonicals" conflicts printed explicitly

If the totals differ materially from 486/76, stop and reconcile before continuing — the gate is only meaningful against a correct answer key.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-ingredient-match/gold.ts package.json
git commit -m "feat(eval): gold-set builder for ingredient matching with alias-leakage exclusion"
```

---

### Task 4: Eval runner with the free arms

Free arms first: they cost nothing, and if vector-only clears the gate the LLM layer is dead weight and should not be built.

**Files:**
- Create: `scripts/eval-ingredient-match/arms.ts`, `scripts/eval-ingredient-match/run.ts`, `scripts/eval-ingredient-match/report.ts`

**Interfaces:**
- Consumes: `GoldCase` (Task 3); `classifyCandidates`, `buildMatchQueryText`, `THRESHOLDS` (Task 2); `embed`, `toVectorLiteral` from `@/lib/chat/embeddings`
- Produces:
  - `type ArmResult = { caseId: string; decision: "auto" | "ambiguous" | "new"; chosenCanonicalId: string | null; correct: boolean | null; topScore: number; margin: number; candidates: MatchCandidate[]; reasoning?: string; costUsd?: number }`
  - `type Arm = { name: string; resolve(cases: GoldCase[], ctx: ArmContext): Promise<ArmResult[]> }`
  - `sweepThresholds(results: ArmResult[]): ThresholdRow[]`

- [ ] **Step 1: Implement the vector search helper**

One embedding call per case (batched via `embedBatch` in chunks of 100), then per case:

```ts
const rows = await prisma.$queryRawUnsafe<Array<{
  canonicalIngredientId: string; name: string; score: number
}>>(
  `SELECT e."canonicalIngredientId", e."name",
          (1 - (e.embedding <=> $1::vector))::float8 AS score
     FROM "CanonicalIngredientEmbedding" e
    WHERE e."accountId" = $2
    ORDER BY e.embedding <=> $1::vector
    LIMIT 10`,
  toVectorLiteral(vec), accountId,
)
```

- [ ] **Step 2: Implement the two free arms**

- `token-overlap` — port the scoring at `src/app/dashboard/ingredients/components/match-picker-sheet.tsx:114-132` verbatim (Jaccard over tokens, threshold 0.25). This is the status-quo bar.
- `vector-only` — vector search, then `classifyCandidates`. `"ambiguous"` counts as an abstention, not an error.

- [ ] **Step 3: Implement the threshold sweep**

Rather than scoring one threshold set, sweep and report the curve. For `HIGH` in 0.80…0.99 step 0.01 and `MARGIN` in 0.00…0.15 step 0.01, recompute the decision from each case's stored candidate list (no re-querying — the scores are already captured) and record:

```ts
type ThresholdRow = {
  high: number; margin: number
  autoLinked: number; correct: number; wrong: number
  coveragePct: number; precisionPct: number
}
```

Then surface **the highest-coverage row with `wrong === 0`** — that is the ship gate.

- [ ] **Step 4: Implement the report**

Follow `scripts/eval-chat/report.ts`: markdown into `scripts/eval-ingredient-match/runs/<timestamp>.md`. It must contain, per arm:
- the zero-error row (HIGH, MARGIN, coverage %) or an explicit "no zero-error threshold exists"
- the full precision/coverage curve as a table
- **every wrong decision printed in full** — case id, product name, expected canonical, chosen canonical, top score, margin, and reasoning. At a zero-error gate one error is decisive, so it must be diagnosable without a re-run.
- counts: cases, excluded-for-leakage, pantry size

- [ ] **Step 5: Run the free arms on the full set**

Run: `npm run eval:ingredient-match -- --arms token-overlap,vector-only`
Expected: a report written to `runs/`, zero API cost beyond embeddings.

- [ ] **Step 6: Read the result and decide whether Task 5 is needed**

If `vector-only` already achieves zero errors at acceptable coverage, **say so and stop before Task 5** — the LLM layer would add cost and a failure mode for no measured gain. Otherwise continue.

- [ ] **Step 7: Commit**

```bash
git add scripts/eval-ingredient-match/
git commit -m "feat(eval): ingredient-match bake-off harness with threshold sweep"
```

---

### Task 5: LLM adjudicator module

Only if Task 4 showed vector-only cannot clear the gate.

**Files:**
- Create: `src/lib/ingredient-match-llm.ts`
- Test: `tests/lib/ingredient-match-llm.test.ts`

**Interfaces:**
- Produces: `buildAdjudicatorPrompt(input)`, `parseAdjudicatorDrafts(content: string): AdjudicatorDraft[]`, `adjudicate(input): Promise<{ drafts: AdjudicatorDraft[]; model: string }>`

```ts
export type AdjudicatorDraft = {
  caseId: string
  /** Exact canonical name from that case's shortlist, or null for "none of these". */
  matchName: string | null
  confidence: number
  reasoning: string
  /** Populated only when matchName is null. */
  newIngredient?: { name: string; category: string; recipeUnit: string }
}
```

Mirror `src/lib/proposal-llm.ts` exactly: model constant, `response_format: { type: "json_object" }`, `recordAiUsage` after the call, `logger.error` and return `[]` on failure (never throw into a sync). Each case ships **only its top-5 shortlist** as vocabulary, not the whole pantry, so prompt size stays flat as the pantry grows.

- [ ] **Step 1: Write failing tests for `parseAdjudicatorDrafts`**

Cover: valid JSON; malformed JSON returns `[]`; missing `drafts` array returns `[]`; a draft with a non-numeric confidence is dropped; confidence is clamped to `[0,1]`; `matchName: null` with a `newIngredient` block survives; a draft naming an ingredient not in that case's shortlist is retained by the parser but must be rejected by the caller (assert the parser does not silently invent).

- [ ] **Step 2: Run, confirm failure. Step 3: Implement. Step 4: Run, confirm pass.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingredient-match-llm.ts tests/lib/ingredient-match-llm.test.ts
git commit -m "feat(ingredients): LLM adjudicator prompt and defensive parser"
```

---

### Task 6: Shortlist bake-off round

**Files:**
- Modify: `scripts/eval-ingredient-match/arms.ts` (add one arm per model), `run.ts` (add `--sample N` stratified sampling)

- [ ] **Step 1: Implement stratified sampling**

`--sample 150`, stratified across: vendor, vector-margin band (clear / near-tie / low), and the hard classes — grade or cut variants (names differing only by a ratio like `73/27` vs `80/20`), size variants, and catch-weight items. Seeded and deterministic so runs are comparable; **do not use `Math.random()` unseeded**.

- [ ] **Step 2: Add the model arms**

`gpt-4.1-mini` (incumbent, matches `proposal-llm.ts`), `gpt-5.4-nano`, `gpt-5.4-mini`, `gpt-5.5`, `o4-mini`. Confirmed available on this key on 2026-07-28.

- [ ] **Step 3: Run the shortlist round**

Run: `npm run eval:ingredient-match -- --arms gpt-4.1-mini,gpt-5.4-nano,gpt-5.4-mini,gpt-5.5,o4-mini --sample 150`

Estimated cost well under $1 total. Check the printed spend before and after.

- [ ] **Step 4: Record the shortlist**

Commit the run report. Pick the top two arms by coverage-at-zero-errors, tie-broken by cost.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-ingredient-match/
git commit -m "feat(eval): model arms and stratified sampling for the bake-off"
```

---

### Task 7: Certification round — THE GATE

**Files:**
- Create: `scripts/eval-ingredient-match/runs/<timestamp>-certify.md` (output)
- Modify: `src/lib/ingredient-match-scoring.ts` (`THRESHOLDS` set from the result)

- [ ] **Step 1: Run the top two arms on the full 486**

Run: `npm run eval:ingredient-match -- --arms <top1>,<top2>`

A 150-case sample cannot certify a zero-error gate over 486; only the full set can.

- [ ] **Step 2: Evaluate against the gate**

Gate passes when an (arm, HIGH, MARGIN) triple gives **`wrong === 0` on all 486** at coverage worth building.

- [ ] **Step 3a: If the gate passes** — write the winning values into `THRESHOLDS`, with a comment naming the run report and the coverage achieved. Update the spec's threshold section to match. Then proceed to Task 8.

- [ ] **Step 3b: If the gate fails** — stop. Report coverage and the full error list. Do not implement Tasks 8–13 as written; the fallback is the pre-filled one-click proposal, which needs no accuracy guarantee. This is a real possible outcome and reporting it is the correct result, not a failure of the work.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval-ingredient-match/runs/ src/lib/ingredient-match-scoring.ts \
        docs/superpowers/specs/2026-07-28-ingredient-auto-match-design.md
git commit -m "feat(eval): certify ingredient auto-match thresholds on full gold set"
```

---

## Tasks 8–13 (post-gate build)

Expanded 2026-07-29, after Tasks 1-7 certified the configuration. **Two things the gate changed, which govern everything below:**

- **Auto-create is off.** `AUTO_CREATE_ENABLED = false` in `ingredient-match-scoring.ts`. A `new` classification means "no confident match — send to a human", never "create an ingredient". Task 9 must not contain a creation path at all; do not write one behind the flag.
- **The ladder now has an LLM rung.** `gpt-5.4-nano` at `LLM_ACCEPT = 0.78` adjudicates the ambiguous band. It must fail safe: any error, truncation, or low-confidence answer leaves the case for a human.

Certified constants (do not re-derive; import from `THRESHOLDS`): `HIGH=0.72`, `MARGIN=0.01`, `FLOOR=0.48`, `LLM_ACCEPT=0.78`.

---

### Task 8: `IngredientMatchDecision` model

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/manual-migrations/2026-07-29_ingredient-auto-match.sql`

**Interfaces:**
- Produces: the `IngredientMatchDecision` model consumed by Tasks 9, 10, 12.

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

```prisma
/// Audit + undo record for one automatic ingredient match. Written by
/// `src/lib/ingredient-auto-match.ts`; reversed by `undoAutoMatch`. An UNDONE
/// row is also a permanent suppression — see Task 10.
model IngredientMatchDecision {
  id          String  @id @default(cuid())
  accountId   String
  /// `${normalizedVendor}::name::${lowercased productName}` — the same key the
  /// evaluation used, NOT the review inbox's sku-based key.
  groupKey    String
  vendorName  String
  sku         String?
  productName String

  /// auto-exact | auto-vector | auto-llm
  layer       String
  confidence  Float
  topScore    Float?
  margin      Float?
  reasoning   String?
  model       String?
  /// Runner-ups considered: [{ id, name, score }] — shown in the undo UI.
  candidates  Json?

  canonicalIngredientId String
  /// Always false while AUTO_CREATE_ENABLED is off. Retained so undo stays
  /// correct if creation is ever enabled behind a future decision.
  createdCanonical      Boolean  @default(false)
  linkedLineItemIds     String[]
  linkedLineItemCount   Int      @default(0)

  /// APPLIED | UNDONE | SHADOW
  status     String    @default("APPLIED")
  createdAt  DateTime  @default(now())
  undoneAt   DateTime?
  undoneById String?

  account             Account             @relation(fields: [accountId], references: [id], onDelete: Cascade)
  canonicalIngredient CanonicalIngredient @relation(fields: [canonicalIngredientId], references: [id], onDelete: Cascade)

  @@index([accountId, status, createdAt])
  @@index([accountId, groupKey])
}
```

Add the back-relations on `Account` and `CanonicalIngredient`.

- [ ] **Step 2: Push and hand-write the migration**

Run: `npx prisma db push` then `npx prisma generate`.
**Never `prisma migrate dev`** — it would reset the production Neon database.

Write the equivalent SQL to `prisma/manual-migrations/2026-07-29_ingredient-auto-match.sql` (`CREATE TABLE` plus both indexes plus the two foreign keys), following the shape of `prisma/manual-migrations/2026-07-26_recipe-mapping-proposals.sql`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` and confirm the generated client exposes `prisma.ingredientMatchDecision`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/manual-migrations/2026-07-29_ingredient-auto-match.sql
git commit -m "feat(ingredients): IngredientMatchDecision audit model"
```

---

### Task 9: Orchestration core — `src/lib/ingredient-auto-match.ts`

**Files:**
- Create: `src/lib/ingredient-auto-match.ts`
- Test: `tests/lib/ingredient-auto-match.test.ts`

**Interfaces:**
- Consumes: `classifyCandidates`, `buildMatchQueryText`, `THRESHOLDS`, `AUTO_CREATE_ENABLED` (Task 2/7); `adjudicate` (Task 5/7); `embed`, `toVectorLiteral`; `normalizeVendorName`; `recomputeCanonicalCost`; `syncCanonicalEmbedding` (Task 1)
- Produces: `autoResolveUnmatchedLines(scope: { accountId: string; ownerId: string | null }, invoiceIds: string[], opts?: { mode?: "shadow" | "on" }): Promise<AutoMatchResult>`

```ts
export type AutoMatchResult = {
  scanned: number
  autoExact: number
  autoVector: number
  autoLlm: number
  leftForReview: number
  costsUpdated: number
  llmCalls: number
}
```

**The ladder, in order. Each group exits at the first rung that resolves it.**

Operate on *groups*, not raw lines: group unmatched line items by `${normalizeVendorName(vendor)}::name::${productName.trim().toLowerCase()}` — the same key the evaluation measured. One decision links every line in its group.

- **L1 — cross-scope exact name.** Normalized product name equal to a canonical's name, or to an `IngredientAlias.rawName` **at any store** (today's matcher only reads aliases for the invoice's own store). Free. → `layer: "auto-exact"`, confidence 0.99.
- **L2 — vector.** `embedBatch` the group query texts; cosine against `CanonicalIngredientEmbedding` scoped to `accountId`, `LIMIT 10`. Feed the ranked candidates to `classifyCandidates`. `kind: "auto"` → `layer: "auto-vector"`.
- **L3 — LLM adjudication.** Every group `classifyCandidates` returned `ambiguous` **or** `new` for goes into one `adjudicate()` call with its own top-5 candidates. Accept a draft only when **all** hold: `confidence >= THRESHOLDS.LLM_ACCEPT`; `matchName` resolves to a canonical **that was in that group's own shortlist**; the pairing is not suppressed (below). → `layer: "auto-llm"`. Anything else is left for review.
- **No L4.** `AUTO_CREATE_ENABLED` is `false`. A `new` classification routes to review exactly like `ambiguous`. Assert the flag at the top of the function and leave a comment; do not branch on it.
- **L5 — write-back.** After linking, call `recomputeCanonicalCost` once per touched canonical (respects `costLocked` and the existing spike guard).

**Suppression, checked before any auto-link:** load `IngredientMatchDecision` rows for this account with `status: "UNDONE"`. Never re-link a `(groupKey, canonicalIngredientId)` pair that appears among them.

**Shadow mode:** when `opts.mode === "shadow"`, write decisions with `status: "SHADOW"` and **make no other write** — no line-item updates, no `IngredientSkuMatch`/`IngredientAlias` upserts, no cost recompute.

**Per resolved group, in one transaction:** update the group's line items (`canonicalIngredientId`, `matchSource: layer`, `matchedAt`); upsert the learned `IngredientSkuMatch` (when the sample line has a sku) or `IngredientAlias` (when it doesn't and the invoice has a `storeId`), mirroring `confirmSkuMatch`; create the `IngredientMatchDecision` with `linkedLineItemIds` populated.

- [ ] **Step 1: Write the failing contract tests**

`vi.mock("@/lib/prisma", ...)` per house style, plus mocks for `@/lib/chat/embeddings` and `@/lib/ingredient-match-llm`. Assert:

1. a group whose top score clears `HIGH` with margin ≥ `MARGIN` links with `matchSource: "auto-vector"`
2. a near-tie (margin below `MARGIN`) never auto-links, at any score
3. every candidate below `FLOOR` leaves the group for review and **creates no `CanonicalIngredient`** — assert `prisma.canonicalIngredient.create` was never called
4. an LLM draft at confidence ≥ `LLM_ACCEPT` naming a canonical **in that group's shortlist** links with `matchSource: "auto-llm"`
5. an LLM draft naming a canonical **not** in that group's shortlist is rejected and left for review
6. an LLM draft below `LLM_ACCEPT` is left for review
7. `adjudicate` returning `[]` (its failure mode) leaves every ambiguous group for review and throws nothing
8. a `(groupKey, canonicalIngredientId)` pair with an `UNDONE` decision is never re-linked
9. `mode: "shadow"` writes `status: "SHADOW"` decisions and performs no line-item update, no sku/alias upsert, and no cost recompute
10. one decision's `linkedLineItemIds` covers every line in its group

- [ ] **Step 2: Run, confirm failure. Step 3: Implement. Step 4: Run, confirm pass.**

Run: `npm test -- ingredient-auto-match`

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingredient-auto-match.ts tests/lib/ingredient-auto-match.test.ts
git commit -m "feat(ingredients): auto-match ladder orchestration, auto-create disabled"
```

---

### Task 10: Undo — `src/app/actions/ingredient-auto-match-actions.ts`

**Files:**
- Create: `src/app/actions/ingredient-auto-match-actions.ts`
- Test: add to `tests/lib/ingredient-auto-match.test.ts`

**Interfaces:**
- Produces: `listRecentAutoMatches(days?: number)`, `undoAutoMatch(decisionId: string)`

`undoAutoMatch`, in this order:

1. Unlink exactly `linkedLineItemIds`, **only** rows still carrying an `auto-*` `matchSource` — so a manual confirm made afterwards is never clobbered.
2. Delete the `IngredientSkuMatch` / `IngredientAlias` this decision learned.
3. `createdCanonical` is always false today; if true, delete the canonical and its embedding only when nothing else references it (no `RecipeIngredient`, no `StockCountLine`, no line items from other decisions) — otherwise keep it, unlink only, and report why.
4. `recomputeCanonicalCost` on the affected canonical so COGS reverts.
5. Set `status: "UNDONE"`, `undoneAt`, `undoneById`. **This row is now a permanent suppression** — Task 9 reads it and never re-links that pairing.

- [ ] **Step 1: Write the failing tests** — a full link → undo → re-run cycle asserting: line items unlinked; the learned sku/alias row gone; `recomputeCanonicalCost` called; status `UNDONE`; and a second `autoResolveUnmatchedLines` run does **not** re-link. Plus: a line manually re-confirmed after the auto-link is left untouched by undo.
- [ ] **Step 2: Run, confirm failure. Step 3: Implement. Step 4: Run, confirm pass. Step 5: Commit.**

---

### Task 11: Sync integration

**Files:**
- Modify: `src/app/api/invoices/sync/route.ts` (Phase 5, around line 531)

Add **Phase 5b** immediately after `matchNewLineItems`, inside its own `try/catch` — auto-matching must never fail an invoice sync. Use the same `emit()` progress contract as the surrounding phases.

Gate on `INGREDIENT_AUTO_MATCH`: `off` (default) → skip entirely; `shadow` → `mode: "shadow"`; `on` → live. Log the returned counts the way Phase 5 logs its own.

- [ ] **Step 1: Implement.** - [ ] **Step 2:** `npx tsc --noEmit` and `npm test`. - [ ] **Step 3: Commit.**

---

### Task 12: Activity strip

**Files:**
- Create: `src/app/dashboard/ingredients/components/auto-match-activity.tsx`
- Modify: `src/app/dashboard/ingredients/components/ingredients-shell.tsx` (render above `<ReviewInbox>`)

**Read `docs/frontend-patterns.md` first.** Editorial tokens only — `--ink`, `--ink-muted`, `--ink-faint`, `--paper`, `--hairline`, `--hairline-bold`, `--accent`. No generic Tailwind palette colours anywhere on this route.

- `.inv-panel` frame; rows use the `.inv-row` hover pattern (red 4px `scaleY(0→1)` accent bar from the left, `rgba(220,38,38,0.045)` wash)
- Product name in Fraunces italic; vendor · SKU · spend in JetBrains Mono caption; **confidence in DM Sans 500 with `tabular-nums lining-nums`**
- Layer badge distinguishes `auto-llm` from `auto-vector`/`auto-exact`
- Expanding a row reveals the reasoning and the scored runner-ups, so a wrong pick is diagnosable rather than merely reversible
- 7-day window, first 5 rows, then the same `Show N more` control `review-inbox.tsx` already uses
- Undo button per row, calling `undoAutoMatch`

- [ ] **Step 1: Implement.** - [ ] **Step 2:** verify against the patterns doc. - [ ] **Step 3: Commit.**

---

### Task 13: Review-inbox pre-fill

**Files:**
- Modify: `src/app/actions/ingredient-match-actions.ts` (extend `UnmatchedLineItemGroup` with an optional suggestion), `src/app/dashboard/ingredients/components/review-inbox.tsx`, `match-picker-sheet.tsx`

Carry the best sub-threshold candidate (name, id, score, and the adjudicator's reasoning when there was one) onto each review card, and pre-select it in `MatchPickerSheet` so confirming is one click instead of three. The existing token-overlap suggestions stay as the fallback when no vector candidate exists.

- [ ] **Step 1: Implement.** - [ ] **Step 2:** `npm test` + `npx tsc --noEmit`. - [ ] **Step 3: Commit.**

---

## Shipped (2026-07-29)

Tasks 1-13 are implemented and merged to `main`. Deployed with
`INGREDIENT_AUTO_MATCH=shadow` in Vercel **production only**;
`IngredientMatchDecision` applied to Neon via `prisma db push` (the diff was
purely additive - one table, two indexes, two FKs, `RESTRICT` on the canonical
FK as intended).

Two deviations from the plan as written, both deliberate:

- **Task 13 needed a data source the plan didn't specify.** The ladder
  previously discarded groups it declined, so there was nothing to pre-fill
  from. It now records them as `SUGGESTED` decisions (a new `status` value; no
  DDL change, the column is a free-form String). Those rows link nothing, are
  excluded from the activity strip, and suppress nothing. See the spec's data
  model section.

- **Task 1 was incomplete.** It wired `syncCanonicalEmbedding` into
  `confirmSkuMatch`'s newCanonical path only. Two other paths create or
  invalidate an embedding and were silently skipping it:
  `createCanonicalIngredient` (the pantry UI's own create - an ingredient added
  by hand had no embedding at all, so it was permanently invisible to L2 and to
  the adjudicator's shortlist) and `mergeCanonicalIngredients` (the target
  absorbs the source's aliases, and alias rawNames are folded into the embedded
  text, so the target's vector went stale). Both fixed with tests. The general
  rule now lives in the code comments: **there is no embedding cron, so any path
  that creates a canonical or changes its name/category/aliases must refresh
  inline.**

Known, accepted at ship time:

- Phase 5b adds latency to the invoice sync (one `embedBatch`, one vector query
  per unmatched group, one adjudicator request). The route budget is
  `maxDuration = 120`; a 38-group backlog is far larger than a typical 6-hourly
  sync's handful of new groups. Shadow mode is where this gets measured.
- Coverage on genuinely-new products is ~55%, not the gate's 92.5% - every gold
  case was one the deterministic SKU layer already resolved. See the threshold
  block in `src/lib/ingredient-match-scoring.ts`.
- The activity strip and the pre-fill banner have not been visually reviewed in
  a browser; they are type-checked, unit-tested and build-clean only.

---

## Self-Review Notes

- **Spec coverage:** ladder L1–L5 → Tasks 2/4/5/9 and Task 1 (L5); bake-off → Tasks 3–7; data model → Task 8; undo + suppression → Task 10; UI → Tasks 12–13; sync + rollout → Task 11; testing → folded into each task. The spec's fallback path is covered by Task 7 Step 3b.
- **Type consistency:** `MatchCandidate` / `Classification` / `THRESHOLDS` (Task 2) are consumed unchanged by Tasks 4, 6, 9. `GoldCase` (Task 3) is consumed by Tasks 4, 6, 7. `AdjudicatorDraft` (Task 5) is consumed by Task 9.
- **Known deferral:** Tasks 8–13 are interface-level by design, flagged above with the reason.
