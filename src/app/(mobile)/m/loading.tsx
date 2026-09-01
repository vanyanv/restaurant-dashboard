/**
 * The `/m` segment's loading boundary, which now draws NOTHING — and that is
 * a bug fix rather than a deletion.
 *
 * ## What it used to do
 *
 * It rendered `MobileRouteLoading route="/m"` — the editorial home skeleton,
 * with the "DAILY EDITION" masthead, the `m-toolbar` and the store-select
 * placeholder. A `loading.tsx` at this level wraps the WHOLE `/m` subtree in
 * one Suspense boundary, and `(mobile)/m/layout.tsx` is async, so that
 * boundary rendered on every phone navigation. Every Counter phone page —
 * all twenty of them — opened with the retired editorial home skeleton before
 * its own content arrived, on a branch whose entire premise is that the old
 * design is being deleted page by page.
 *
 * ## And what it broke
 *
 * Worse than a flash. Measured against a production build, visiting
 * `/m/pnl/<id>` and then `/m/menu` threw a hydration mismatch (React #418) on
 * three loads out of three: the server streamed this fallback into the
 * document and the client rendered `.ct-root.ct-phone` in its place. The
 * server HTML was byte-identical in both orders — the only variable was
 * whether the previous page had warmed the stylesheets, which changed WHEN
 * hydration ran relative to the stream.
 *
 * It reproduced in production only. Dev never showed it, because dev does not
 * stream the same way, and `e2e/mobile/console-sweep.spec.ts` was green
 * against the dev server the whole time. It was found by running that same
 * sweep against `npm run start`.
 *
 * ## Why nothing rather than a Counter skeleton
 *
 * Because there is nothing true to draw here. This boundary covers every
 * phone route at once and cannot know which one is coming; a skeleton shaped
 * like any of them is wrong for the rest, which is exactly the failure it had.
 * The route-level `loading.tsx` files know, and every route that wants one now
 * has one.
 */
export default function MobileSegmentLoading() {
  return null
}
