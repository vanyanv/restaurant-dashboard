"use client"

/**
 * `.seg` as page chrome — `viewTabs()`, prototype line 8199.
 *
 * The prototype composes a group of related pages into ONE page with a
 * segmented control: `VIEWS[id]` lists the siblings, `viewTabs()` draws them
 * into `.phactions` beside the date control, and clicking one re-renders the
 * screen. It has one document and no router, so its tabs are
 * `<button data-view>`.
 *
 * Ours are real routes, so they are LINKS. A monitoring tab you cannot
 * middle-click, open in a second tab or bookmark is not a monitoring tab —
 * this is the developer-facing cluster, where two tabs open at once is the
 * normal way to read it. `Rail` made the same call for the same reason (see
 * its note on "a destination that is a real href").
 *
 * The pressed state is `aria-current="page"`, which is what a link that IS the
 * page you are on says; `.seg button[aria-pressed]`'s twin rule for `a` lives
 * in `counter-repairs.css`.
 *
 * `.seg` is NOT a fidelity landmark, so this is invisible to the structure
 * pass on both sides — it is judged by the dark sweep like any other chrome,
 * and it inherits the tokens `.seg` already resolves on `/dashboard/alerts`.
 */
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { SubNavItem } from "@/lib/counter/nav"

export function SubNav({ items, label }: { items: readonly SubNavItem[]; label: string }) {
  const pathname = usePathname()
  return (
    <nav className="seg" aria-label={label}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          // EXACT on the PATH, unlike `isActive`. These are siblings under one
          // prefix, and the first of them is that prefix: a `startsWith` match
          // would light Bridge on all eight.
          //
          // The query is split off because the store-view bars carry one —
          // "All stores" and "One store" both have to keep the range they are
          // read in, and comparing a pathname to an href with `?range=d30` on
          // the end would never match, so no tab would ever look pressed.
          aria-current={pathname === item.href.split("?")[0] ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
