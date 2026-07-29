# AI ingredient auto-matching from invoices — design

Date: 2026-07-28
Status: approved for planning

## Problem

Every new product on a vendor invoice requires a manual match. `matchNewLineItems()`
(`src/lib/ingredient-matching.ts`) resolves a line only two ways:

1. `(normalizedVendor, sku)` → `IngredientSkuMatch`
2. `productName` → `IngredientAlias` (scoped to one store)

Anything missing both stays `canonicalIngredientId = null` and lands in the review
inbox at `/dashboard/ingredients`, where the only assistance is browser-side token
overlap scoring (`match-picker-sheet.tsx:114-132`, threshold 0.25). There is no
semantic matching, no cross-store learning, and no LLM in this path — even though
`CanonicalIngredientEmbedding` (pgvector, 1536-dim) is already populated and queried
by the chat layer at `src/lib/chat/tools/ingredients.ts:151`.

## Current state (measured 2026-07-28)

| Metric | Value |
|---|---|
| `IngredientSkuMatch` rows (human-confirmed) | 97 |
| `IngredientAlias` rows with a canonical | 19 |
| `CanonicalIngredient` rows | 76 |
| `CanonicalIngredientEmbedding` rows | 76 (full coverage) |
| Matched invoice line items | 1,288 (`sku`=1,155, `alias`=133) |
| Unmatched line items | 47, across 41 distinct groups |
| Distinct `(vendor, sku, productName) → canonical` gold pairs | 486 |

Two consequences:

- **The backlog is small.** 41 groups. This feature is not backlog-clearing; its value
  is forward-looking — new products, and GLN/VNYS opening ~mid-June 2026 against a
  pantry Hollywood already learned.
- **Embedding coverage is manual.** 76/76 only because someone ran
  `scripts/backfill-embeddings.ts` by hand. Nothing writes an embedding when a
  `CanonicalIngredient` is created (`ingredient-match-actions.ts:254` does not), and
  there is no cron. Coverage decays from the next ingredient onward.

## Decisions taken

- **Confident matches auto-link.** No human click. Every auto-action is recorded with
  its score and reasoning, and is reversible in one click from an activity strip.
- **Auto-create is cancelled (certified 2026-07-28) by an explicit flag, not by a
  threshold side-effect.** The bake-off measured a 33.3% duplicate-creation rate
  (85/255) at `vector-only`'s own zero-error ship gate — roughly one in three
  confirmed-real ingredients would have silently spawned a duplicate pantry row. `FLOOR`
  is also set lower (0.48 — see "Certified result" below), which reduces how often the
  `top.score < FLOOR` path fires on scores this evaluation measured, but that path is
  not the only way `classifyCandidates` returns `{ kind: "new" }` — it also fires
  whenever vector retrieval returns zero candidates (an empty pantry, or a
  not-yet-embedded canonical), which FLOOR cannot gate at all. `AUTO_CREATE_ENABLED`
  (`src/lib/ingredient-match-scoring.ts`) is the actual disablement: any caller wiring
  up L4 must check it before creating a `CanonicalIngredient`, not infer safety from
  FLOOR's relationship to one sample's minimum score. L4 below describes the mechanism
  as designed; it does not fire while `AUTO_CREATE_ENABLED` is `false`.
- **Oversight is an on-page activity strip**, not email, not a silent log.
- **Auto-link precision gate: 100% on the gold set.** Of everything the ladder chooses
  to auto-link, zero may disagree with the 486 human-confirmed matches. The ladder
  abstains (defers to review) whenever it is not certain; the coverage this costs is
  measured and reported, not assumed. Measured on held-out gold data — never on
  self-reported model confidence, which is calibrated during the bake-off before being
  trusted for anything.

  This gate is achievable precisely because abstention is allowed. Auto-linking all 486
  *and* being right on all 486 is not achievable by any matcher, and is not the target.

## Architecture — the resolution ladder

New session-free core, mirroring `mapping-proposals-core.ts`. Runs as a new stage over
whatever `matchNewLineItems()` leaves unmatched. Each line exits at the first hit;
layers ordered cheapest first.

### L0 — deterministic (existing, unchanged)

`(vendor, sku)` → `IngredientSkuMatch`, then `productName` → `IngredientAlias`. Free.

### L1 — cross-scope exact name (new, free)

Normalized product name equal to a canonical's name, or to an alias `rawName` **at any
store**. `IngredientAlias` is `@@unique([storeId, rawName])`, so today what Hollywood
learned cannot help GLN/VNYS. Zero cost, and its value grows the moment store #2 opens.

→ auto-link, `matchSource: "auto-exact"`, confidence 0.99.

### L2 — vector (new, ~$0.00001/line)

Embed `productName + vendor + unit`; cosine against `CanonicalIngredientEmbedding`
scoped to `accountId` (the query already proven at `chat/tools/ingredients.ts:151`).
Classify on **two** numbers:

| Condition | Outcome |
|---|---|
| top ≥ `HIGH` **and** (top − runnerUp) ≥ `MARGIN` | auto-link, `auto-vector` |
| top in [`FLOOR`, `HIGH`), or near-tie at any score | ambiguous → L3 |
| every candidate < `FLOOR` | clearly new → L4 |

The margin test is the load-bearing guard: `"GRND BEEF 73/27"` scoring 0.93 against
*both* "Ground Beef 73/27" and "Ground Beef 80/20" must never silently pick one.

Starting values `HIGH=0.90`, `MARGIN=0.05`, `FLOOR=0.72`, and L3's `LLM_ACCEPT=0.85`
were **guesses, now replaced by certified bake-off output**: `HIGH=0.72`, `MARGIN=0.01`,
`FLOOR=0.48`, `LLM_ACCEPT=0.78` — see "Certified result (2026-07-28)" below for the
evidence behind each. All four live in one exported constants object
(`src/lib/ingredient-match-scoring.ts#THRESHOLDS`), not scattered across modules.

### L3 — LLM adjudicator (ambiguous band only)

One chat completion per sync, batched across all ambiguous lines. Each line ships with
**only its top-5 vector candidates** as vocabulary — not the whole pantry — so prompt
size is independent of pantry growth. Returns match-or-none, confidence, one-line
reasoning. Every returned name is re-resolved against the DB before use (the
`resolveCanonical` pattern, `mapping-proposals-core.ts:141`).

- ≥ `LLM_ACCEPT` → auto-link, `auto-llm`
- below → review inbox **with the suggestion pre-filled** (three clicks become one)

### L4 — auto-create (clearly new only) — **cancelled by `AUTO_CREATE_ENABLED = false`**

Gated on L2's "every candidate < `FLOOR`" — that floor was meant to *be* the
pantry-duplication guardrail, but is not sufficient alone (see below).

**Certified 2026-07-28: auto-create is disabled by an explicit flag
(`AUTO_CREATE_ENABLED` in `src/lib/ingredient-match-scoring.ts`), not by FLOOR.**
`FLOOR=0.48` lowers how often the `top.score < FLOOR` path returns `{ kind: "new" }` at
the scores this evaluation measured (no case in the 255-case gold set scores below
0.4931), but `classifyCandidates` also returns `{ kind: "new" }` from an earlier,
FLOOR-independent guard whenever vector retrieval returns zero candidates. That path is
live whenever `CanonicalIngredientEmbedding` coverage is incomplete — which it will be:
nothing writes an embedding on canonical creation outside the one path Task 1 added,
there is no backfill cron, and GLN/VNYS open with empty pantries. At an empty pantry,
*every* invoice line takes the empty-candidates path regardless of FLOOR. Any future
wiring of L4 **must** check `AUTO_CREATE_ENABLED` before creating a
`CanonicalIngredient` from a `{ kind: "new" }` decision; FLOOR alone does not provide
the guarantee the owner is relying on. This code path is kept in place (a future
evaluation could flip the flag) but is inert by design until then.

**Pack metadata is parsed, never inferred.** It comes from `getLineItemBaseQty()` on
the real invoice line. If the line carries no `packSize`/`unitSize`, then `caseUnit`
and `recipeUnitsPerCase` are left **null** so the mobile stock-count case tier hides
itself rather than presenting a fabricated case size. This is a direct response to the
pack-metadata mis-parse class of bug behind the June COGS spike (see
`selectNonSpikeCostIndex`).

→ creates + links, `matchSource: "auto-create"`.

### L5 — embedding write-back (closes the decay gap)

Any `CanonicalIngredient` created by L4 **or by a human confirm** gets its
`CanonicalIngredientEmbedding` written in the same operation via the existing
`embedBatch()`. Without this, L2 degrades with every new ingredient.

### Cost profile

Routine sync with no new products: **zero API calls**. Sync with new products: one
embedding batch plus at most one chat completion. This matters — the OpenAI balance is
~$5.

## Model bake-off

Ground truth already exists: **486 distinct `(vendor, sku, productName) → canonical`
pairs** confirmed by a human. No labeling work.

New harness `scripts/eval-ingredient-match/`, structured exactly like the existing
`scripts/eval-chat/` (`cases.ts` / `run.ts` / `report.ts`, markdown reports into
`runs/`), reusing its `loadEnvLocal()` helper.

### Protocol

Per case: suppress L0/L1 (deterministic layers would win trivially and are not under
test), run L2→L4 against the real pantry, compare the chosen canonical to the known
answer.

**Leakage exclusion.** `buildCanonicalIngredientText(name, category, aliasNames)`
(`scripts/backfill-embeddings.ts:459`) folds alias raw names into the canonical's
embedding text. Any gold pair sourced from an alias is therefore scored against its own
answer key. Those 19 alias-derived pairs are excluded from the eval set; without this
the report overstates vector accuracy in a way that evaporates on genuinely new
products.

### Arms

| Arm | Purpose |
|---|---|
| Token overlap (current `match-picker-sheet.tsx` logic) | Status-quo bar |
| Vector only (pgvector, no LLM) | May clear 95% alone — then L3 is dead weight |
| `gpt-4.1-mini` | Incumbent, matches `proposal-llm.ts` |
| `gpt-5.4-nano`, `gpt-5.4-mini`, `gpt-5.5` | Cheap → capable sweep |
| `o4-mini` | Does reasoning help on ambiguous grades/cuts? |

OpenAI only — the project's existing provider. No second provider is introduced.

### Metrics

Per arm, per candidate threshold:

- **Precision** of auto-linked decisions (gate: 100%)
- **Coverage** — share of gold lines auto-linked at that precision
- **Error list** — every disagreement printed in full with scores and reasoning, since
  at the zero-error gate a single error is decisive and must be diagnosable
- **Wrong-link rate**
- **Wrong-create rate** — auto-creating a duplicate when a correct pantry match existed;
  the worst failure mode, tracked separately
- **Calibration curve** — self-reported confidence vs. actual accuracy, bucketed
- **$/100 lines** and **latency**

The calibration curve decides whether self-reported confidence may be a gate at all. If
a model's stated 0.95 is 87% accurate in practice, gating uses measured score bands and
self-report becomes a tiebreak only.

### Operating point

The report prints the precision/coverage curve, and the operating point is chosen from
that table rather than from the guessed constants.

**The ship gate is the highest-coverage threshold set that yields zero errors on the
gold set.** If no threshold achieves zero errors for a given arm, that arm is
disqualified. If *no* arm achieves it, the feature does not ship in auto-link form —
the fallback is the pre-filled one-click proposal, which was the runner-up option
during design and requires no new accuracy guarantee.

Coverage at the zero-error point is the headline number: it says what fraction of
future invoice lines stop needing a human. A low number is a legitimate reason to
reconsider the whole approach, and the eval is deliberately built to surface that
before any feature code depends on it.

### Certified result (2026-07-28)

The owner's ship decision, from the completed bake-off
(`scripts/eval-ingredient-match/`, task 6): **vector similarity gates auto-link, a
`gpt-5.4-nano` adjudicator resolves the ambiguous band, auto-create is disabled.**

- **Vector layer (L2) wins on precision, not on coverage alone.** Ship gate
  `HIGH=0.72, MARGIN=0.01` — the cross-fold median gate,
  `scripts/eval-ingredient-match/runs/2026-07-28-1748.md`. Full-sample at that one
  gate: 167/255 auto-linked, 0 wrong, 65.5% coverage. The leakage-free cross-validated
  estimate (one gate per fold, `permissive` rule) is 166/255, 0 wrong, 65.1% coverage —
  nearly identical, and the figure to cite as the tested error rate. No arm — vector or
  any of the five LLM models — demonstrated a clean zero-error coverage gain over this
  baseline.
- **Adjudicator (L3): `gpt-5.4-nano`**, chosen from a 5-model bake-off
  (`gpt-4.1-mini`, `gpt-5.4-mini`, `o4-mini`, `gpt-5.5` also measured;
  `scripts/eval-ingredient-match/runs/2026-07-28-1646-llm.md`) as the best available
  tradeoff: highest coverage at a narrow, disclosed knife-edge, and also the cheapest
  arm run ($0.0143 vs. $0.0145–$0.2836 for the other four). `LLM_ACCEPT=0.78` is the
  confidence threshold 4 of 5 grouped-k-fold folds independently selected (fold 0 alone
  picked 0.72). **Cross-validated** combined result (vector + adjudicator, excluding
  two known-corrupted gold labels): 234/253 auto-linked, **1 wrong**, 92.5% coverage,
  99.6% precision. **Fixed-threshold** result — tau=0.78 applied as one shared gate in
  a single full-sample pass, optimistic by construction, NOT a generalization estimate:
  232/253 auto-linked, **0 wrong**, 91.7% coverage, 100% precision. The two figures
  differ by exactly one fold's threshold pick landing 0.06 away from the other four —
  always state which of the two is being cited.
- **Auto-create (L4) is cancelled by `AUTO_CREATE_ENABLED = false`, an explicit flag —
  not an emergent property of FLOOR.** At the pre-certification production FLOOR=0.72,
  33.3% of the gold set (85/255) would have auto-created a duplicate
  `CanonicalIngredient` — measured, not assumed
  (`scripts/eval-ingredient-match/runs/2026-07-28-1748.md`, vector-only "FLOOR sweep"
  section). `FLOOR=0.48` is the value that sweep found makes the duplicate-creation
  count zero *on this 255-case gold set* (no case scores below 0.4931), but
  `classifyCandidates` also returns `{ kind: "new" }` from a FLOOR-independent guard —
  an empty candidate list, which fires whenever vector retrieval returns nothing (a real
  scenario: incomplete embedding coverage, or an empty pantry at a new store like
  GLN/VNYS). FLOOR cannot make that path unreachable, so the actual disablement is
  `AUTO_CREATE_ENABLED`, which any future L4 wiring must check explicitly before
  creating a canonical from a `{ kind: "new" }` decision.

**Three caveats that must travel with every one of the numbers above:**

1. Cross-validated and fixed-threshold figures differ (one carries a measured error,
   one doesn't) — state which is which; the fixed-threshold figure is optimistic by
   construction, not a generalization estimate.
2. Every gold case is one the deterministic L0 (`sku`/alias) layer already resolves —
   every figure above is an upper bound for genuinely new products, not an estimate of
   live performance on them.
3. Safety comes from the acceptance gate, not from model reliability: at pool level
   `gpt-5.4-nano` makes 8 wrong picks out of 88 pool cases, including matching french
   fries to frying-oil shortening at 0.52 confidence. `LLM_ACCEPT` rejects picks like
   that — the model itself is not being trusted to be right.

### Budget

Two rounds:

1. **Shortlist** — all arms on a **stratified ~150-case sample** across vendors,
   easy/hard bands by vector margin, and the hard classes (grade/cut variants like
   73/27 vs 80/20, size variants, catch-weight). Cheap, eliminates weak arms.
2. **Certify** — the top two arms on the **full 486**. A 150-case sample cannot
   certify a zero-error gate over 486; only the full set can.

The free arms (token overlap, vector-only) run on the full set in both rounds at no
cost. Estimated LLM total well under $1.

## Data model

`InvoiceLineItem.matchSource` is already a free-form `String` and simply gains
`auto-exact` | `auto-vector` | `auto-llm` | `auto-create`. No migration for it.

One new table:

```prisma
model IngredientMatchDecision {
  id          String   @id @default(cuid())
  accountId   String
  /// Same grouping key the review inbox uses: "vendor::sku::X" | "vendor::name::x"
  groupKey    String
  vendorName  String
  sku         String?
  productName String

  /// auto-exact | auto-vector | auto-llm | auto-create
  layer       String
  confidence  Float
  /// Vector cosine of the winner, and its gap to the runner-up.
  topScore    Float?
  margin      Float?
  reasoning   String?
  model       String?
  /// Runner-ups considered: [{ id, name, score }] — surfaced in the undo UI.
  candidates  Json?

  canonicalIngredientId String
  /// True when this decision created the canonical; undo must consider deleting it.
  createdCanonical      Boolean  @default(false)
  /// Exact undo target.
  linkedLineItemIds     String[]
  linkedLineItemCount   Int      @default(0)

  /// APPLIED | UNDONE | SHADOW
  status     String    @default("APPLIED")
  createdAt  DateTime  @default(now())
  undoneAt   DateTime?
  undoneById String?

  @@index([accountId, status, createdAt])
  @@index([accountId, groupKey])
}
```

Migration convention: `prisma db push` plus a hand-written
`prisma/manual-migrations/2026-07-28_ingredient-auto-match.sql`. Never `migrate dev` —
that would reset the Neon production DB.

## Undo

`undoAutoMatch(decisionId)`:

1. Unlink exactly `linkedLineItemIds`, nulling `canonicalIngredientId` / `matchSource` /
   `matchedAt` — but **only rows still carrying an `auto-*` source**, so a later manual
   confirm is never clobbered.
2. Delete the `IngredientSkuMatch` / `IngredientAlias` this decision learned.
3. If `createdCanonical`: delete the canonical **and its embedding row**, but only if
   nothing else references it (no `RecipeIngredient`, no `StockCountLine`, no invoice
   lines from other decisions). Otherwise keep it, unlink only, and report
   "kept — now used in N recipes".
4. `recomputeCanonicalCost()` on the affected canonical so COGS reverts too.
5. Mark `UNDONE`. **The row then acts as a permanent suppression:** the matcher never
   re-auto-links that `(groupKey → canonicalIngredientId)` pair, and if an auto-create
   was undone, that `groupKey` is barred from auto-create entirely and routed to human
   review. This mirrors `REJECTED` proposals never being re-proposed
   (`mapping-proposals-core.ts:98`). Without it the next sync silently redoes the
   undone action.

## UI

New `<AutoMatchActivity>` section above `<ReviewInbox>` on `/dashboard/ingredients`,
built in the editorial docket system per `docs/frontend-patterns.md`:

- `.inv-panel` frame — hairline-bold border, 2px radius, warm paper, no shadow
- `.inv-row` hover — red 4px `scaleY(0→1)` accent bar from the left,
  `rgba(220,38,38,0.045)` wash
- Product name in Fraunces italic; vendor · SKU · spend in JetBrains Mono caption;
  confidence in DM Sans 500 with `tabular-nums lining-nums`
- Editorial tokens only (`--ink`, `--ink-muted`, `--paper`, `--hairline`, `--accent`)
- Layer badge separates **auto-created** (accent treatment — the higher-risk class)
  from auto-linked
- Expanding a row reveals the reasoning and the runner-up candidates with scores, so a
  wrong pick is diagnosable, not merely reversible
- 7-day window, first 5 rows, then the same `Show N more` control the review inbox uses

The review inbox remains, thinner. Its cards now carry the pre-filled sub-threshold
suggestion so those become one click instead of three.

## Sync integration and rollout

Plugs in as **Phase 5b** in `src/app/api/invoices/sync/route.ts:531`, immediately after
`matchNewLineItems`, inside its own try/catch — auto-matching must never fail an invoice
sync. Uses the same `emit()` progress contract as the surrounding phases.

Env gate `INGREDIENT_AUTO_MATCH`:

| Value | Behavior |
|---|---|
| `off` | Nothing runs (default until the bake-off lands) |
| `shadow` | Decisions written with `status: SHADOW`; **zero links, zero COGS writes**; the activity strip shows what it would have done |
| `on` | Live |

Shadow mode buys a week of observation on real invoices before a single number moves.

## Testing

TDD on pure functions first:

- `classifyCandidates(scores)` → `auto | ambiguous | new`, covering threshold and margin
- `buildAutoMatchPrompt`
- `parseAutoMatchDrafts` — defensive narrowing, mirroring `parseProposalDrafts`

Then contract tests with mocked Prisma, asserting the invariants that matter:

- nothing auto-links below threshold
- a near-tie never auto-links, regardless of absolute score
- an `UNDONE` pairing is never re-linked
- auto-create fires only when *every* candidate is below `FLOOR`
- pack metadata stays null when the invoice line does not carry it
- a full link → undo → re-run cycle proves suppression holds and COGS reverts

## File layout

Kept under 400 lines each, splitting on the seam the codebase already uses:

| File | Responsibility |
|---|---|
| `src/lib/ingredient-auto-match.ts` | Orchestration (session-free core) |
| `src/lib/ingredient-match-scoring.ts` | Pure classification / thresholds |
| `src/lib/ingredient-match-llm.ts` | Prompt + defensive parse (mirrors `proposal-llm.ts`) |
| `src/app/actions/ingredient-auto-match-actions.ts` | `listRecentAutoMatches`, `undoAutoMatch` |
| `src/app/dashboard/ingredients/components/auto-match-activity.tsx` | Activity strip |
| `scripts/eval-ingredient-match/` | Bake-off harness |

## Sequencing

1. L5 embedding write-back — smallest, independently valuable, stops the decay
2. Bake-off harness + gold-set builder → run it → pick model and thresholds
3. Scoring + LLM modules (TDD), then the orchestration core
4. `IngredientMatchDecision` model + migration
5. Sync Phase 5b behind `INGREDIENT_AUTO_MATCH=shadow`
6. Activity strip + undo
7. Observe shadow output on real invoices, then flip to `on`

## Out of scope

- Email digest of auto-matches (on-page strip only)
- Any change to how recipe mapping proposals work
- Vendor-catalog ingestion or any new external data source
- Reworking `IngredientAlias` store scoping (L1 reads across stores without a schema
  change)
