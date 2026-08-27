# Ask — system design

**Status:** DRAFT 2026-08-27 — sub-project 1 specced in full; 2, 3 and 4 scoped
only, each to get its own spec when it is reached.

**The ask, in the owner's words:** *"a whole system connected to chart that can
answer any questions similar to Siri, which knows the restaurant inside out —
you can give it a photo and everything and it can tell the owners, it can also
predict based on training from our ML models."*

**The name:** it stays **Ask**. Decided 2026-08-27. No persona name, no
wake-word. The rail item, the palette, the section buttons and the page already
all say the same word, and a name is a thing to maintain in copy, prompts and
docs for no gain the product can feel.

---

## What already exists, measured 2026-08-27

This matters more than the plan, because most of the vision is already built and
the gap is narrower and more specific than it looks from the outside.

### Built and working

| piece | where | state |
|---|---|---|
| Chat API | `src/app/api/chat/route.ts` (323 lines) | live |
| **116 tool definitions** | `src/lib/chat/tools/**` — 20 modules | live |
| 13 of them are **forecast/ML** tools | `tools/forecasts/*` | live |
| Conversation persistence, search, auto-title, embeddings | `src/lib/chat/*` | live |
| **A structured answer block** | `src/lib/chat/return.ts` + `tools/file-return.ts`, spec `2026-08-19-chat-answer-block-design.md` | live |
| Desk chat page | `/dashboard/chat` (editorial) | live, real threads from Aug 17 and Aug 20 |
| Phone chat page | `/m/chat` | live |
| **Document vision, in production** | `src/lib/gemini-invoice.ts` — base64 + mimeType → Gemini 2.5 Flash, primary + fallback, `GEMINI` key in `.env.local` | live, for invoices |
| Eval harnesses | `scripts/eval-chat`, `scripts/eval-llm` | present (`eval:llm` cannot start on this branch — `server-only` under tsx) |

Models: `gpt-5-mini` routing, `gpt-4.1-nano` titles, `gemini-2.5-flash` for
documents. OpenAI for chat, per the owner's standing preference.

### The ML layer Ask can already reach

Ten tables — `ForecastDailyRevenue`, `ForecastHourlyOrders`, `ForecastMenuItem`,
`ForecastDailyCategory`, `MlForecastEvaluation`, `MlReconciliationDaily`,
`MlTrainingRun`, `GrowthOpportunity`, `AnomalyEvent`, `MenuItemElasticity` —
exposed through: `getRevenueForecast`, `getMenuItemForecast`,
`getOpenAnomalies`, `getFoodCostForecast`, `getLaborStaffingForecast`,
`getMenuEngineering`, `getCashPositionForecast`, `getVendorReliability`,
`getChannelMix`, `getWasteRootCauses`, `getLostSales`, `getPromoRoi`,
`getLaunchTrajectory`.

**Prediction is not work to be built. It is work to be reached for.**

### Not built

1. **Ask is unreachable from Counter.** `AskSurface` (627 lines) is mounted in
   `AppShell` with **no `onSubmit`**. Its own docblock says so: *"This
   application has no answer surface yet; `onSubmit` hands the question to the
   caller."* Type a question into ⌘K, press Enter, nothing happens.
2. **Every "Ask about this" button leads nowhere.** `Section` renders one per
   section carrying `data-askabout`, which pre-fills a palette that cannot
   answer. Note 55 in that file records that the button was once *"rendered on
   fifty pages and wired to nothing"*; it is now rendered only where there is
   an answer to ask about, and still wired to nothing.
3. **The rail's Ask link is dead.** `nav.ts` points at `/dashboard/ask`. No
   such route exists — `find src/app -type d -name ask` returns nothing. The
   chat is at `/dashboard/chat`.
4. **Answers carry no charts.** `ReturnFigure` is `{ value, label, delta,
   direction }` — preformatted scalars. Nothing renders a series.
5. **No general image intake.** The Gemini path takes an invoice PDF from a
   known pipeline. There is no way for an owner to hand Ask a photo.

---

## The four sub-projects

Ordered by what unblocks what, not by ambition.

### 1. The front door — Ask answers from inside Counter

**Specced below.** Without it none of the rest is reachable from the design the
product is being rebuilt into.

### 2. Answers that show

`ChartSpec` and `Chart` are the same primitives every Counter page draws with,
so a tool can return a chart spec and an answer can render a real Counter
chart — not a picture of one. Extends `FiledReturn` with an optional series
form and gives `file-return` a chart shape to fill.

### 3. Prediction, unprompted

The 13 forecast tools exist and are reached only when a question names them.
The work is routing — recognising a forward-looking question and reaching for
the forecast without being told — and **stating the band**. `ForecastDailyRevenue`
carries `p10`/`p90`; an answer that gives a point estimate without its interval
is a guess wearing a number's clothes. Also: every forecast table keeps **every
model generation**, and summing one raw is 12.7× on revenue and 13.17× on hourly
orders. Ask must never do that.

### 4. Eyes

The ingestion pattern is proven in production — base64 + mimeType → structured
extraction, with a fallback model. What is new is a general intake (photograph a
delivery, a shelf, a prep list, a competitor's board) and deciding what a photo
of a *thing* rather than a *document* should do. Scoped when reached.

---

# Sub-project 1: the front door

## Goal

A question typed anywhere in Counter — ⌘K, the Overview ask bar, or any
section's "Ask about this" — is answered in place, against the reader's current
store and range, by the chat that already exists.

## The target, from the prototype

`askRender()` at `docs/counter/counter-prototype.html:8611` and `P.ask` at 4504.
An answer carries, in order:

1. the question, echoed with the ask glyph
2. a lead paragraph — the verdict
3. a figure block
4. an optional caveat, as a callout
5. **"Read" — the sources**, each a name and a scope
6. go buttons — the pages this answer came from
7. follow-up suggestions, each carrying its own `data-askabout`
8. a footer: store · range, "Back to search", "Open in Ask"

Items 1–4, 7 and 8 map onto `FiledReturn` (`verdict`, `figures`, `scope`,
`followUps`) with no new server work. Item 5 maps onto the tool-call
provenance the answer block already computes (`splitProvenance`). Item 6 is
`nav.ts` destinations.

**So the server is not the work. The work is the surface and the scope.**

## Architecture

```
Section "Ask about this"  ─┐
Overview ask bar          ─┼─→ document-level [data-askabout] delegation
⌘K palette                ─┘        (one path in, already exists)
                                          │
                                          ▼
                              AskSurface.onSubmit(question, context)
                                          │
                                          ▼
                        AppShell → useAsk() → POST /api/chat
                                          │
                                          ▼
                          selectFiledReturn(parts) → AskAnswer
                                          │
                    ┌─────────────────────┴──────────────────────┐
                    ▼                                            ▼
        .cmdk__pane in the palette                    /dashboard/ask (the page)
        (the quick answer)                            (the full one, "Open in Ask")
```

**Scope travels with the question.** A section's button carries its own store
and range, because the answer to "why is food cost over plan" is a different
answer for a different week. Today `data-askabout` carries only text. It gains
the scope the section was rendered with, and the API's per-request context gets
it — `src/lib/chat/owner-scope.ts` already exists for this.

## What sub-project 1 does NOT do

- **No charts in answers.** That is sub-project 2. Figures stay scalar.
- **No new tools.** 116 is enough to answer with.
- **No image input.** That is sub-project 4.
- **No change to the editorial `/dashboard/chat` page.** It works and it has
  real threads in it. It gets replaced when the rail reaches Ask in the Counter
  rebuild, not before.

## Decisions

**D1 — `/dashboard/ask` becomes a real route and the rail stops lying.** It is
the Counter Ask page, and it is where "Open in Ask" goes. `/dashboard/chat`
keeps working underneath it until the Counter page can hold a conversation.

**D2 — The palette answers in place; the page holds the conversation.** The
prototype's own split, and it is right: a palette answer is one question and
one answer, dismissible with Escape. Anything with a second turn belongs on a
page with a URL.

**D3 — An answer names what it read, or it does not ship.** The "Read" row is
not decoration. This product's whole argument is that a number is worth what it
was computed from, and an assistant that answers without provenance is the one
thing the rest of the codebase has spent months not being.

**D4 — A refusal is an answer.** `NO_DATA_DEPARTMENT` already exists and the
answer block already has an empty form. A question Ask cannot answer says so,
names why, and offers what it could answer instead. It never guesses.

**D5 — The question is never thrown away.** Ruling F-R10, already in
`AskSurface`: the prototype's suggestion rows discard whatever was typed;
ours pre-fill. That holds for the answer pane too — going back leaves the
question in the box.

## Testing

Money arithmetic is not at stake here, so the build-velocity carve-out does not
apply and no new assertions are owed. What IS owed:

- the fidelity gate on `/dashboard/ask` against `P.ask`, both surfaces, once
  the page exists
- one end-to-end check that a question typed in ⌘K on the Overview returns an
  answer naming at least one source, run in a browser, reported with the
  question and the answer quoted

## Risks

**The chat API is session-scoped and owner-gated.** `getSplhSeries` and
`getAllStoresPnL` both refuse a non-owner, and `hasOwnerAccess` currently
returns true for every role the enum can hold — so the gate is inert but
present. Ask inherits whatever that gate becomes.

**`npm run eval:llm` cannot start on this branch** — `server-only` throws under
tsx. Anyone editing the system prompt in sub-project 3 will hit it. Fix it
before that, not during.

**Cost.** `gpt-5-mini` on every ⌘K submission, with 116 tool definitions in the
prompt. The editorial chat already carries this; the palette will multiply the
call count. Worth measuring before it is worth optimising — but measure it.
