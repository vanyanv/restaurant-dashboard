import { PAGES } from "./manifest"

/**
 * Every route the sweeps walk, in one place.
 *
 * ## Why this is not just the gated fifty
 *
 * It was, and that is how a bug lived through four green gates. Six legacy
 * paths were answering with a rendered document and a `<meta http-equiv=
 * "refresh">` instead of a redirect — a second of waiting and a discarded
 * hydration on every one of them — and no sweep walked a single one, because
 * none of them is a manifest row. `e2e/desktop/legacy-redirect.spec.ts` holds
 * that specific defect now; this file is the general fix, which is that the
 * walk should cover what a READER can reach rather than what the fidelity
 * manifest happens to name.
 *
 * So: every manifest row including the three that are not gated — `ask`,
 * `pnlstore` and `more` are real routes, and being ungated says nothing about
 * whether a page throws — plus the pages below that have no row at all.
 */

/**
 * Live routes the fidelity manifest does not name, because the DESIGN has no
 * page for them. They are still pages a reader opens.
 *
 * All three are phone-only and all three are pre-Counter surfaces that have
 * not been rebuilt: `/m/chat` is the editorial chat, which `src/proxy.ts`
 * still maps `/dashboard/chat` onto for phones because the Counter Ask has no
 * thread history and this does; `/m/count` is the stock-count surface behind
 * the third tab; `/m/pnl/<id>` is the per-store statement the desk retired.
 *
 * The desk needs no equivalent list — every desk route outside the manifest is
 * a legacy path that redirects, and those are asserted by their own spec.
 */
export const EXTRA_PHONE_ROUTES = [
  "/m/chat",
  "/m/count",
  "/m/pnl/cmexd4zia0001jr04ljkdt9na",
] as const

/** Manifest rows as desk paths, deduped, query included. */
export function deskRoutes(): string[] {
  return [...new Set(PAGES.map((p) => p.route + (p.query ?? "")))]
}

/** The same on a phone, plus the surfaces the design never drew. */
export function phoneRoutes(): string[] {
  return [
    ...new Set([
      ...PAGES.map((p) => (p.mobileRoute ?? p.route) + (p.query ?? "")),
      ...EXTRA_PHONE_ROUTES,
    ]),
  ]
}

/**
 * A route plus the one manifest fact a sweep needs about it.
 *
 * `bare` is `P.login`/`P.signup`/`P.shutdown`: no rail, no topbar, no tab bar.
 * The a11y sweep asks each page to carry a minimum number of controls so a
 * shell that failed to render cannot pass by having nothing to check, and a
 * bare page legitimately has almost none. Nothing outside the manifest is
 * bare, so the extras below come through as `false`.
 */
export interface SweepTarget {
  route: string
  bare: boolean
}

export function deskTargets(): SweepTarget[] {
  return PAGES.map((p) => ({ route: p.route + (p.query ?? ""), bare: Boolean(p.bare) }))
}

export function phoneTargets(): SweepTarget[] {
  return [
    ...PAGES.map((p) => ({
      route: (p.mobileRoute ?? p.route) + (p.query ?? ""),
      bare: Boolean(p.bare),
    })),
    ...EXTRA_PHONE_ROUTES.map((route) => ({ route, bare: false })),
  ]
}
