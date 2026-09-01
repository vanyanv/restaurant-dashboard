import { test, expect } from "@playwright/test"
import { PAGES } from "../fidelity/manifest"

/**
 * Four defects that are objectively true or false, swept over every gated
 * route.
 *
 * NOT AN AUDIT, and deliberately not axe. A full ruleset on fifty pages
 * produces a list nobody reads and a dependency nobody asked for; these four
 * are the ones where a machine can say "this is wrong" without a judgement
 * call, and where the fix is unambiguous:
 *
 *   1. A control with no accessible name. An icon-only button announces as
 *      "button" and nothing else — the reader is told there is something to
 *      press and never what it does.
 *   2. An `<img>` with no `alt` attribute at all. (`alt=""` is correct and is
 *      NOT a finding: it is the way to say "decorative".)
 *   3. An input with no label, no `aria-label` and no `aria-labelledby`.
 *   4. A duplicated `id`. `aria-labelledby`, `aria-describedby` and
 *      `<label for>` all resolve to the FIRST match, so a duplicate silently
 *      points half the page at the wrong element — and `Section` builds a
 *      `headingId` per section, so a collision here is a real risk rather
 *      than a theoretical one.
 *
 * A control inside `[hidden]` or `[aria-hidden]` is skipped: it is not in the
 * tree a reader walks.
 */
const ENTRIES = PAGES.filter((p) => p.status === "counter")

test("no unnamed controls, unlabelled inputs, alt-less images or duplicate ids (phone)", async ({
  page,
}) => {
  test.setTimeout(900_000)
  const findings: string[] = []

  for (const entry of ENTRIES) {
    const route =
      (entry.mobileRoute ?? entry.route) + (entry.query ?? "")
    await page.goto(route, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(700)

    const found = await page.evaluate((bare: boolean) => {
      const out: string[] = []
      // A floor per page, as on the desk. The phone shell is leaner — a
      // masthead and a five-tab bar rather than a rail — so the number is
      // lower, but a page with nothing to check is still a page that did not
      // paint.
      //
      // A `bare` page is exempt and has to be: `P.login`, `P.signup` and
      // `P.shutdown` render with no chrome at all, and the phone shutdown
      // notice is one sentence and one button by design.
      if (!bare && document.querySelectorAll("button, a[href], input, select").length < 5) {
        out.push("EMPTY PAGE — fewer than five controls; nothing was checked")
      }
      const hidden = (el: Element) => el.closest("[hidden], [aria-hidden='true']") !== null
      const named = (el: Element) =>
        (el.textContent ?? "").trim().length > 0 ||
        (el.getAttribute("aria-label") ?? "").trim().length > 0 ||
        el.hasAttribute("aria-labelledby") ||
        (el.getAttribute("title") ?? "").trim().length > 0

      for (const el of document.querySelectorAll("button, a[href], [role='button'], [role='link']")) {
        if (hidden(el) || named(el)) continue
        out.push(`UNNAMED ${el.tagName.toLowerCase()}.${el.className || "(no class)"}`)
      }
      for (const el of document.querySelectorAll("img")) {
        if (hidden(el) || el.hasAttribute("alt")) continue
        out.push(`NO ALT img[src=${(el.getAttribute("src") ?? "").slice(0, 60)}]`)
      }
      for (const el of document.querySelectorAll("input, select, textarea")) {
        if (hidden(el)) continue
        const t = el.getAttribute("type")
        if (t === "hidden" || t === "submit" || t === "button") continue
        if (
          (el.getAttribute("aria-label") ?? "").trim().length > 0 ||
          el.hasAttribute("aria-labelledby") ||
          (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
          el.closest("label")
        )
          continue
        out.push(`UNLABELLED ${el.tagName.toLowerCase()}#${el.id || "(no id)"}`)
      }
      const seen = new Set<string>()
      for (const el of document.querySelectorAll("[id]")) {
        const id = el.id
        if (seen.has(id)) out.push(`DUPLICATE id="${id}"`)
        seen.add(id)
      }
      return out
    }, Boolean(entry.bare))

    for (const f of found) findings.push(`${route} :: ${f}`)
  }

  expect(findings).toEqual([])
})
