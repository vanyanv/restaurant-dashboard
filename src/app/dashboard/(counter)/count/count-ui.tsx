"use client"

import type { ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { PageHead, SubNav, useSurfaceHref } from "@/components/counter"
import { COUNT_TABS } from "@/lib/counter/nav"

/** Pieces shared by the Count & waste tabs, desk and phone. */

export function CountHead({ sub, children }: { sub: string; children?: ReactNode }) {
  const href = useSurfaceHref()
  // The picked store rides along between tabs; without it the next tab falls
  // back to the first store, and waste gets logged against the wrong one.
  const store = useSearchParams().get("store")
  const q = store ? `?${new URLSearchParams({ store })}` : ""
  return (
    <PageHead title="Count & waste" sub={sub}>
      <SubNav items={COUNT_TABS.map((t) => ({ ...t, href: href(t.href + q) }))} label="Count & waste" />
      {children}
    </PageHead>
  )
}

export function money(n: number): string {
  const neg = n < 0
  const s = Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return neg ? `−${s}` : s
}

/** Store chips that move the page to `?store=<id>`. */
export function StoreChips({
  stores,
  current,
  path,
  extra,
}: {
  stores: Array<{ id: string; name: string }>
  current: string
  path: string
  extra?: Record<string, string>
}) {
  const router = useRouter()
  const href = useSurfaceHref()
  if (stores.length < 2) return null
  return (
    <div className="cw__chips" role="group" aria-label="Store">
      {stores.map((s) => (
        <button
          key={s.id}
          type="button"
          className="cw__chip"
          aria-pressed={current === s.id}
          onClick={() => router.push(href(`${path}?${new URLSearchParams({ ...extra, store: s.id }).toString()}`))}
        >
          {s.name}
        </button>
      ))}
    </div>
  )
}

export type Outcome = { ok: boolean; text: string } | null

export function OutcomeLine({ outcome }: { outcome: Outcome }) {
  return (
    <span className={`cw__msg ${outcome ? (outcome.ok ? "cw__msg--ok" : "cw__msg--bad") : ""}`} role="status">
      {outcome?.text ?? ""}
    </span>
  )
}
