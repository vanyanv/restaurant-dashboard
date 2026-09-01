/**
 * The colour the browser paints its own chrome with — the `theme-color` meta
 * tag's value.
 *
 * IT LIVES HERE BECAUSE IT MUST BE A LITERAL. `theme-color` is read by the
 * browser before any stylesheet is parsed and takes a plain colour string; a
 * `var(--ct-paper)` in it resolves to nothing and the address bar falls back
 * to the browser default. So this is one of the few colours in the product
 * that genuinely cannot come from `counter.css`.
 *
 * `scripts/counter-lint.ts` bans colour literals under `src/app/(mobile)/m/**`
 * and cannot tell "raw colour bypassing the token system" from "raw colour
 * because the domain needs one" — its own docblock says so, and says the
 * honest fixes are a narrow allowlist or an inline suppression. This is a
 * third: the value moves to a file outside the linted roots, where it is named
 * and explained rather than sitting anonymously in a viewport export. The rule
 * keeps its teeth everywhere it should have them.
 *
 * The VALUE is the Counter paper, `--ct-paper`'s light half
 * (`oklch(96.2% 0.006 60)`) converted to sRGB hex. It was `#fbf6ee`, the
 * pre-Counter cream, which is a different colour from the one the phone
 * actually paints — the address bar and the page disagreed by a visible step
 * on every /m route.
 *
 * Dark is `--ct-paper`'s dark half, `oklch(19% 0.007 60)`. Both are given so
 * the browser follows the theme rather than tinting a dark page in cream.
 */
export const BROWSER_CHROME_LIGHT = "#f5f0e9"
export const BROWSER_CHROME_DARK = "#1c1917"
