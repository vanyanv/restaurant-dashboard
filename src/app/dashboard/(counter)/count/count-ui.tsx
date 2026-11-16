"use client"

import { useEffect, useRef, type ReactNode } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { PageHead, Section, SubNav, useSurfaceHref } from "@/components/counter"
import { COUNT_TABS } from "@/lib/counter/nav"
import { ALL_STORES } from "@/lib/counter/shelf-state"
import type { SectionSource } from "@/lib/counter/section-data"
import type { SwitcherData } from "@/lib/counter/adapters/inventory-shelf"

/** Pieces shared by the Inventory tabs, desk and phone. */

export function CountHead({
  sub,
  switcher,
  allView = false,
  children,
}: {
  sub: string
  /**
   * The store switcher's figures, on a tab that loads them apart from its own
   * data (Order, Waste, Report). The Overview, the Shelf tab and the one-item
   * page draw the switcher themselves, from the shelves they already hold.
   */
  switcher?: SectionSource<SwitcherData | null>
  /** The tab can show every store at once (Waste, Report), so "All" stays on it. */
  allView?: boolean
  children?: ReactNode
}) {
  const href = useSurfaceHref()
  // The picked store rides along between tabs; without it the next tab falls
  // back to the first store, and waste gets logged against the wrong one.
  const store = useSearchParams().get("store")
  const q = store ? `?${new URLSearchParams({ store })}` : ""
  return (
    <>
      <PageHead title="Inventory" sub={sub}>
        <SubNav items={COUNT_TABS.map((t) => ({ ...t, href: href(t.href + q) }))} label="Inventory sections" />
        {children}
      </PageHead>
      {switcher !== undefined && (
        // No panel when it is empty or failed: the switcher is a way around,
        // and every tab under it still says which store it is showing.
        <Section bare title="Stores" data={switcher} quietWhenEmpty quietWhenFailed>
          {(d) => (d ? <StoreSwitch data={d} allView={allView} /> : null)}
        </Section>
      )}
    </>
  )
}

/**
 * The store switcher: every store with its own "N to order" (or "not
 * counted"), and all of them added up. Links, so the picked store is in the
 * URL and rides between the tabs. `allView` is true where the page can show
 * every store at once (all but Order, which drafts one store); there "All"
 * stays on the page, and on Order it opens the Overview.
 */
export function StoreSwitch({ data, allView = false }: { data: SwitcherData; allView?: boolean }) {
  const pathname = usePathname() ?? ""
  const params = useSearchParams()
  const href = useSurfaceHref()
  // On a phone the switcher sticks under the shell's top bar, whose height is
  // the shell's to decide: read it rather than restate it.
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    const top = document.querySelector<HTMLElement>(".ct-phone > .mtop")
    if (!el || !top) return
    const set = () => el.style.setProperty("--iv-top", `${top.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(top)
    return () => ro.disconnect()
  }, [data.stores.length])
  if (data.stores.length < 2) return null
  const asked = params.get("store")
  const current = data.stores.some((s) => s.id === asked) ? asked : allView ? ALL_STORES : data.stores[0].id
  const to = (id: string) => {
    const q = new URLSearchParams({ store: id })
    // Order's "how long should it last" is the reader's pick, not the store's.
    const cover = params.get("cover")
    if (cover) q.set("cover", cover)
    // Logging waste: switching store keeps the form open, for the new store.
    if (params.get("log") === "1") q.set("log", "1")
    return `${pathname}?${q}`
  }
  const say = (n: number | null) =>
    n === null ? <span>not counted</span> : <span><strong>{n}</strong> to order</span>
  return (
    <nav className="iv-sw" aria-label="Store" ref={ref}>
      <Link
        className="iv-sw__c"
        href={allView ? pathname : href("/dashboard/count")}
        aria-current={current === ALL_STORES ? "true" : undefined}
      >
        <b>All {data.stores.length}</b>
        {say(data.total)}
      </Link>
      {data.stores.map((s) => (
        <Link key={s.id} className="iv-sw__c" href={to(s.id)} aria-current={current === s.id ? "true" : undefined}>
          <b>{s.name}</b>
          {say(s.toOrder)}
        </Link>
      ))}
    </nav>
  )
}

export function money(n: number): string {
  const neg = n < 0
  const s = Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return neg ? `−${s}` : s
}

export type Outcome = { ok: boolean; text: string } | null

export function OutcomeLine({ outcome }: { outcome: Outcome }) {
  return (
    <span className={`cw__msg ${outcome ? (outcome.ok ? "cw__msg--ok" : "cw__msg--bad") : ""}`} role="status">
      {outcome?.text ?? ""}
    </span>
  )
}
