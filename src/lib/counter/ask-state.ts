"use client"

/**
 * The Ask lifecycle as PURE STATE — no model call, no SDK.
 *
 * ## Why this is a separate module from `use-ask.ts`
 *
 * It is a bundle boundary, and an invisible one if it is ever undone.
 * `use-ask.ts` imports `useChat` from `@ai-sdk/react` and
 * `DefaultChatTransport` from `ai`. It used to export BOTH that hook and the
 * pure selectors below, and ES modules have no way to take half a module — so
 * `ask-answer.tsx` and `ask-surface.tsx`, which read only `askAnswer` and
 * `AskState`, dragged the entire AI SDK in behind them. Through the Counter
 * barrel that reached all 42 rebuilt routes: every one shipped the SDK for a
 * palette that is not on screen until someone presses ⌘K.
 *
 * So: everything here is a function of state, and NOTHING here may import
 * `@ai-sdk/*`, `ai`, or `./use-ask`. The hook imports these, never the
 * reverse. `tests/lib/counter/ask-state.test.ts` asserts that.
 */
import {
  returnForm,
  selectFiledReturn,
  splitProvenance,
  type FiledReturn,
  type ReturnForm,
  type ReturnPart,
} from "@/lib/chat/return"
import type { AskContext } from "./ask-context"
import type { AskTurnMeta } from "./ask-meta"

/**
 * ONE question's lifecycle, for the ⌘K palette.
 *
 * `POST /api/chat` has existed for months with 116 tools behind it and a
 * structured answer format (`fileReturn` → `selectFiledReturn`), and the
 * palette that every Counter page mounts could not reach it: `AppShell`
 * passed `AskSurface` no `onSubmit`. This is the wire.
 *
 * ---------------------------------------------------------------------------
 * WHY `useChat` AND NOT A HAND-ROLLED `fetch`
 * ---------------------------------------------------------------------------
 *
 * The route answers in the AI SDK's UI-message stream, and `selectFiledReturn`
 * reads `parts[]` — `type`, `state`, `output` — off a settled assistant
 * message. `useChat` is the thing that turns that stream back into `parts[]`.
 * Re-implementing the decoder here would be a second parser for one wire
 * format, and the one figure/one function rule applies to a stream as much as
 * to a number.
 *
 * ---------------------------------------------------------------------------
 * ONE QUESTION, NOT A CONVERSATION (K-R4)
 * ---------------------------------------------------------------------------
 *
 * `ask()` clears the message list before it sends, so the palette never sends
 * a second turn and never pays for history it will not show. The palette
 * answers one question; the page holds the conversation. No `conversationId`
 * is sent either — the route creates one per question, which is what makes
 * "Open in Ask" have something to open once that route exists.
 *
 * ---------------------------------------------------------------------------
 * SCOPE TRAVELS IN THE QUESTION (K-R1)
 * ---------------------------------------------------------------------------
 *
 * `AskContext.sentence` — "Answering about Overview · Chris N Eddys -
 * Hollywood · Aug 20 – Aug 26" — is prepended to the user message. It is
 * already the line the palette shows the reader BEFORE they type, so what
 * gets sent is exactly what was promised on screen, and the system prompt
 * resolves the named store through its own `listStores` tool. The route takes
 * no scope field and does not grow one for this.
 */

export interface AskAnswer {
  question: string
  filed: FiledReturn | null
  /** Prose the model wrote outside the filed block, provenance split off. */
  body: string
  /** Tool names called, in order, deduped — the "Read" row. */
  read: ToolRead[]
  form: ReturnForm
  /**
   * What the turn cost and which `ChatTurn` it became — off the message's
   * metadata for a live turn, off the adapter for a restored one. `null`
   * until the route's `finish` lands, and for good on a turn whose row was
   * never written; the footer prints nothing it did not get (D2).
   */
  meta: AskTurnMeta | null
  /**
   * The assistant `Message.id`, for "Fork from here". Only a RESTORED turn
   * has one: the SDK's client-side ids are not the database's, so a turn
   * asked in this session forks from the rail (through its last message)
   * after the refresh that lists it.
   */
  messageId: string | null
}

/**
 * One thing the model is doing, or has done, while an answer is in flight.
 *
 * This is the whole of what `.tstep` renders — see `Thinking`. `reading` is a
 * tool whose call has gone out and whose output has not landed; `read` is one
 * whose output has. Those are the only two states a part can be in that the
 * reader has any use for: `input-streaming` and `input-available` are both
 * "asked, waiting", and the difference between them is plumbing.
 */
export interface AskStep {
  /** The registered tool name — `labelFor` turns it into words. */
  tool: string
  /**
   * NOT named `status`. That word belongs to `SectionData` in this codebase,
   * and `no-status-branch` matches `.status ===` textually — it cannot tell an
   * `AskStep` from a section, so calling this `status` made every read of it
   * look like the defect that rule exists to catch. `state` is also the AI
   * SDK's own word for the same thing on a message part.
   */
  state: "reading" | "read"
}

/**
 * ONE turn on a surface that holds a conversation: what was asked, and the
 * state of the answer to it.
 *
 * A list of these is what the Ask page renders. It exists so that the page
 * never inspects `AskState.status` to decide what to draw — the same reason
 * every other accessor in this file exists — and so that the desk and the
 * phone iterate the same shape.
 */
export interface AskTurnView {
  /** Stable across a turn's whole life; the turn's position in the thread. */
  id: string
  /** The question as the reader typed it — unscoped, unprefixed. */
  question: string
  state: AskState
}

export type AskState =
  | { status: "idle" }
  | {
      status: "asking"
      question: string
      /**
       * What has been read so far, in the order it was read.
       *
       * EMPTY IS A REAL STATE and not a missing one: for the first seconds of
       * a turn the model is choosing a tool and has called nothing, so there
       * is genuinely nothing to report. `Thinking` draws its own opening step
       * for that rather than an empty box.
       */
      steps: AskStep[]
    }
  | { status: "answered"; answer: AskAnswer }
  | { status: "failed"; question: string; message: string }
  /**
   * The reader pressed Stop. What streamed is kept — the steps show which
   * sources were read and which one was cut — and the question is kept
   * with it, so Continue can ask it again without retyping (F-R10).
   */
  | { status: "stopped"; question: string; steps: AskStep[]; durationMs: number }

/** Filing the return is not reading anything, so it never appears in "Read". */
const FILE_RETURN_TOOL = "fileReturn"

/**
 * What the turn actually read, in the order it read it.
 *
 * A tool whose output never landed read nothing — a call that errored or was
 * still streaming its input would put a source on the row that produced no
 * figure, which is the precise dishonesty K-R2 exists to prevent.
 */
/**
 * One source an answer read: what it was, what it was asked, and how fresh
 * the table behind it is.
 *
 * The proposal's "Read row", and the reason it is worth more than the tool
 * name alone: a reader who cannot see the parameters cannot tell an answer
 * about the right week from an answer about the wrong one, and Otter backfills
 * closed windows, so a figure with no `asOf` cannot be checked at all.
 */
export interface ToolRead {
  tool: string
  /** `store=Hollywood · days=30`, or null when the tool took no arguments. */
  params: string | null
  /** ISO stamp from the tool's own result, or null when it reports none. */
  asOf: string | null
}

/**
 * The tool's arguments as one short line.
 *
 * Deliberately lossy. This sits under an answer, not in a debugger: long
 * values are cut, objects and arrays are summarised rather than dumped, and
 * the whole line is capped. A Read row that wraps to four lines stops being
 * read at all.
 */
export function formatToolParams(args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null
  const parts: string[] = []
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (v === null || v === undefined || v === "") continue
    let shown: string
    if (Array.isArray(v)) shown = `${v.length} item${v.length === 1 ? "" : "s"}`
    else if (typeof v === "object") shown = "…"
    else shown = String(v)
    if (shown.length > 24) shown = `${shown.slice(0, 23)}…`
    parts.push(`${k}=${shown}`)
    if (parts.length === 4) break
  }
  return parts.length > 0 ? parts.join(" · ") : null
}

/** The `asOf` a tool attached to its own result, if it reported one. */
export function asOfFromOutput(output: unknown): string | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null
  const v = (output as Record<string, unknown>).asOf
  return typeof v === "string" ? v : null
}

/**
 * The Read row for a finished turn.
 *
 * Same exclusions as `toolNamesFrom`, for the same reasons — a tool whose
 * output never landed read nothing, and `fileReturn` reads nothing ever. The
 * difference is only how much of each source survives.
 *
 * De-duplicated by tool name, keeping the FIRST call's parameters: a tool
 * called twice is one row, and the row that matters is the one the answer
 * opened with.
 */
export function toolReadsFrom(parts: readonly ReturnPart[]): ToolRead[] {
  const out: ToolRead[] = []
  for (const p of parts) {
    if (!p || typeof p.type !== "string") continue
    const name = p.toolName ?? (p.type.startsWith("tool-") ? p.type.slice("tool-".length) : null)
    if (!name || name === FILE_RETURN_TOOL) continue
    if (p.state !== "output-available") continue
    if (out.some((r) => r.tool === name)) continue
    out.push({
      tool: name,
      params: formatToolParams(p.input),
      asOf: asOfFromOutput(p.output),
    })
  }
  return out
}

/** Shared with `use-ask.ts`, which builds an AskAnswer from a finished return. */
export function toolNamesFrom(parts: readonly ReturnPart[]): string[] {
  const out: string[] = []
  for (const p of parts) {
    if (!p || typeof p.type !== "string") continue
    const name = p.toolName ?? (p.type.startsWith("tool-") ? p.type.slice("tool-".length) : null)
    if (!name || name === FILE_RETURN_TOOL) continue
    if (p.state !== "output-available") continue
    if (!out.includes(name)) out.push(name)
  }
  return out
}

/** The model's own paragraphs, in order, with the provenance footer split off
 *  — the "Read" row is the provenance now, and printing it twice reads as two
 *  different claims about the same sources. */
/** Shared with `use-ask.ts` — see `toolNamesFrom`. */
export function proseFrom(parts: readonly ReturnPart[]): string {
  const text = parts
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => (p.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n")
  return splitProvenance(text).body.trim()
}

/* --------------------------------------------------------------------------
 * SELECTORS
 *
 * Branching on a `status` field is `surface/`'s and `lib/counter`'s job, not a
 * component's — `npm run tokens`' `no-status-branch` rule says so, and it is
 * right here for the ordinary reason as well: a pane that reads three payloads
 * off three narrowed shapes is a pane that has to be re-checked every time the
 * union grows. These three are the whole surface a renderer needs.
 * ----------------------------------------------------------------------- */

/** The question as the reader typed it — unscoped, unprefixed. "" when idle. */
export function askQuestion(state: AskState): string {
  if (state.status === "idle") return ""
  if (state.status === "answered") return state.answer.question
  return state.question
}

/** The settled answer, or null while asking / failed / idle. */
export function askAnswer(state: AskState): AskAnswer | null {
  return state.status === "answered" ? state.answer : null
}

/** Why it could not answer at all — a transport or auth failure, NOT a
 *  no-data refusal, which is a real answer and arrives as one (K-R3). */
export function askFailure(state: AskState): string | null {
  return state.status === "failed" ? state.message : null
}

/** A question is in flight. A surface with a send button does not offer a second. */
export function askPending(state: AskState): boolean {
  return state.status === "asking"
}

export function askStopped(
  state: AskState,
): { question: string; steps: AskStep[]; durationMs: number } | null {
  return state.status === "stopped" ? state : null
}

/**
 * The state to RENDER for a question that came from a URL rather than a
 * keystroke — `/dashboard/ask?q=…`.
 *
 * `ask()` can only run in an effect, so the server render and the tick before
 * `useChat` reaches `submitted` both sit at `idle` with a question already in
 * the address bar. Rendering the idle surface there flashes "nothing asked
 * yet" over a question the reader can read in their own URL. A question with
 * nothing yet said about it IS being asked, and this is the one place that
 * judgement is made — a page branching on the union itself is what
 * `no-status-branch` exists to stop.
 */
export function askStateFor(state: AskState, question: string): AskState {
  if (!question) return state
  return state.status === "idle" ? { status: "asking", question, steps: [] } : state
}

/**
 * The steps a turn has taken so far, or none when it is not in flight.
 *
 * A reader of `AskState` gets this the way it gets the answer, the failure and
 * the question — through an accessor, not by inspecting `.status`. That is the
 * convention this file already sets (`askAnswer`, `askFailure`, `askQuestion`,
 * `askPending`), and it is also what keeps `no-status-branch` satisfied in the
 * component: `npm run tokens` matches `.status ===` textually and cannot tell
 * an `AskState` from a `SectionData`, so a branch in `ask-answer.tsx` reads as
 * the defect that rule exists to catch. Doing the narrowing here is both the
 * house style and the honest place for it.
 */
export function askReading(state: AskState): AskStep[] {
  return state.status === "asking" ? state.steps : []
}

/**
 * The reading log for a turn in flight.
 *
 * `toolNamesFrom` answers a different question — what a FINISHED turn read,
 * for the "Read" row — so it keeps only `output-available` parts and drops
 * `fileReturn`, which reads nothing. Both exclusions are wrong here.
 *
 * A step whose output has not landed is exactly the one the reader is waiting
 * on, and it is the only step worth animating. And filing the return is a
 * whole model round trip — measured at roughly a third of a turn's wall clock
 * — so hiding it would leave the log looking finished while the reader waits
 * through the longest step of all.
 *
 * De-duplicated by tool name, keeping the FURTHEST state reached: a tool
 * called twice is one line that ends up `read`, not two lines disagreeing.
 */
export function askSteps(parts: readonly ReturnPart[]): AskStep[] {
  const order: string[] = []
  const reached = new Map<string, "reading" | "read">()

  for (const p of parts) {
    if (!p || typeof p.type !== "string") continue
    const name = p.toolName ?? (p.type.startsWith("tool-") ? p.type.slice("tool-".length) : null)
    if (!name) continue
    if (!reached.has(name)) order.push(name)
    // Only ever advances. An `output-available` part cannot be un-read by a
    // later `input-streaming` one for the same tool.
    if (p.state === "output-available") reached.set(name, "read")
    else if (!reached.has(name)) reached.set(name, "reading")
  }

  return order.map((tool) => ({ tool, state: reached.get(tool) ?? "reading" }))
}

/**
 * The turns to RENDER for a surface whose question can also arrive from the
 * URL — `/dashboard/ask?q=…`.
 *
 * `ask()` can only run in an effect, so the server render and the tick before
 * it fires both have an empty turn list with a question already in the address
 * bar. Drawing the empty state there flashes "nothing asked yet" over a
 * question the reader can read in their own URL, so a question with no turn
 * yet IS a turn being asked — the same judgement `askStateFor` makes for the
 * single-answer surfaces, made once, here, rather than in two page clients.
 */
export function askTurnsFor(turns: AskTurnView[], question: string): AskTurnView[] {
  if (turns.length > 0) return turns
  if (!question) return []
  return [{ id: "0", question, state: { status: "asking", question, steps: [] } }]
}

/**
 * A STORED turn, as the state that renders it — so a thread being read again
 * goes through `AskAnswerBody` exactly as a live one does.
 *
 * The alternative, and what both Ask clients used to do, was hand-written
 * `.ans` / `.manswer` markup per surface for restored turns: a paragraph and a
 * "Read" row, with no verdict tone, no figure strip and no follow-ups. Two
 * renderers for one answer is how the thing you re-open stops looking like the
 * thing you read — and here it was also how the figures went missing, because
 * the second renderer had no idea a strip existed. `AskAnswerBody`'s own note
 * makes the rule: "a second renderer is how two surfaces come to disagree
 * about what an answer looks like."
 *
 * `body` is put through `splitProvenance` for the same reason the live path
 * does: the model's "From getDailySales · …" footer is what the "Read" row
 * already says, and printing both reads as two different claims about one set
 * of sources.
 *
 * `filed` is null for an answer written before `fileReturn` existed, or one
 * the model chose not to file. That lands on `form: "empty"`, which is what a
 * live turn in the same position produces — prose in the callout, its sources
 * beneath — rather than a special case for history.
 */
export function restoredAskState(turn: {
  /** The assistant `Message.id` — what "Fork from here" branches through. */
  id: string
  question: string
  /** The assistant's stored prose. */
  text: string
  /** Tool names, `fileReturn` already excluded by the adapter. */
  read: ToolRead[]
  filed: FiledReturn | null
  meta: AskTurnMeta | null
}): AskState {
  return {
    status: "answered",
    answer: {
      question: turn.question,
      filed: turn.filed,
      body: splitProvenance(turn.text).body.trim(),
      read: turn.read,
      form: turn.filed ? returnForm(turn.filed) : "empty",
      meta: turn.meta,
      messageId: turn.id,
    },
  }
}
