import { test, expect } from "@playwright/test"

/**
 * KNOWN DEFECT, NOT YET FIXED — `test.fail()`, so this file reports the day it
 * stops being true rather than the day it starts.
 *
 * ## What happens
 *
 * In a PRODUCTION build, navigating from any editorial `/m` route to any
 * Counter `/m` route throws a hydration mismatch (React #418) and React
 * regenerates the tree on the client. Measured, three loads out of three, for
 * every pair tried:
 *
 *     /m/pnl/<id> -> /m/menu     /m/chat -> /m/menu     /m/count -> /m/menu
 *
 * Counter to Counter is clean (`/m/invoices -> /m/menu`, three of three), and
 * so is any of these routes visited on its own. It is the CROSSING that fails.
 *
 * ## What it is not
 *
 * Not the server. The `/m/menu` HTML is byte-identical in both orders — the
 * only difference between two captures was the `today` timestamp six seconds
 * apart. Not stored state either: localStorage, sessionStorage and cookies are
 * identical after visiting an editorial page and after visiting a Counter one.
 *
 * Not the `/m` loading boundary, though that was a real defect found on the
 * way here and is fixed: `src/app/(mobile)/m/loading.tsx` used to draw the
 * editorial HOME skeleton over every route in the segment, and removing it
 * changed what the server streams without changing this result.
 *
 * ## The leading hypothesis
 *
 * `(mobile)/m/layout.tsx` imports the editorial stylesheets for EVERY route
 * under it, including the twenty Counter ones, which then add their own. React
 * 19 blocks hydration on `<link rel="stylesheet" data-precedence>`, so whether
 * the previous page warmed those sheets changes WHEN hydration runs relative
 * to the stream — and a Suspense boundary that resolves on one side of that
 * line and not the other is exactly this error. The fix would be to stop the
 * shared layout loading the old design's stylesheets for pages that do not use
 * them, which is the "delete it page by page" work this branch is already
 * doing, not a patch.
 *
 * ## Why it went unseen
 *
 * It does not reproduce in dev — dev does not stream the same way — and
 * `console-sweep.spec.ts` runs against the dev server. This was found by
 * pointing that same sweep at `npm run start` with `E2E_BASE_URL`, which is
 * how it should be run before a release.
 */
/*
 * SKIPPED unless `E2E_PROD=1`, and marked `fail` when it runs.
 *
 * Both halves are needed and neither is a dodge. It cannot run in the default
 * suite because that suite is the dev server, where the defect does not exist
 * — the test would PASS, and a passing `test.fail()` is itself a failure, so
 * the normal run would go red over a bug it cannot see. And it is marked
 * `fail` rather than deleted so that fixing the layout's stylesheet imports
 * turns this file red and asks for the marker to come off.
 *
 *     npm run build && PORT=3100 npm run start &
 *     E2E_PROD=1 E2E_BASE_URL=http://localhost:3100 npx playwright test --project=mobile
 */
test.skip(
  process.env.E2E_PROD !== "1",
  "Production-only: dev does not stream the same way. See the docblock.",
)
test.fail()
test("crossing from an editorial phone route into a Counter one hydrates cleanly", async ({
  page,
}) => {
  test.setTimeout(300_000)
  const errs: string[] = []
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 200)))

  await page.goto("/m/chat", { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(1500)
  await page.goto("/m/menu?range=d30", { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2000)

  expect(errs).toEqual([])
})
