"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { PageHead, SubNav, type FigureProps } from "@/components/counter"
import { INVOICES_TABS } from "@/lib/counter/nav"
import type { InvoiceListRow } from "@/lib/counter/adapters/invoices"

/**
 * Pieces shared by the three Invoices tabs and the invoice page: the head with
 * its tabs, the status glyph (Store checks' shapes, so a status reads the same
 * in greyscale on every screen), and the count tiles Shop opens with.
 */

export function InvoicesHead({ sub, children }: { sub: string; children?: ReactNode }) {
  return (
    <PageHead title="Invoices" sub={sub}>
      <SubNav items={INVOICES_TABS} label="Invoices" />
      {children}
    </PageHead>
  )
}

export type InvoiceGlyphKind = InvoiceListRow["glyph"]

const GLYPH: Record<InvoiceGlyphKind, { cls: string; mark: ReactNode; label: string }> = {
  miss: { cls: "ck-gl--miss", mark: "✕", label: "Does not add up" },
  open: { cls: "ck-gl--open", mark: "◷", label: "Needs a look" },
  ok: { cls: "ck-gl--ok", mark: "✓", label: "Ties out" },
  up: { cls: "ck-gl--up", mark: "·", label: "Credit memo" },
  off: { cls: "ck-gl--closed", mark: "–", label: "Rejected" },
}

export function InvoiceGlyph({ kind, title, small }: { kind: InvoiceGlyphKind; title?: string; small?: boolean }) {
  const g = GLYPH[kind]
  return (
    <span className={`ck-gl ${g.cls}${small ? " ck-gl--sm" : ""}`} role="img" aria-label={title ?? g.label} title={title ?? g.label}>
      {g.mark}
    </span>
  )
}

export function InvoiceLegend() {
  return (
    <div className="ck-legend">
      {(["miss", "open", "ok", "up", "off"] as const).map((g) => (
        <span key={g}>
          <InvoiceGlyph kind={g} small />
          {GLYPH[g].label}
        </span>
      ))}
    </div>
  )
}

/**
 * An adapter's strip, drawn as Shop's count tiles. The figures are the
 * adapter's own `FigureProps` — this only changes how they look. A cell whose
 * delta the adapter marks as bad news is the one tile drawn in red.
 */
export function Tiles({ cells, hrefs }: { cells: FigureProps[]; hrefs?: Array<string | null> }) {
  return (
    <div className="sh-tiles iv-tiles">
      {cells.map((c, i) => {
        const cls = `sh-tile${c.deltaTone === "is-down" ? " sh-tile--bad" : ""}`
        const body = (
          <>
            <span className="k">{c.label}</span>
            <span className="v">{c.value}</span>
            {c.delta ? <span className="s">{c.delta}</span> : null}
          </>
        )
        const href = hrefs?.[i]
        return href ? (
          <Link key={c.label} className={cls} href={href}>
            {body}
          </Link>
        ) : (
          <div key={c.label} className={cls}>
            {body}
          </div>
        )
      })}
    </div>
  )
}
