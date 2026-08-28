# Ask — the front door

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** A question typed anywhere in Counter — ⌘K, or any section's "Ask
about this" — is answered in place, against the reader's current store and
range, by the chat that already exists.

**Spec:** [`docs/superpowers/specs/2026-08-27-ask-system-design.md`](../specs/2026-08-27-ask-system-design.md)

**Prototype:** `askRender()` at `docs/counter/counter-prototype.html:8611`,
`P.ask` at 4504, the palette at 8664.

---

## Working mode

BUILD VELOCITY. No tests except money arithmetic — and there is none here, so
none are owed. Gates: `npm test && npm run tokens && npx tsc --noEmit && npm run build`,
plus `npm run fidelity` whose baseline is **61 passed / 86 skipped**.

## Global Constraints

1. Never `prisma migrate dev`; no schema change in this plan.
2. Colour only from `ct-` tokens. `counter-components.css` is GENERATED.
3. A page never imports Prisma or a server action directly, never branches on a
   `SectionData` status, never renders `AppShell`/`PhoneShell`.
4. Every `page.tsx` under a `(counter)` group has a `loading.tsx` beside it.
5. Commits carry no `Co-Authored-By: Claude` line.
6. **Do not touch `/dashboard/chat` or `/m/chat`.** They work and hold real
   threads. They are replaced when the rail reaches Ask, not by this plan.
7. Nine lint rules run on `npm run tokens`. The newest,
   `no-raw-forecast-generation`, fires on any file naming a forecast accessor
   without mentioning `generatedAt`.

## What exists (measured 2026-08-27)

| piece | where |
|---|---|
| `POST /api/chat` | takes `{ messages: UIMessage[], conversationId? }`, reads owner off the session, 403s a non-owner |
| 116 tools, 13 of them forecast/ML | `src/lib/chat/tools/**` |
| `selectFiledReturn(parts)` → `FiledReturn` | `src/lib/chat/return.ts` |
| `FiledReturn` | `{ verdict, department, scope, figures: ReturnFigure[], followUps: string[] }` |
| `returnForm(filed)` → `"full" \| "short" \| "empty"` | same file |
| `splitProvenance(text)` → `{ body, footer }` | same file |
| `NO_DATA_DEPARTMENT` | `"No data"` — drives the empty form |
| the editorial answer block | `src/components/chat/chat-return.tsx`, 133 lines |
| `AskSurface` | `src/components/counter/ask/ask-surface.tsx`, 627 lines, takes `onSubmit?: (question: string, context: AskContext) => void` |
| `AskContext` | `{ page, store, range, sentence }` — **display strings**, derived in `src/lib/counter/ask-context.ts` |
| `AppShell` mounts `AskSurface` | `src/components/counter/shell/app-shell.tsx:269` — **with no `onSubmit`** |
| `Section`'s ask button | `src/components/counter/surface/section.tsx:307`, `<button class="askmini" data-askabout={question}>` |
| the rail's Ask item | `src/lib/counter/nav.ts:44` → `/dashboard/ask`, **a route that does not exist** |

---

## Task 1: the client hook, and the palette answers

**Files:**
- Create `src/lib/counter/use-ask.ts`
- Modify `src/components/counter/ask/ask-surface.tsx`
- Modify `src/components/counter/shell/app-shell.tsx`
- Modify `src/components/counter/shell/phone-shell.tsx` if it mounts the palette

**What it does.** `useAsk()` owns one question's lifecycle: idle → asking →
answered or failed. It POSTs to `/api/chat` with a single user message, reads
the streamed parts, and hands back `selectFiledReturn`'s result plus the tool
names that were called.

```ts
export interface AskAnswer {
  question: string
  filed: FiledReturn | null
  /** Prose the model wrote outside the filed block, provenance split off. */
  body: string
  /** Tool names called, in order, deduped — the "Read" row. */
  read: string[]
  form: ReturnForm
}
export type AskState =
  | { status: "idle" }
  | { status: "asking"; question: string }
  | { status: "answered"; answer: AskAnswer }
  | { status: "failed"; question: string; message: string }

export function useAsk(): {
  state: AskState
  ask: (question: string, context: AskContext) => void
  reset: () => void
}
```

**Scope travels in the question.** `AskContext` carries display strings, and
the API takes no scope field. So `ask()` prepends one line to the user message:

```
Answering about Overview · Chris N Eddys - Hollywood · Aug 20 – Aug 26.
<the question>
```

That is `AskContext.sentence`, which already exists and is already what the
palette shows the reader before they type. The system prompt already resolves a
named store through `listStores`. **Do not add a scope field to the API in this
task** — one change at a time, and this one costs nothing.

**The pane.** `AskSurface` renders `.cmdk__pane[data-cmdans]` only when there
is an answer in it. Its own docblock records why it was left out: *"An empty
pane that is `hidden` forever is exactly the dead markup note 46 is about, so
it arrives with the thing that fills it."* This is that thing.

**Escape and back.** Escape closes the palette. "Back to search" clears the
answer and leaves the question in the input — ruling F-R10, already in that
file: a question someone typed is not the palette's to throw away.

- [ ] Write `use-ask.ts`.
- [ ] Render the pane in `AskSurface` and wire `onSubmit` in `AppShell`.
- [ ] Gate: `npm run tokens && npx tsc --noEmit && npm run build`.
- [ ] **Browser check, required.** Warm the dev server, open `/dashboard`,
      press ⌘K, type "how were sales last week", submit. Report the question,
      the verdict, the figures and the "Read" list, quoted.
- [ ] Commit.

---

## Task 2: every section's question reaches the palette with its scope

**Files:** `src/components/counter/surface/section.tsx`, `ask-surface.tsx`.

The `.askmini` buttons already carry `data-askabout` and a document-level
delegated listener already pre-fills the palette from them. Today the pre-fill
is where it stops.

**Make the delegation submit, not just fill.** A click on `.askmini` opens the
palette with the question in it AND asks it. A suggestion row inside the
palette still only pre-fills — that distinction is deliberate and is in
`AskSurface`'s docblock.

**Carry the section's own scope.** The section knows the range it was rendered
for; the palette knows the reader's current one. They are the same today
because the page renders from the URL — so **read the scope from the URL in one
place** rather than threading it through every section. Say so in a comment,
because the day a section renders a different window than the URL says, this
breaks quietly.

- [ ] Change the delegation to submit.
- [ ] Gate, browser-check from a section button on Analytics, commit.

---

## Task 3: `/dashboard/ask` exists and the rail stops lying

**Files:** create `src/app/dashboard/(counter)/ask/{page,loading,counter-ask-client}.tsx`.

`nav.ts` has pointed at `/dashboard/ask` since the rail was built and no such
route has ever existed. This is the Counter Ask page and the target of the
palette's "Open in Ask".

**Composition** (`P.ask.desk()`, prototype 4504): the title IS the answer, so
the page has no title before one. Sub-line: "Asked from Overview · Hollywood ·
reading Aug 20 – Aug 26". Then the question, the verdict, the figures, the
"Read" list, the go buttons, the follow-ups.

**The page takes the question from the URL** (`?q=`), so an answer is a link
someone can send. That is the whole reason it is a page and not a modal.

**One turn only in this task.** A conversation needs history, a thread and a
conversation id; that is the next sub-project. A page that answers one question
from a URL is the honest first version.

- [ ] Build it. Gate. Browser-check. Commit.

---

## Task 4: the phone

**Files:** `src/app/(mobile)/m/(counter)/ask/{page,loading,client}.tsx`, plus
the `AskBar`/`AskSheet` wiring in `PhoneShell`; middleware entry.

Same answer, phone shell. `AskBar` and `AskSheet` already exist and are already
wired to the same delegation.

- [ ] Build. Gate. Browser-check both a question and a refusal. Commit.

---

## Task 5: gate it

- [ ] Flip `ask` in `e2e/fidelity/manifest.ts` to `report: true` first, measure
      all four surfaces, account for every difference against a ruling, then
      gate with measured baselines.
- [ ] `tests/e2e/landmarks.test.ts` asserts the gated roster in manifest order
      and will fail until `ask` is added. That failure is expected.
- [ ] Full gate + `npx playwright test e2e/ --project=desktop --project=mobile`.

---

## Rulings

**K-R1 — the question carries its own scope, in words.** `AskContext.sentence`
is prepended to the user message. No API change, no new field, and the system
prompt already resolves a named store. *Cost if wrong:* the model can misread a
store name, which `listStores` is there to catch.

**K-R2 — an answer names what it read, or it does not ship.** The "Read" row
is the product's whole argument. An assistant that answers without provenance
is the one thing this codebase has spent months not being.

**K-R3 — a refusal is an answer.** `NO_DATA_DEPARTMENT` and the empty form
already exist. A question Ask cannot answer says so, names why, and offers what
it could answer instead. It never guesses.

**K-R4 — the palette answers one question; the page holds the conversation.**
The prototype's own split. Anything with a second turn belongs on a URL.

**K-R5 — do not touch the editorial chat.** It works, it holds real threads,
and replacing it is a later sub-project.

**K-R6 — no charts in answers yet.** Figures stay scalar. Sub-project 2.
