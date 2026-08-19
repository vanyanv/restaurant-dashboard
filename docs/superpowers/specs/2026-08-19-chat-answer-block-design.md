# Chat: the Answer Block

**Status:** approved, in implementation
**Date:** 2026-08-19
**Surface:** `/dashboard/chat` and the ⌘K drawer (shared `<ChatThread>`)

## Problem

The chat is the one surface on `/dashboard/*` that is mostly ragged prose. Every
other page reconciles in columns; the analyst answers in a paragraph with the
evidence collapsed underneath it. Four things follow from that:

1. Answers read as a wall of text. Numbers are wrapped in `.tabular` spans but
   nothing else distinguishes the answer from the reasoning.
2. The artifact cards — the actual product value — are collapsed accordions
   below the prose. The evidence is one click away from every answer.
3. The empty state is three hardcoded chips that never change.
4. The result reads as a chatbot on a cream background rather than as part of
   the editorial docket.

## Direction

Every assistant turn becomes a **filed return**: a hairline-framed block with a
fixed internal order.

```
ASKED 14:31   How were sales last week?            <- docket line (Fraunces italic)
┌──────────────────────────────────────────────┐
│ RETURN No. 0142 · SALES     HOLLYWOOD ▸       │  head: department + scope
│ ──────────────────────────────────────────── │
│ Sales ran ahead of the week                  │  verdict (Fraunces italic, ≤26ch)
│ before on fewer orders.                      │
│ ──────────────────────────────────────────── │
│ $48,912      1,204        $40.62             │  figure strip (DM Sans 600/30px)
│ ▲+6.4% NET   ▼-1.8% ORD   ▲+8.4% TICKET      │  delta stamp + mono label
│ ──────────────────────────────────────────── │
│ [evidence — the artifact card, open]         │
│ ──────────────────────────────────────────── │
│ note: the model's prose, ink-muted, ≤66ch    │
│ ▬ FROM getDailySales · HOLLYWOOD · AUG 11–17 │  provenance, red tick
└──────────────────────────────────────────────┘
  Copy · Retry · Branch · Why this number
  → follow-up  → follow-up
```

The prose is demoted to a note. The evidence is promoted into the middle of the
answer, open by default.

### Two rules the prototype forced

**Not every answer earns a card.** A single-fact question ("what was Saturday's
total?") got the same visual weight as a twelve-week analysis. The **short
return** drops the frame to two hairlines and renders one ledger line: figure,
delta stamp, scope, source. Same grammar, one twelfth the weight.

**The figure strip is a slot, not a stat row.** It carries whatever unit the
answer is denominated in — margin % and food cost for a recipe, interval width
and backtest coverage for a forecast, vendor share for invoices. A refusal has
no figures at all: the block keeps its frame, drops the strip, and offers two
answerable questions instead. The system prompt's four "never" rules make
refusals routine output, not an edge case, so they must look like a filed
return rather than a failure.

A forecast is the third case worth naming: quoting `$47,800` alone reads as a
promise. The forecast return draws the p10–p90 span under the hero figure and
puts the coverage miss (0.71 against a 0.80 target) in the note.

## The model-output contract

The block needs a verdict line and up to three named figures. The prompt
currently asks for "a short paragraph", which cannot fill either. So the model
files the return through a **presentation tool**.

### `fileReturn`

A new entry in `chatTools` with no data access — `execute` echoes its input
back so the value lands on the message as a `tool-fileReturn` part with
`state: "output-available"`, exactly like every other tool result. No route
changes: the route builds `toolSet` from `chatTools` already.

```ts
{
  verdict:    string   // one sentence, ≤160 chars, leads with the answer
  department: "Sales" | "Costs" | "Menu" | "Forecast" | "Inventory"
            | "Orders" | "No data"
  scope:      string   // "Hollywood · Aug 11 – 17", ≤80 chars
  figures: Array<{     // 0–3
    value:     string  // preformatted: "$48,912", "66.2%", "1,204"
    label:     string  // "Net sales", ≤28 chars
    delta?:    string  // "+6.4%", "-1.8pt"
    direction?: "up" | "down"   // semantic, not arithmetic: spending more is "down"
  }>
}
```

`value` and `delta` are preformatted strings, not numbers. The model has
already read the tool output; asking it to name the three numbers that matter
is a selection, not a computation, and it keeps currency/percent formatting
decisions with the writer rather than splitting them across the wire.

`direction` is **semantic**, not arithmetic. A 14% rise in produce spend is
`direction: "down"` — it renders in `--subtract`, because more spend is worse.
This is the one field the model can get wrong in a way that misleads, so the
prompt states it explicitly.

### Turn order

1. Call the data tools needed to answer.
2. Call `fileReturn` **exactly once**, after the data tools have returned.
3. Write the note paragraph.
4. End with the existing one-line provenance footer.

If the model files more than once, the client takes the last. If it never
files, the message renders exactly as it does today — the fallback is the
current layout, so old conversations and skipped calls degrade to working UI
rather than to an empty frame.

### Form selection

Decided client-side from what was filed, so it is deterministic and testable:

| Condition | Form |
|---|---|
| `department === "No data"` | **empty return** — frame, verdict, no figure strip, answerable-instead prompts |
| `figures.length <= 1` | **short return** — two hairlines, one ledger line |
| otherwise | **full return** — head, verdict, figure strip, evidence, note, provenance |

## Components

| File | Change |
|---|---|
| `src/lib/chat/tools/file-return.ts` | new — schema + presentation tool |
| `src/lib/chat/tools/index.ts` | register `fileReturn` |
| `src/lib/chat/return.ts` | new — pure selectors: `selectFiledReturn`, `returnForm`, `splitProvenance` |
| `src/components/chat/chat-return.tsx` | new — the block: head, verdict, figure strip, delta stamp |
| `src/components/chat/chat-message.tsx` | render the return when one was filed; docket line for user turns; `splitProvenance` moves out to `return.ts` |
| `src/components/chat/chat.css` | `.chat-return*`, `.chat-docket*`, `.chat-figs*`, `.chat-stamp*` |
| `src/lib/chat/system-prompt.ts` | the filing rules above |

`chat-artifacts.tsx` needs no change: its dispatch switch has no `default`
branch, so a `tool-fileReturn` part is ignored and produces no card. The
artifacts render **inside** the return as the evidence slot rather than below
the prose.

## Testing

Pure logic in `src/lib/chat/return.ts` is unit-tested in
`tests/lib/chat/return.test.ts` (vitest, node env, matching the repo's
`tests/**/*.test.ts` convention):

- `selectFiledReturn` returns null with no parts, no `fileReturn` part, or a
  part still streaming (`state !== "output-available"`).
- Picks the **last** filed return when the model files twice.
- Returns null rather than throwing on a malformed payload.
- Clamps `figures` to three and drops malformed entries.
- `returnForm` maps department/figure-count to `empty` / `short` / `full`.
- `splitProvenance` pulls the trailing `From …` line and leaves a body with no
  footer untouched.

Schema behaviour is tested in `tests/lib/chat/file-return.test.ts`: the tool is
registered, `execute` echoes input, and out-of-range payloads are rejected.

Gate: `npm test && npx tsc --noEmit && npm run build`.

## Out of scope

The function-and-speed layer — stop control, scroll lock plus jump-to-latest,
per-message copy/retry/branch, `aria-live`, the measure cap, thread search,
post-answer follow-up chips. All are real gaps, all are independent of this
change, and all are prototyped. They land separately.
