/**
 * The three judgement colours, as a closed set.
 *
 * The prototype writes `style="color:var(--" + i.tone + ")"` (queue(), line
 * 3074; kv(), line 3086) with an unchecked string. A typo there produces
 * `var(--warnn)`, which resolves to nothing, and the figure silently inherits
 * body ink — a defect no test and no linter would see, because nothing is
 * wrong with the markup.
 *
 * Taking a union instead makes that a compile error. `toneStyle` is the only
 * place a tone becomes a colour, so there is exactly one string to get right.
 *
 * `var(--good | --warn | --bad)` are declared in counter-components.css as
 * aliases of `--ct-good | --ct-warn | --ct-bad`, so this still reads its
 * colour from counter.css like everything else — nothing is decided here.
 * `npm run tokens`' no-colour-literal rule matches `#hex`, `oklch(`, `rgb(`
 * and `hsl(`; a `var(--…)` is none of those, so this is allowed. (Verified
 * against COLOUR_LITERAL in scripts/counter-lint.ts, not assumed.)
 */
export type Tone = "good" | "warn" | "bad"

/** The prototype's `style="color:var(--<tone>)"`, with the string checked. */
export function toneStyle(tone: Tone | undefined): { color: string } | undefined {
  return tone ? { color: `var(--${tone})` } : undefined
}
