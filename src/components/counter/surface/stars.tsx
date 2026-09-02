/**
 * A star rating, drawn as the number it is.
 *
 * The prototype prints `.stars` as a fixed `★★★★★` glyph run beside the mean
 * (`counter-components.css:412` styles it as one flat `var(--signal)` string),
 * so a 3.2 average painted five full stars: the figure and the picture of the
 * figure disagreed, and the picture is what a reader takes in first. This
 * clips a `--ct-signal` run over a `--ct-ink-3` track at `value / max`,
 * so the fill IS the mean rather than a decoration beside it.
 *
 * The track is `--ct-ink-3`, and the first attempt got this wrong in a way
 * worth recording. It used `--ct-signal-line`, reasoning that it is the one
 * token in the signal family authored to sit quieter than `--ct-signal` in
 * both themes. It is — because it is a BORDER token, not a text one. Painting
 * glyphs with it put 13px text at 1.58:1 against `--ct-surface` in dark, and
 * `npm run fidelity`'s dark-mode pass failed it as CONTRAST #75, correctly:
 * a `--ct-*-line` token is for hairlines and has never been held to a text
 * contrast floor.
 *
 * `--ct-ink-3` is asserted at 4.5:1 against every surface it renders on, in
 * both themes, by `tests/styles/counter-tokens.test.ts`. It also lands on the
 * conventional treatment — a grey remainder behind a gold fill — which a
 * reader parses by HUE rather than by weight. The cost is real but small: in
 * light, ink-3 (52.5% lightness) is darker than the fill (80%), so an unfilled
 * star carries slightly more visual weight than a filled one. Hue does the
 * work that lightness cannot do in both themes at once.
 *
 * The glyphs are `aria-hidden`. They are a second rendering of a figure the
 * number beside them already states, and "black star black star black star
 * black star black star" after "4.6" is noise, not information. The caller
 * carries the "out of 5" a sighted reader infers from the glyph count.
 *
 * Metrics (13px, 1px letter-spacing) are set here rather than borrowed from
 * `.stars .s`, because that selector also sets `color: var(--signal)` at a
 * specificity a single Tailwind utility cannot outrank — the track would come
 * out the same colour as the fill, which is the defect this file exists to fix.
 */
export function Stars({ value, max = 5 }: { value: number; max?: number }) {
  const glyphs = "★".repeat(max)
  // Clamped, because a mean above the scale or below zero is a data fault, and
  // a fill that runs past its own track is a rendering fault on top of it.
  const filled = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0

  return (
    <span
      aria-hidden="true"
      className="relative inline-block whitespace-nowrap text-ct-body leading-none tracking-[1px] text-ct-ink-3"
    >
      {glyphs}
      <span
        className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap text-ct-signal"
        style={{ width: `${filled * 100}%` }}
      >
        {glyphs}
      </span>
    </span>
  )
}
