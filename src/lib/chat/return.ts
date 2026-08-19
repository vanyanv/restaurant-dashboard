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
}

const FILE_RETURN_TOOL = "fileReturn"
const MAX_FIGURES = 3

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

    return {
      verdict,
      department,
      scope: str(out.scope) ?? "",
      figures,
    }
  }
  return null
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
