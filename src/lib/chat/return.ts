import type { Presentation } from "./present"

/**
 * Selectors for the Answer Block — see
 * `docs/superpowers/specs/2026-08-19-chat-answer-block-design.md`.
 *
 * The model files one `fileReturn` tool call per turn carrying the verdict
 * line and up to three named figures. Everything here is defensive on
 * purpose: a malformed or half-streamed payload must fall back to the old
 * prose layout, never render an empty frame. `<ChatMessage>` treats a null
 * return as "render this turn the way we always did".
 */

export interface ReturnFigure {
  /** Preformatted by the model: "$48,912", "66.2%", "1,204". */
  value: string
  label: string
  delta?: string
  /** Semantic, not arithmetic — more produce spend is "down". */
  direction?: "up" | "down"
}

export interface FiledReturn {
  verdict: string
  department: string
  /** "Hollywood · Aug 11 – 17". Empty string when the model omitted it. */
  scope: string
  figures: ReturnFigure[]
  /** Questions this answer makes worth asking next. Model-authored, so they
   * are grounded in what it just read rather than a static chip list. */
  followUps: string[]
  /**
   * Tool names whose picture the model asked to draw, in its order.
   *
   * Empty means "it did not choose", which is not the same as "show nothing" —
   * see `selectPresentations`.
   */
  show: string[]
}

/** The three forms the block takes. See the spec's form-selection table. */
export type ReturnForm = "full" | "short" | "empty"

/** Structural view of a UI message part — the fields we read off the AI SDK's
 * parts array without importing its full union. */
export interface ReturnPart {
  type: string
  toolName?: string
  state?: string
  text?: string
  output?: unknown
  /** The arguments the tool ran with — the "params" half of the Read row. */
  input?: unknown
}

const FILE_RETURN_TOOL = "fileReturn"
const MAX_FIGURES = 3
const MAX_FOLLOW_UPS = 3

/** The department the model files when the question is out of scope. Drives
 * the empty form regardless of what else was filed. */
export const NO_DATA_DEPARTMENT = "No data"

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null
}

/** A figure needs both a value and a label to mean anything; anything less is
 * dropped rather than rendered as a floating number. */
function parseFigure(raw: unknown): ReturnFigure | null {
  if (!isRecord(raw)) return null
  const value = str(raw.value)
  const label = str(raw.label)
  if (!value || !label) return null
  const delta = str(raw.delta)
  const dir = raw.direction
  return {
    value,
    label,
    ...(delta ? { delta } : {}),
    ...(dir === "up" || dir === "down" ? { direction: dir } : {}),
  }
}

/**
 * The last `fileReturn` whose output has landed, or null. Last wins: if the
 * model files twice in a turn, the later call is its correction.
 */
export function selectFiledReturn(parts: readonly ReturnPart[]): FiledReturn | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (!p || typeof p.type !== "string") continue
    const name = p.toolName ?? p.type.replace(/^tool-/, "")
    if (name !== FILE_RETURN_TOOL) continue
    // Still streaming its input, or the call errored — not renderable yet.
    if (p.state !== "output-available") continue

    const out = p.output
    if (!isRecord(out)) continue
    const verdict = str(out.verdict)
    const department = str(out.department)
    if (!verdict || !department) continue

    const rawFigures = Array.isArray(out.figures) ? out.figures : []
    const figures: ReturnFigure[] = []
    for (const raw of rawFigures) {
      const fig = parseFigure(raw)
      if (fig) figures.push(fig)
      if (figures.length === MAX_FIGURES) break
    }

    const rawFollowUps = Array.isArray(out.followUps) ? out.followUps : []
    const followUps: string[] = []
    for (const raw of rawFollowUps) {
      const q = str(raw)
      if (q) followUps.push(q)
      if (followUps.length === MAX_FOLLOW_UPS) break
    }

    const rawShow = Array.isArray(out.show) ? out.show : []
    const show: string[] = []
    for (const raw of rawShow) {
      const name = str(raw)
      if (name && !show.includes(name)) show.push(name)
      if (show.length === MAX_SHOWN) break
    }

    return {
      verdict,
      department,
      scope: str(out.scope) ?? "",
      figures,
      followUps,
      show,
    }
  }
  return null
}

/* --------------------------------------------------------------------------
 * THE PICTURE UNDER THE FIGURES
 *
 * Built server-side by `src/lib/chat/present.ts` from the rows a tool
 * returned, and read back here the same way `selectFiledReturn` reads the
 * filed return: structurally, defensively, and from the one parser both the
 * live stream and a restored thread go through.
 *
 * Everything below is a shape check, not a trust check. The payload is ours,
 * but it also arrives out of a `ToolCall.result` row written weeks ago by a
 * build whose `Presentation` union was a different shape. A half-matching
 * payload draws nothing rather than a chart with holes in it.
 * ----------------------------------------------------------------------- */

/** One tool's picture, ready to render. */
export interface ShownPresentation {
  /** The tool that produced it — the caption, and the de-dupe key. */
  tool: string
  present: Presentation
}

/**
 * At most two. The answer is a verdict, three figures and a paragraph; a
 * third picture pushes all of it off the first screen, which is the problem
 * the block was built to solve rather than one to reintroduce.
 */
const MAX_SHOWN = 2

function isPresentation(v: unknown): v is Presentation {
  if (!isRecord(v)) return false
  if (typeof v.title !== "string") return false
  if (v.kind === "chart") {
    const spec = v.spec
    if (!isRecord(spec)) return false
    return Array.isArray(spec.labels) && Array.isArray(spec.series) && spec.series.length > 0
  }
  if (v.kind === "table") {
    return Array.isArray(v.columns) && Array.isArray(v.rows) && v.rows.length > 0
  }
  return false
}

/** The `present` a tool attached to its own result, if it drew one. */
export function presentFromOutput(output: unknown): Presentation | null {
  if (!isRecord(output)) return null
  const p = output.present
  return isPresentation(p) ? p : null
}

/**
 * Which pictures to draw beneath the figures.
 *
 * `show` is the model's choice, and it is honoured in the model's order — it
 * is the one thing about the presentation the model decides, because only it
 * knows which of the three tools it called was the one the question turned on.
 *
 * An ABSENT `show` is not "draw nothing". A turn that called one drawable tool
 * and answered from it has an obvious picture, and requiring the model to say
 * so would leave every older thread — and every turn where it simply forgot —
 * blank for no reason. So: no choice made, and exactly one picture available,
 * draws it. Two or more and the model has to choose, because guessing which of
 * them the answer meant is how the wrong chart ends up under the right number.
 *
 * A name in `show` that produced no picture — a tool that was not called, or
 * one whose rows were too few to plot — is skipped rather than reserved. The
 * schema already restricts the model to the drawable set; this is the second
 * half of the same guarantee, that naming a picture can never cost the answer
 * anything but the picture.
 */
export function selectPresentations(
  parts: readonly ReturnPart[],
  show: readonly string[] = [],
): ShownPresentation[] {
  const found: ShownPresentation[] = []
  for (const p of parts) {
    if (!p || typeof p.type !== "string") continue
    const name = p.toolName ?? p.type.replace(/^tool-/, "")
    if (!name || name === FILE_RETURN_TOOL) continue
    if (p.state !== "output-available") continue
    if (found.some((f) => f.tool === name)) continue
    const present = presentFromOutput(p.output)
    if (present) found.push({ tool: name, present })
  }

  if (show.length === 0) {
    return found.length === 1 ? found : []
  }
  const picked: ShownPresentation[] = []
  for (const name of show) {
    const hit = found.find((f) => f.tool === name)
    if (hit && !picked.includes(hit)) picked.push(hit)
    if (picked.length === MAX_SHOWN) break
  }
  return picked
}

/**
 * Which form the block takes. Deterministic from what was filed so the
 * decision is testable and the model cannot half-specify a layout.
 */
export function returnForm(filed: FiledReturn): ReturnForm {
  if (filed.department === NO_DATA_DEPARTMENT) return "empty"
  return filed.figures.length <= 1 ? "short" : "full"
}

/**
 * Splits the model's provenance footer ("From getDailySales · …") off the tail
 * of the note so it can be set in mono caption instead of body copy. Only a
 * trailing line counts — a sentence that happens to open with "From" mid-body
 * is prose, not provenance.
 */
export function splitProvenance(text: string): { body: string; footer: string | null } {
  if (!text) return { body: "", footer: null }
  const match = text.match(/\n+\s*(?:>\s*)?From\s+[^\n]+$/i)
  if (!match || match.index === undefined) return { body: text, footer: null }
  return {
    body: text.slice(0, match.index).trimEnd(),
    footer: match[0].replace(/^[\s>]+/, "").trim(),
  }
}
