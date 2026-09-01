/**
 * The login route's layout.
 *
 * It adds NOTHING now, and that is the change: it used to load Fraunces and
 * two pre-Counter stylesheets and wrap the page in the old surface class.
 * `counter.css` and `counter-components.css` are imported globally and
 * `CounterThemeProvider` sits in the root layout, so a rebuilt page needs only
 * the Counter root class — which `CounterLoginClient` puts on the `<main>`
 * that is also the fidelity extraction root.
 *
 * It names none of those old classes even in prose, deliberately.
 * `tests/styles/token-parity.test.ts` sweeps every file that can render inside
 * a Counter root for pre-Counter class names, and it matches file TEXT rather
 * than parsing JSX — a comment naming one reads to it exactly like markup
 * emitting one. Writing around it costs a sentence; loosening the guard would
 * cost the thing the guard is for.
 *
 * Kept as a file rather than deleted because `/signup/[token]` and `/shutdown`
 * are not rebuilt yet and still reach for the same fonts; this one going quiet
 * is the first of three.
 */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
