import { test, expect } from "@playwright/test"

/**
 * KNOWN DEFECT, NOT YET FIXED — `test.fail()`, so this file reports the day it
 * stops being true rather than the day it starts.
 *
 * ## What happens
 *
 * In a PRODUCTION build, navigating from any editorial `/m` route to any
 * Counter `/m` route throws a hydration mismatch (React #418) and React
 * regenerates the tree on the client.
 *
 * It is the CROSSING, not any one page. Three editorial routes were tried as
 * the source — `/m/pnl/<id>`, `/m/chat`, `/m/count` — and four Counter routes
 * as the destination — `/m/menu`, `/m/invoices`, `/m/orders`, `/m/recipes`.
 * Every pair fails. Counter to Counter is clean (`/m/invoices -> /m/menu`,
 * three of three) and so is any of these routes on its own.
 *
 * ## Who actually hits it
 *
 * A full document load, which is what this test does and what a bookmark, a
 * refresh, a typed URL or a link out of an email does. A tap on a link inside
 * the app is a client-side route change and never hydrates, so it cannot
 * produce this. That narrows the exposure without excusing it: the phone is
 * where people arrive from a bookmark on the home screen, and `/m/chat` and
 * `/m/count` are two of the five tabs.
 *
 * IT IS ONE-WAY, which is the most useful thing known about it. Counter into
 * editorial is clean every time — `/m/chat` never once threw, in any order.
 * Only the Counter subtree mis-hydrates, and only when the page before it was
 * outside that subtree.
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
 * ## One hypothesis, tested and WRONG
 *
 * That it was stylesheet warmth: `(mobile)/m/layout.tsx` loads the editorial
 * sheets for every route including the Counter ones, React 19 blocks
 * hydration on `<link rel="stylesheet" data-precedence>`, so a cold Counter
 * sheet would move hydration relative to the stream. It is disproved twice
 * over. Warming the Counter sheets first (`/m/invoices` -> `/m/chat` ->
 * `/m/menu`) fails exactly as before, and `/m/invoices` fails on its SECOND
 * visit in the same session, when its own sheets cannot be cold.
 *
 * Recorded because a wrong lead that has been paid for is worth more than a
 * blank: whoever picks this up should not spend the afternoon on caching.
 *
 * ## What is left to look at
 *
 * The structural difference between the two subtrees, given the one-way
 * asymmetry above. A Counter phone route has an extra async layout —
 * `(mobile)/m/(counter)/layout.tsx` awaits `getOverviewStores()` — so it
 * carries a Suspense boundary that an editorial route does not, and its
 * fallback is the segment-level `/m/loading.tsx` while `/m/chat` and
 * `/m/pnl/<id>` have `loading.tsx` files of their own. That boundary is where
 * the mismatch lands: the diff between the server stream and the hydrated DOM
 * begins at `<template id="B:0">` inside `main.m-shell__main`.
 *
 * The wider fix is the one this branch is already heading for. Counter phone
 * pages render INSIDE the editorial shell — `editorial-surface`, `.m-shell`,
 * and the editorial `MobileTabBar`, because `PhoneShell` draws `.mtop` and
 * `.mscroll` and no tab bar of its own. The old design cannot be unloaded from
 * these routes until that tab bar is rebuilt in Counter, and that is a design
 * job rather than a bug fix.
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

  // Two crossings rather than one, from different editorial routes into
  // different Counter ones, so a fix that happens to cure a single pair does
  // not read as a fix for the defect.
  for (const [from, to] of [
    ["/m/chat", "/m/menu?range=d30"],
    ["/m/count", "/m/invoices"],
  ]) {
    await page.goto(from, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(1500)
    await page.goto(to, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(2000)
  }

  expect(errs).toEqual([])
})
