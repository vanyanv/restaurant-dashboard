/**
 * The fidelity gate.
 *
 * `npm run tokens` cannot see a missing dispatch line or a table that should
 * be cards. Nothing in this repo could, which is why a Counter page with six
 * bordered cards where the design has sixteen structural elements survived
 * seven plans and a permanently green gate. This suite is the thing that can.
 *
 * Three passes per page, and all three must be clean (ruling F-R2):
 *
 *   1. STRUCTURE. The ordered sequence of landmarks must match the
 *      prototype's, failing by naming every missing and every extra element.
 *      This is the pass that catches a table where note 33 specifies cards.
 *   2. RENDERING, IN LIGHT, against the prototype. For landmarks present on
 *      both sides, the eighteen checked properties must agree.
 *   3. DARK, on its OWN terms — never against the prototype. Its application
 *      tokens are light-only and dark is this project's own design; the ported
 *      sheet inherited 35 colour literals from it, and `.qbtn[aria-pressed]`
 *      paints var(--ink) (near-white in dark) behind a hardcoded light grey.
 *      A gate that compared dark against the prototype would call that
 *      invisible text a perfect match.
 *
 * Compared by structure, never by pixel: the prototype's figures are invented
 * and ours come from a real database, so an image diff is almost entirely
 * noise. Text is compared for PRESENCE only.
 */
import fs from "node:fs"
import path from "node:path"
import { test, expect, type Locator, type Page, type TestInfo } from "@playwright/test"
import { PAGES, absenceBudget,
  extraBudget, styleBudget, type FidelityPage } from "./manifest"
import { openPrototype, surfaceRoot, type Surface } from "./prototype"
import { extractLandmarksInPage, extractThemedInPage } from "./extract"
import {
  CHECKED_PROPERTIES,
  COMPARED_ATTRIBUTES,
  LANDMARK_CLASSES,
  applyAbsenceAllowances,
  applyExtraAllowances,
  applyStyleAllowances,
  compareLandmarks,
  defectWhere,
  emptyStateDefect,
  matchedCount,
  findThemeDefects,
  landmarkTally,
  type Difference,
  type Landmark,
} from "./landmarks"

/**
 * Where `npm run fidelity:report` reads from. Gitignored; the .md it renders is
 * not. Deliberately NOT under test-results/ — Playwright wipes that directory
 * at the start of every run, so `--project=fidelity` alone would have silently
 * destroyed the mobile half of the last report before rendering it.
 */
const DATA_DIR = path.resolve(__dirname, "../../.fidelity")

/**
 * Our page's content root. `#ct-main` is the Counter shell's; `.m-shell__main`
 * is the mobile shell's. The fallback keeps a page that composes neither from
 * silently extracting nothing — and if it ever does extract nothing while the
 * prototype has landmarks, that reads as "every landmark missing", which is
 * loud, rather than as a pass.
 */
/**
 * Our content root, as a list tried IN ORDER — see `ExtractArgs.rootSelectors`
 * for why order and not a comma-joined selector.
 *
 *   `#ct-main`            the desk. `AppShell`'s `<main class="screen">`, and
 *                         the prototype's own `.screen` on the other side.
 *   `.ct-phone .mscroll`  the phone. `PhoneShell`'s scroll region, and the
 *                         prototype's own `.mscroll`. It sits INSIDE the
 *                         editorial mobile layout's `main.m-shell__main`, so
 *                         a joined selector picked the `<main>` and swept the
 *                         phone's top chrome with it — `MTop`, its store
 *                         switcher and its date sheet — none of which the
 *                         prototype's root contains.
 *   `main.m-shell__main`  a phone page still on the editorial shell.
 *   `main`                anything else with a content root at all.
 */
const OUR_ROOT = ["#ct-main", ".ct-phone .mscroll", "main.m-shell__main", "main"] as const

/** For a locator and for an error message, where a string is wanted. */
const OUR_ROOT_SELECTOR = OUR_ROOT.join(", ")

function surfaceOf(testInfo: TestInfo): Surface {
  return testInfo.project.name === "fidelity-mobile" ? "phone" : "desk"
}

/**
 * The path we expect to be standing on after asking for `entry.route`. The
 * mobile middleware rewrites /dashboard/* to /m/*, so the mobile projects have
 * their own expectation — recorded in the manifest, not inferred here.
 */
function expectedPath(entry: FidelityPage, page: Page): string {
  const isMobile = (page.viewportSize()?.width ?? 1440) < 900
  return (isMobile && entry.mobileRoute) || entry.route
}

async function extractOurs(page: Page): Promise<Landmark[]> {
  return page.evaluate(extractLandmarksInPage, {
    rootSelectors: [...OUR_ROOT],
    landmarkClasses: [...LANDMARK_CLASSES],
    checkedProperties: [...CHECKED_PROPERTIES],
    comparedAttributes: [...COMPARED_ATTRIBUTES],
  })
}

async function extractProto(
  page: Page,
  surface: Surface,
  entry: FidelityPage,
): Promise<Landmark[]> {
  return page.evaluate(extractLandmarksInPage, {
    rootSelectors: [surfaceRoot(entry, surface)],
    landmarkClasses: [...LANDMARK_CLASSES],
    checkedProperties: [...CHECKED_PROPERTIES],
    comparedAttributes: [...COMPARED_ATTRIBUTES],
  })
}

/**
 * Opens our own page, in the theme asked for, and refuses to go on if we did
 * not actually land on it. A page that redirected to /login extracts zero
 * landmarks, which — paired with a prototype side that also came back empty —
 * is the exact silence `compareLandmarks` throws on. Catching it here names
 * the real cause instead.
 */
async function openOurs(
  page: Page,
  entry: FidelityPage,
  theme: "light" | "dark",
): Promise<void> {
  // `emulateMedia` alone does NOT put this app in dark, and quietly running the
  // dark pass against a light render is exactly the class of bug this suite
  // exists to stop. src/styles/counter.css pins `:root { color-scheme: light }`
  // deliberately (see its comment — it stays pinned until the editorial tree is
  // gone), so an OS preference is ignored and only an explicit user choice
  // flips light-dark(). So the theme is set the way a user sets it: the
  // provider's own localStorage key, read by themeNoFlashScript before React
  // renders. emulateMedia is kept as well, so the day that pin is lifted this
  // still asks for the same theme.
  await page.emulateMedia({ colorScheme: theme })
  await page.context().addInitScript(
    (t) => {
      try {
        localStorage.setItem("counter-theme", t)
      } catch {
        /* a context with site data blocked; the assertion below will say so */
      }
    },
    theme,
  )
  // `query` puts the reader in the window the prototype's own page is in —
  // see the manifest's field comment. `expectedPath` below compares PATHNAMES,
  // so a query never affects the landed-path assertion.
  const response = await page.goto(`${entry.route}${entry.query ?? ""}`, {
    waitUntil: "domcontentloaded",
  })
  // Landing on /login means the session was rejected — EXCEPT on the two pages
  // whose own route is public. `P.login` IS /login, and `P.shutdown` is the
  // wall the shutdown gate puts everyone behind; on those two a redirect to
  // the sign-in page is the page working, not auth failing. Keyed on the
  // manifest's own `route` rather than a list of ids, so a page that moves
  // takes its exemption with it.
  if (!entry.route.startsWith("/login") && !entry.route.startsWith("/shutdown")) {
    await expect(
      page,
      `${entry.protoId}: landed on the login page — the fidelity projects run on ` +
        `the same storageState as the rest of the suite, so this is an auth ` +
        `failure, not a fidelity finding`,
    ).not.toHaveURL(/\/login/)
  }

  // A page that was never served must not be reported as a design difference.
  // Without these two, a 500, a 404 or a guard redirect surfaces as "every
  // landmark missing" — red, but named as a fidelity finding, which would send
  // someone rebuilding a page that rendered fine and simply did not load.
  const status = response ? response.status() : 0
  expect(
    status,
    `${entry.protoId}: ${entry.route} answered ${status}. That is a page that ` +
      `did not load, not a page that does not match its design — nothing below ` +
      `this line would mean anything.`,
  ).toBeGreaterThanOrEqual(200)
  expect(
    status,
    `${entry.protoId}: ${entry.route} answered ${status}.`,
  ).toBeLessThan(300)

  const expected = expectedPath(entry, page)
  expect(
    new URL(page.url()).pathname,
    `${entry.protoId}: asked for ${entry.route} and landed on ` +
      `${new URL(page.url()).pathname}. A redirect is not a fidelity finding; ` +
      `fix the route or the manifest's mobileRoute before reading anything below.`,
  ).toBe(expected)
  // The content root, before anything else waits on the network. Measured: a
  // cold `npm run build && npm run start` never reaches networkidle on
  // /dashboard (TanStack Query keeps a request in flight), and waiting on it
  // first burned the whole test timeout and reported "our page has no content
  // root" about a page that had rendered the shell perfectly well. The dev
  // server did settle, so this only ever showed up in the production run the
  // protocol insists on.
  await page
    .locator(OUR_ROOT_SELECTOR)
    .first()
    .waitFor({ state: "attached", timeout: 15_000 })
  await expect(
    page.locator(OUR_ROOT_SELECTOR).first(),
    `${entry.protoId}: our page has no content root (${OUR_ROOT_SELECTOR})`,
  ).toHaveCount(1)
  // Then a best-effort settle, so sections that stream in are in the DOM
  // before they are counted. Bounded on purpose: a page that polls never goes
  // idle, and that is not a reason to fail it.
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {})

  // The theme actually engaged. CounterThemeProvider stamps data-theme for an
  // explicit choice; if this is ever absent, every colour below is the other
  // theme's and the whole pass is meaningless.
  await expect(
    page.locator("html"),
    `${entry.protoId}: asked for the ${theme} theme and the document is not in it`,
  ).toHaveAttribute("data-theme", theme)
}

/** Opens the prototype in its own tab, in the same browser context. */
async function protoPage(page: Page, protoId: string, surface: Surface) {
  const tab = await page.context().newPage()
  const root = await openPrototype(tab, protoId, surface)
  return { tab, root }
}

function describeDiff(d: Difference): string {
  const where = `#${d.order} .${d.classes.join(".")}`
  if (d.kind === "missing") return `MISSING  ${where}`
  if (d.kind === "extra") return `EXTRA    ${where}`
  return `STYLE    ${where}  ${d.property}: prototype ${JSON.stringify(
    d.prototype,
  )} / ours ${JSON.stringify(d.ours)}`
}

function writeData(
  testInfo: TestInfo,
  entry: FidelityPage,
  surface: Surface,
  payload: Record<string, unknown>,
): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const file = path.join(DATA_DIR, `${entry.protoId}.${testInfo.project.name}.json`)
  const existing = fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>)
    : {}
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        ...existing,
        protoId: entry.protoId,
        name: entry.name,
        status: entry.status,
        route: entry.route,
        protoRoute: entry.protoRoute,
        project: testInfo.project.name,
        surface,
        capturedAt: new Date().toISOString(),
        ...payload,
      },
      null,
      2,
    ),
  )
}

async function attachBoth(
  testInfo: TestInfo,
  protoRoot: Awaited<ReturnType<typeof protoPage>>["root"],
  ourPage: Page,
): Promise<void> {
  // A failure has to be inspectable without re-running the suite.
  await testInfo
    .attach("prototype.png", {
      body: await protoRoot.screenshot({ timeout: 15_000 }),
      contentType: "image/png",
    })
    .catch(() => {})
  await testInfo
    .attach("ours.png", {
      body: await ourPage.screenshot({ fullPage: true, timeout: 15_000 }),
      contentType: "image/png",
    })
    .catch(() => {})
}

/**
 * The headline both the failure message and the committed report lead with.
 * Sixteen elements against six is the sentence this whole project exists
 * because of; this is that sentence, computed.
 */
/**
 * The id this row substitutes into the prototype's own route.
 *
 * Read by DIFFERENCE rather than by pattern: `protoRoute` is the prototype's
 * address and `route` is ours, and on a detail page the only thing that
 * differs is the entity. `/dashboard/recipes/double-slider` against
 * `/dashboard/recipes/cmm48cpo6000voxu9lafghk62` yields the cuid, and no
 * regex has to know what a cuid, a uuid or a vendor name looks like — three
 * shapes this manifest already carries.
 *
 * Segment counts must match, which is what keeps `P.forbidden` ("403" against
 * "/dashboard/forbidden") from reporting a whole route as a fixture id.
 */
function fixtureIdOf(entry: FidelityPage): string {
  const proto = entry.protoRoute.split("/")
  const ours = entry.route.split("/")
  if (proto.length !== ours.length) return "none — the two routes are different shapes"
  const differing = ours.filter((seg, i) => seg !== proto[i])
  return differing.length === 0 ? "none — this route carries no fixture" : differing.join(", ")
}

/** "1440x900 (fidelity)", for a diagnostic that has to say which run this was. */
function viewportOf(page: Page, testInfo: TestInfo): string {
  const v = page.viewportSize()
  return `${v ? `${v.width}x${v.height}` : "unknown"} (${testInfo.project.name})`
}

/**
 * The precondition: a page wearing an empty state cannot be measured.
 *
 * `emptyStateDefect` explains what it looks for, and why it counts against
 * the prototype's own `.empty` rather than tripping on any at all. This is
 * the part that DECIDES, and it runs before `compareLandmarks` is ever
 * called — the point is that no landmark difference is computed, let alone
 * reported, about a page that did not load. It stands beside the redirect and
 * non-2xx checks in `openOurs` and replaces neither: those answer from the
 * RESPONSE, and a page that 200s on its own URL and then draws "nothing to
 * show" is invisible to both.
 *
 * It THROWS rather than asserting through `expect`. Everything expect() says
 * in this file is a claim about how a page compares to its design; this is a
 * claim that the comparison should not happen at all, and wearing the same
 * clothes as the findings is what made the 2026-09-20 run take a day to read.
 *
 * The measurement is still written and both screenshots still attach, so
 * `npm run fidelity:report` records WHY a page could not be measured rather
 * than silently keeping the last good report for it.
 */
async function assertMeasurable(args: {
  page: Page
  tab: Page
  root: Locator
  testInfo: TestInfo
  entry: FidelityPage
  surface: Surface
  proto: Landmark[]
  ours: Landmark[]
}): Promise<void> {
  const { page, tab, root, testInfo, entry, surface, proto, ours } = args
  const defect = emptyStateDefect(proto, ours)
  if (!defect) return

  const landed = new URL(page.url()).pathname
  const texts = defect.texts
    .map((t) => (t === "" ? "(no text at all)" : JSON.stringify(t)))
    .join("; ")
  const diagnostic =
    `Fidelity precondition failed: page rendered an empty state\n\n` +
    `  page          ${entry.protoId} (${surface})\n` +
    `  route         ${entry.route}${entry.query ?? ""}\n` +
    `  viewport      ${viewportOf(page, testInfo)}\n` +
    `  landed path   ${landed}\n` +
    `  fixture id    ${fixtureIdOf(entry)}\n` +
    `  empty state   ${texts}\n\n` +
    `The design draws ${defect.protoCount} \`.empty\` here and we draw ` +
    `${defect.ourCount}. A section renders one when its data came back empty ` +
    `or errored, so this page did not fail to MATCH its design — it failed ` +
    `to load, and every landmark a comparison reported would be an artefact ` +
    `of that. Nothing below this line ran.\n\n` +
    `Fix the DATA, not the page. If the fixture id above names a row, check ` +
    `that it still exists for this account; if it names none, this page's ` +
    `own loaders are failing. Landmark budgets are not the answer here and ` +
    `must not be touched to make this green.`

  writeData(testInfo, entry, surface, {
    gated: true,
    proto: { count: proto.length, tally: landmarkTally(proto) },
    ours: { count: ours.length, tally: landmarkTally(ours) },
    precondition: {
      kind: "empty-state",
      protoCount: defect.protoCount,
      ourCount: defect.ourCount,
      texts: defect.texts,
      route: `${entry.route}${entry.query ?? ""}`,
      viewport: viewportOf(page, testInfo),
      landed,
      fixtureId: fixtureIdOf(entry),
    },
  })
  await attachBoth(testInfo, root, page)
  await tab.close()
  throw new Error(diagnostic)
}

function headline(entry: FidelityPage, surface: Surface, proto: Landmark[], ours: Landmark[]): string {
  return (
    `${entry.protoId} (${surface}): the prototype renders ${proto.length} ` +
    `landmarks here; we render ${ours.length}.`
  )
}

for (const entry of PAGES) {
  const gated = entry.status === "counter"

  if (!gated && !entry.report) {
    test.skip(`${entry.protoId}: editorial — not rebuilt yet`, () => {})
    continue
  }

  if (!gated && entry.report) {
    /**
     * The "before". Captured and committed, never gated — Overview is not
     * rebuilt, and marking it "counter" to force this run would make
     * `npm run fidelity` red from its first commit. A permanently red gate is
     * exactly as ignorable as the permanently green one that let the gap open.
     *
     * It still asserts one thing, and it is the thing that keeps this test
     * honest: the PROTOTYPE side must have landmarks. If the harness ever
     * stops finding them, this goes red rather than quietly reporting that a
     * blank page matches a blank page.
     */
    test(`${entry.protoId}: baseline report (editorial — captured, not gated)`, async ({
      page,
    }, testInfo) => {
      const surface = surfaceOf(testInfo)
      const { tab, root } = await protoPage(page, entry.protoId, surface)
      const proto = await extractProto(tab, surface, entry)
      expect(
        proto.length,
        `the prototype's own ${surface} render of "${entry.protoId}" has no ` +
          `landmarks. That is a broken harness, not a clean page — check ` +
          `LANDMARK_CLASSES and the surface roots before believing any report.`,
      ).toBeGreaterThan(0)

      await openOurs(page, entry, "light")
      const ours = await extractOurs(page)

      // No guard around this call. If both sides ever come back empty it
      // throws, and that is the point — see landmarks.ts.
      const differences = compareLandmarks(proto, ours)
      writeData(testInfo, entry, surface, {
        gated: false,
        proto: { count: proto.length, tally: landmarkTally(proto) },
        ours: { count: ours.length, tally: landmarkTally(ours) },
        differences: differences.slice(0, 500),
        differencesTruncated: Math.max(0, differences.length - 500),
      })
      await attachBoth(testInfo, root, page)
      await tab.close()

      // The run IS the progress board. (No ESLint in this repo; no directive needed.)
      console.log(`  ${headline(entry, surface, proto, ours)}`)
    })
    continue
  }

  test(`${entry.protoId}: structure matches the prototype`, async ({ page }, testInfo) => {
    const surface = surfaceOf(testInfo)
    const { tab, root } = await protoPage(page, entry.protoId, surface)
    const proto = await extractProto(tab, surface, entry)
    expect(
      proto.length,
      `the prototype's own ${surface} render of "${entry.protoId}" has no landmarks — broken harness`,
    ).toBeGreaterThan(0)

    await openOurs(page, entry, "light")
    const ours = await extractOurs(page)

    // BEFORE the comparison, deliberately. A page wearing an empty state is
    // not a page that differs from its design, and the difference list below
    // would describe the empty state rather than the page.
    await assertMeasurable({ page, tab, root, testInfo, entry, surface, proto, ours })

    const differences = compareLandmarks(proto, ours)
    const structural = differences.filter((d) => d.kind !== "style")

    writeData(testInfo, entry, surface, {
      gated: true,
      // Explicitly cleared, because `writeData` merges onto whatever the last
      // run left in this file. Without it, a page that drew an empty state on
      // Monday would still be reported as unmeasurable on Tuesday after the
      // fixture was fixed — the report would keep saying the page never
      // loaded while the run beside it went green.
      precondition: null,
      proto: { count: proto.length, tally: landmarkTally(proto) },
      ours: { count: ours.length, tally: landmarkTally(ours) },
      differences: differences.slice(0, 500),
      differencesTruncated: Math.max(0, differences.length - 500),
    })
    await attachBoth(testInfo, root, page)
    await tab.close()

    // Landmarks this page cannot render because the database publishes nothing
    // for them are forgiven BY COUNT, from the manifest's own written list —
    // and only those. An extra is never forgiven, a missing landmark with no
    // entry is never forgiven, and an entry that forgives fewer than it
    // budgets for fails as stale. See `applyAbsenceAllowances`.
    const absences = applyAbsenceAllowances(structural, absenceBudget(entry, surface))
    // ...and then the surplus, from a SEPARATE list. Neither forgives the
    // other's kind: an absence line cannot swallow an extra (ruling F-R8) and
    // an extra line cannot hide a gap. See `applyExtraAllowances`.
    const surplus = applyExtraAllowances(absences.unexplained, extraBudget(entry, surface))
    const unexplained = surplus.unexplained
    const stale = [...absences.stale, ...surplus.stale]

    expect(unexplained.map(describeDiff), headline(entry, surface, proto, ours)).toEqual([])

    expect(
      stale.map(
        (s) =>
          `STALE    ${s.landmark}: the manifest allows ${s.budgeted}, ` +
          `only ${s.used} occurred`,
      ),
      `${entry.protoId} (${surface}): a declared allowance forgave fewer ` +
        `landmarks than it budgets for. Either something now publishes what ` +
        `that landmark is judged against, so it LANDS, or the surplus it ` +
        `named has stopped occurring — delete the line rather than leave it ` +
        `absorbing a future regression.`,
    ).toEqual([])

    if (entry.baseline) {
      const floor = surface === "desk" ? entry.baseline.desktop : entry.baseline.mobile
      expect(
        ours.length,
        `${entry.protoId} rendered ${ours.length} landmarks; it rendered ${floor} ` +
          `on the day it passed. Fewer is a silent regression.`,
      ).toBeGreaterThanOrEqual(floor)
    }
  })

  test(`${entry.protoId}: rendering matches the prototype`, async ({ page }, testInfo) => {
    const surface = surfaceOf(testInfo)
    const { tab, root } = await protoPage(page, entry.protoId, surface)
    const proto = await extractProto(tab, surface, entry)

    await openOurs(page, entry, "light")
    const ours = await extractOurs(page)

    // As in the structure pass, and for the same reason: the properties of an
    // empty state are not this page's rendering.
    await assertMeasurable({ page, tab, root, testInfo, entry, surface, proto, ours })

    const styleDiffs = compareLandmarks(proto, ours).filter((d) => d.kind === "style")
    const matched = matchedCount(proto, ours)
    await attachBoth(testInfo, root, page)
    await tab.close()

    // This pass only looks at landmarks present on BOTH sides, so a page we
    // have not built compares nothing and reports nothing. Without this line
    // it goes green over a blank screen — which it did, once, on the first
    // end-to-end run of this suite.
    expect(
      matched,
      `${entry.protoId} (${surface}, light): the rendering pass compared ` +
        `nothing. ${proto.length} landmarks in the prototype, ${ours.length} ` +
        `in ours, ${matched} in common — there is no rendering here to be ` +
        `right or wrong about, and reporting "no differences" would be a lie.`,
    ).toBeGreaterThan(0)

    // Properties a landmark cannot match BECAUSE of an absence the manifest
    // has already declared — a strip that honestly renders three cells where
    // the design draws four reports `data-n` and its track count, and neither
    // is a defect. Forgiven by an exact count on an exact (landmark, property)
    // pair, from the manifest's own written list, and only those: a `missing`
    // or an `extra` is never forgiven here, a property with no entry is never
    // forgiven, and an entry that forgives fewer than it budgets for fails as
    // stale. See `applyStyleAllowances`.
    const { unexplained, stale } = applyStyleAllowances(
      styleDiffs,
      styleBudget(entry, surface),
    )

    expect(
      unexplained.map(describeDiff),
      `${entry.protoId} (${surface}, light): ${unexplained.length} rendering ` +
        `differences on landmarks that exist on both sides. Structure is a ` +
        `separate pass — if that one is also red, fix it first; most of these ` +
        `are usually downstream of one missing wrapper.`,
    ).toEqual([])

    expect(
      stale.map(
        (s) =>
          `STALE    .${s.landmark} ${s.property}: the manifest forgives ` +
          `${s.budgeted} on this property, only ${s.used} reported`,
      ),
      `${entry.protoId} (${surface}, light): a style allowance forgave fewer ` +
        `differences than it budgets for. The landmark now renders this ` +
        `property the way the prototype does, so whatever the page could not ` +
        `compute it can compute — delete the line rather than leave it ` +
        `absorbing a future regression on the same property.`,
    ).toEqual([])
  })

  test(`${entry.protoId}: dark mode is themed, not merely different`, async ({
    page,
  }, testInfo) => {
    const surface = surfaceOf(testInfo)
    await openOurs(page, entry, "dark")

    const themed = await page.evaluate(extractThemedInPage, {
      rootSelectors: [...OUR_ROOT],
      landmarkClasses: [...LANDMARK_CLASSES],
    })

    // The node sweep walks the WHOLE root now, so it finds hundreds of
    // elements on any page at all and can no longer stand in for "this page
    // rendered something Counter". That has to be asserted separately, or a
    // page with no Counter markup would be checked for colour literals and
    // called themed.
    expect(
      themed.landmarkCount,
      `${entry.protoId} (${surface}, dark): the page has no Counter landmarks ` +
        `at all, so there is nothing here that dark mode can be right about. ` +
        `This is a page that was not built, not a page that is themed.`,
    ).toBeGreaterThan(0)

    await testInfo
      .attach("ours-dark.png", {
        body: await page.screenshot({ fullPage: true, timeout: 15_000 }),
        contentType: "image/png",
      })
      .catch(() => {})

    const defects = findThemeDefects(themed.nodes, themed.tokenValues)
    writeData(testInfo, entry, surface, {
      dark: {
        landmarks: themed.landmarkCount,
        nodes: themed.nodes.length,
        elements: themed.elementCount,
        painting: themed.paintingCount,
        tokens: themed.tokenNames.length,
        defects: defects.slice(0, 200),
      },
    })

    const literals = defects.filter((d) => d.kind === "literal")
    const contrast = defects.filter((d) => d.kind === "contrast")

    expect(
      literals.map((d) => `LITERAL  #${d.order} ${defectWhere(d)}  ${d.property}: ${d.value}`),
      `${entry.protoId} (${surface}, dark): colours that do not come from a ` +
        `--ct-* token. They will not move when the theme does. Fix them in the ` +
        `task that emits their class — see the addendum, "inherited literals ` +
        `are fixed by the task that first emits their class".`,
    ).toEqual([])

    expect(
      contrast.map((d) => `CONTRAST #${d.order} ${defectWhere(d)}  ${d.detail}`),
      `${entry.protoId} (${surface}, dark): text that does not keep its ` +
        `contrast against the surface it sits on. This is the .qbtn defect ` +
        `class — a token that themes to near-white behind ink that does not.`,
    ).toEqual([])
  })
}
