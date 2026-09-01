/**
 * The `/dashboard` segment's loading boundary. It draws NOTHING, deliberately,
 * and it exists to let the document start.
 *
 * ## What it is worth, measured
 *
 * Every desk route answered its first byte at ~90ms while every phone route
 * answered at ~31ms, on the same machine against the same production build,
 * including pages with no content at all: `/dashboard/forbidden` took 85ms to
 * first byte and 85ms to last, so it was not streaming — it was waiting and
 * then sending everything.
 *
 * The wait is `src/app/dashboard/(counter)/layout.tsx`, which asks for the
 * account's stores so the rail can draw its switcher. A layout's own `await`
 * blocks its PARENT's flush, so until that query came back the browser had not
 * been given the `<head>` — not the stylesheet link, not one of the ~20
 * `<script>` preloads for the 350kB of JavaScript it is about to need. It sat
 * idle for the length of a database round trip before it could start.
 *
 * `/m` already had this file (`src/app/(mobile)/m/loading.tsx`) and that is
 * exactly why the phone answers at 31ms with the same query in its own shell:
 * a `loading.tsx` puts the segment's children — including the `(counter)`
 * layout, since a route group is not a segment — inside a Suspense boundary,
 * so everything above it flushes immediately and the shell streams in behind.
 *
 * ## Why nothing rather than a skeleton
 *
 * The same reason the phone's says so, learned the same way. This boundary
 * covers `/dashboard/**` entire — Counter routes and the still-editorial ones
 * — and cannot know which page is coming; a skeleton shaped like any of them
 * is wrong for the rest. On the phone, drawing the wrong one here threw a
 * hydration mismatch on three production loads out of three (React #418): the
 * server streamed the fallback and the client rendered a different root in its
 * place. The route-level `loading.tsx` files know which page they belong to,
 * and every Counter route already has one — `npm run tokens` fails the build
 * if it does not.
 *
 * ## This does not add a flash to navigation
 *
 * A shared layout is not re-rendered when you move between its children, so
 * this boundary is only entered when the `/dashboard` segment itself mounts:
 * a first load or a hard refresh. Clicking between rail items still shows the
 * destination route's own `loading.tsx`, unchanged.
 */
export default function DashboardSegmentLoading() {
  return null
}
