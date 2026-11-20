/**
 * Page layout rules (DESIGN.md "Page layout"), as a build failure.
 *
 * Why this exists: on 2026-11-20 the Labor rebuild (PR #228) shipped as one
 * long scroll on desk and phone, and an audit found the same shape on ~40
 * other pages. Every "Made Plain" rebuild had kept the whole old page inside
 * one "Every figure, as before" fold, so opening it gave the long scroll back,
 * and pages without a plain top stacked 6 to 9 sections with no tabs. The
 * rules lived in prose and project notes; nothing failed. Now something does.
 *
 * Two rules, over every `.tsx` under the two `(counter)` route groups except
 * `page.tsx`/`layout.tsx`/`loading.tsx`/`error.tsx` (those render no sections):
 *
 *   - `page-too-long` — a file that renders more than MAX_OPEN_BLOCKS
 *     `<Section>`/`<Card>` blocks outside any `<Fold>` and has no shared
 *     `<Tabs>`. Past the answer and a few blocks, a page splits into tabs.
 *   - `fold-holds-a-page` — a `<Fold>` that wraps more than MAX_FOLD_BLOCKS
 *     `<Section>`/`<Card>` blocks. A fold holds ONE thing (the method, the
 *     full statement), never the rest of the page.
 *
 * Regex over comment-stripped source, not an AST, like the rest of
 * `npm run tokens`. Known holes, written down so nobody mistakes them for
 * coverage: a block rendered by a child component in another file is counted
 * in THAT file, not the page (so a page can hide length by splitting files —
 * the written rule still applies); a `.map()` that renders N sections counts
 * as one; a file with any `<Tabs>` is trusted to have put its blocks under
 * them. Uncapped lists ("Show all") are a written rule only — no regex for
 * them was reliable enough to fail a build on.
 *
 * KNOWN is a ratchet, the same idea as `lint:hooks --max-warnings`: the files
 * that broke these rules when they were introduced, each to be fixed with its
 * area's Made Plain rebuild. A listed file that no longer breaks the rule is
 * itself a violation (`page-layout-known-stale`) until its entry is deleted,
 * so the list can only shrink. Never add to it — fix the page instead.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

export const MAX_OPEN_BLOCKS = 5
export const MAX_FOLD_BLOCKS = 2

export interface LayoutViolation {
  file: string
  line: number
  rule: string
  text: string
}

const BLOCK = /<(Section|Card)\b/g
const FOLD_OPEN = /<Fold\b/
const FOLD_CLOSE = /<\/Fold>/
const TABS = /<(Page)?Tabs\b/
const SKIP_FILE = /[/\\](page|layout|loading|error|not-found)\.tsx$/

/** Same contract as counter-lint's: comments become spaces, newlines stay. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length))
}

/**
 * Counts blocks open vs inside folds, and each fold's own block count.
 * Exported for the test.
 */
export function measureLayout(source: string): {
  openBlocks: number
  hasTabs: boolean
  firstBlockLine: number
  folds: Array<{ line: number; blocks: number }>
} {
  const lines = stripComments(source).split("\n")
  let depth = 0
  let openBlocks = 0
  let firstBlockLine = 0
  const folds: Array<{ line: number; blocks: number }> = []
  const stack: Array<{ line: number; blocks: number }> = []
  lines.forEach((text, i) => {
    // Order matters on one line: `<Fold summary="x"><Section …` opens first.
    if (FOLD_OPEN.test(text)) {
      depth++
      stack.push({ line: i + 1, blocks: 0 })
    }
    const n = text.match(BLOCK)?.length ?? 0
    if (n > 0) {
      if (depth > 0) {
        for (const f of stack) f.blocks += n
      } else {
        openBlocks += n
        if (!firstBlockLine) firstBlockLine = i + 1
      }
    }
    if (FOLD_CLOSE.test(text) && depth > 0) {
      depth--
      folds.push(stack.pop()!)
    }
  })
  return { openBlocks, hasTabs: lines.some((l) => TABS.test(l)), firstBlockLine, folds }
}

export function checkSource(file: string, source: string): LayoutViolation[] {
  const out: LayoutViolation[] = []
  const m = measureLayout(source)
  if (!m.hasTabs && m.openBlocks > MAX_OPEN_BLOCKS) {
    out.push({
      file,
      line: m.firstBlockLine,
      rule: "page-too-long",
      text: `${m.openBlocks} sections stacked with no <Tabs> (max ${MAX_OPEN_BLOCKS}). Split into tabs — DESIGN.md "Page layout".`,
    })
  }
  for (const f of m.folds) {
    if (f.blocks > MAX_FOLD_BLOCKS) {
      out.push({
        file,
        line: f.line,
        rule: "fold-holds-a-page",
        text: `<Fold> wraps ${f.blocks} sections (max ${MAX_FOLD_BLOCKS}). Give them tabs; a fold holds one thing — DESIGN.md "Page layout".`,
      })
    }
  }
  return out
}

/**
 * Files that broke the rules on 2026-11-20 (main dbf6e48), repo-relative.
 * Fix each with its area's rebuild, then DELETE its line. Never add one.
 */
export const KNOWN: string[] = [
  "src/app/(mobile)/m/(counter)/analytics/[storeId]/counter-phone-store-analytics-client.tsx",
  "src/app/(mobile)/m/(counter)/analytics/counter-phone-analytics-client.tsx",
  "src/app/(mobile)/m/(counter)/cogs/counter-phone-cogs-client.tsx",
  "src/app/(mobile)/m/(counter)/labor/[storeId]/counter-phone-store-labor-client.tsx",
  "src/app/(mobile)/m/(counter)/labor/counter-phone-labor-client.tsx",
  "src/app/(mobile)/m/(counter)/menu-profit/counter-phone-menu-profit-client.tsx",
  "src/app/(mobile)/m/(counter)/menu/catalog/counter-phone-catalog-client.tsx",
  "src/app/(mobile)/m/(counter)/orders/[id]/counter-phone-order-client.tsx",
  "src/app/(mobile)/m/(counter)/recipes/[id]/counter-phone-recipe-client.tsx",
  "src/app/(mobile)/m/(counter)/recipes/counter-phone-recipes-client.tsx",
  "src/app/dashboard/(counter)/admin/monitoring/activity/counter-activity-client.tsx",
  "src/app/dashboard/(counter)/alerts/counter-alerts-client.tsx",
  "src/app/dashboard/(counter)/analytics/[storeId]/counter-store-analytics-client.tsx",
  "src/app/dashboard/(counter)/analytics/counter-analytics-client.tsx",
  "src/app/dashboard/(counter)/cogs/[storeId]/counter-store-cogs-client.tsx",
  "src/app/dashboard/(counter)/cogs/counter-cogs-client.tsx",
  "src/app/dashboard/(counter)/ingredients/[id]/counter-ingredient-client.tsx",
  "src/app/dashboard/(counter)/ingredients/counter-ingredients-client.tsx",
  "src/app/dashboard/(counter)/invoices/[id]/counter-invoice-client.tsx",
  "src/app/dashboard/(counter)/invoices/counter-invoices-client.tsx",
  "src/app/dashboard/(counter)/labor/[storeId]/counter-store-labor-client.tsx",
  "src/app/dashboard/(counter)/labor/counter-labor-client.tsx",
  "src/app/dashboard/(counter)/menu-profit/counter-menu-profit-client.tsx",
  "src/app/dashboard/(counter)/menu/catalog/[item]/counter-menu-item-client.tsx",
  "src/app/dashboard/(counter)/menu/catalog/counter-catalog-client.tsx",
  "src/app/dashboard/(counter)/menu/counter-menu-client.tsx",
  "src/app/dashboard/(counter)/operations/inventory/counter-inventory-client.tsx",
  "src/app/dashboard/(counter)/orders/[id]/counter-order-client.tsx",
  "src/app/dashboard/(counter)/orders/counter-orders-client.tsx",
  "src/app/dashboard/(counter)/product-mix/counter-product-mix-client.tsx",
  "src/app/dashboard/(counter)/recipes/[id]/counter-recipe-client.tsx",
  "src/app/dashboard/(counter)/recipes/counter-recipes-client.tsx",
  "src/app/dashboard/(counter)/settings/counter-settings-client.tsx",
  "src/app/dashboard/(counter)/stores/[id]/counter-store-file-client.tsx",
]

function walk(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries.flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

export function findPageLayoutViolations(
  routeGroupRoots: string[],
  known: string[] = KNOWN,
): LayoutViolation[] {
  const out: LayoutViolation[] = []
  const seen = new Set<string>()
  for (const root of routeGroupRoots) {
    for (const abs of walk(root)) {
      if (!abs.endsWith(".tsx") || SKIP_FILE.test(abs)) continue
      const file = relative(process.cwd(), abs).split(sep).join("/")
      const found = checkSource(file, readFileSync(abs, "utf8"))
      if (known.includes(file)) {
        seen.add(file)
        if (found.length === 0) {
          out.push({
            file,
            line: 1,
            rule: "page-layout-known-stale",
            text: "This file now follows the page layout rules. Delete its line from KNOWN in scripts/page-layout-lint.ts.",
          })
        }
        continue
      }
      out.push(...found)
    }
  }
  // A listed file that was deleted or moved is stale too.
  const rootsRel = routeGroupRoots.map((r) => relative(process.cwd(), r).split(sep).join("/") + "/")
  for (const file of known) {
    if (seen.has(file) || !rootsRel.some((r) => file.startsWith(r))) continue
    out.push({
      file,
      line: 1,
      rule: "page-layout-known-stale",
      text: "Listed in KNOWN but no longer exists. Delete its line from KNOWN in scripts/page-layout-lint.ts.",
    })
  }
  return out
}
