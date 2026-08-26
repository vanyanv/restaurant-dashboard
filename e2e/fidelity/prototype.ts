/**
 * Driving the vendored prototype.
 *
 * `docs/counter/counter-prototype.html` is one self-contained file: 53 page
 * modules on a `P` object, its own router, and a documentation shell around a
 * stage. It renders BOTH surfaces at once — `show(id)` writes `deskFor(id)`
 * into `#deskHost` and `phoneFor(id)` into `#phoneHost` in the same call — so
 * there is no surface control to press and no surface switch to assert. The
 * brief expected one; there is not one, and that is better: the desk and the
 * phone are always the same page.
 *
 * `show()` is closed over by the file's IIFE and is NOT on `window`, so
 * navigation is driven the way a person would: through the page index
 * (`.pchip[data-goto]`), or through the hash, both of which the file's own
 * listeners route into `show()`.
 *
 * WHY THE ASSERTION MATTERS. `show()` returns early when the id it is given is
 * the one already rendered. A navigation that silently no-ops leaves the
 * PREVIOUS page in `#deskHost`, and every comparison after the first would
 * then be run against the wrong page and reported with complete confidence.
 * So `openPrototype` confirms three independent things before it hands back a
 * locator:
 *
 *   1. `#stageRoute` reads the route the manifest says this page has. That
 *      element is written only inside `show()`, from the page module's own
 *      `route` field.
 *   2. the page index has this id's chip pressed — also written only in
 *      `show()`, and from a different variable.
 *   3. the surface root exists and has rendered content in it.
 */
import path from "node:path"
import { expect, type Locator, type Page } from "@playwright/test"
import { pageById } from "./manifest"

export type Surface = "desk" | "phone"

export const PROTOTYPE_FILE = path.resolve(
  __dirname,
  "../../docs/counter/counter-prototype.html",
)
export const PROTOTYPE_URL = `file://${PROTOTYPE_FILE}`

/**
 * The extraction root for each surface: the page's own content, without the
 * documentation shell and without the app chrome the prototype composes around
 * it (the nav rail, the topbar, the command palette, the phone's tab bar).
 * Those are not what a page IS, and none of them carries a landmark class.
 */
export const SURFACE_ROOT: Record<Surface, string> = {
  desk: "#deskHost .frame .screen",
  phone: "#phoneHost .pframe .mscroll",
}

/** Opens the vendored prototype and navigates to one page module. */
export async function openPrototype(
  page: Page,
  pageId: string,
  surface: Surface = "desk",
): Promise<Locator> {
  const entry = pageById(pageId)

  const onFile = page.url().startsWith("file://")
  if (!onFile) {
    await page.goto(`${PROTOTYPE_URL}#${pageId}`, { waitUntil: "load" })
  } else {
    // Already here: press the page's own chip, the way the index does.
    await page.locator(`.pchip[data-goto="${pageId}"]`).click()
  }

  // 1. the stage says which page is rendered, and it is only ever written by show()
  await expect(
    page.locator("#stageRoute"),
    `prototype navigation to "${pageId}" did not happen — the stage still ` +
      `names another page, so every comparison after this one would have been ` +
      `run against the wrong render`,
  ).toHaveText(entry.protoRoute)

  // 2. a second, independently written confirmation of the same fact
  await expect(
    page.locator(`.pchip[data-goto="${pageId}"]`),
    `the page index does not have "${pageId}" pressed`,
  ).toHaveAttribute("aria-pressed", "true")

  // The prototype renders inside its own documentation shell, which caps
  // `.wrap` at 1340px and narrows `#deskHost` further — measured at **932px**
  // while our `.ct-root` is the full 1440px viewport.
  //
  // That is not a design difference, it is the docs page's furniture. But
  // `container-name: fr` sits on `.frame` and `container-type: inline-size`
  // on our `.ct-root`, so every `@container fr` rule in the ported sheet
  // resolves against a DIFFERENT width on each side. The strip reflows 6->3
  // at 1180: at 932 the prototype is always in the 3-track band while we are
  // in the 6-track one, and the gate reports a rendering difference for a
  // rule that is behaving correctly on both sides. Seven of Overview's eleven
  // differences were exactly this.
  //
  // So the frame is widened to the viewport before anything is measured. The
  // design is `inline-size`-driven, which means it is defined AT ANY WIDTH —
  // comparing at the width our app actually renders is the honest comparison,
  // and shrinking OUR page to 932 to match a documentation wrapper would be
  // testing the wrapper.
  await page.addStyleTag({
    content: `
      .wrap { max-width: none !important; padding: 0 !important; }
      #deskHost, #deskHost > * { max-width: none !important; width: 100% !important; }
      #deskHost .frame { width: 100vw !important; max-width: none !important; }
    `,
  })

  // 3. the surface actually rendered something
  const root = page.locator(SURFACE_ROOT[surface])
  await expect(
    root,
    `the prototype's ${surface} surface is missing for "${pageId}"`,
  ).toHaveCount(1)
  await expect(
    root,
    `the prototype's ${surface} surface rendered empty for "${pageId}"`,
  ).not.toBeEmpty()

  // The prototype mounts its charts and animates its figures inside show();
  // reducedMotion:"reduce" (set on both fidelity projects) makes the figure
  // tick a no-op, so the text is final the moment the frame is in the DOM.
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel)
      if (!el) return false
      const charts = el.querySelectorAll(".ch")
      for (let i = 0; i < charts.length; i++) {
        if (!(charts[i] as HTMLElement).dataset.done) return false
      }
      return true
    },
    SURFACE_ROOT[surface],
    { timeout: 10_000 },
  )

  return root
}
