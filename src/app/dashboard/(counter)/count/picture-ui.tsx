"use client"

import type { CSSProperties, ReactNode } from "react"
import Link from "next/link"
import { useSurfaceHref } from "@/components/counter"
import { fmtQty } from "@/lib/counter/count-layers"
import { gapBars, type GapVerdict } from "@/lib/counter/gap-picture"
import type { MoneyChange } from "@/lib/counter/waste-picture"
import { money } from "./count-ui"

/**
 * The pieces the Waste tab, the Report tab and the one-item page draw their
 * pictures from: a headline figure, bars on one scale, the two bars of a
 * count against what should have been there, and the working as a ledger.
 *
 * A bar never stands alone: its number is printed beside it, so the picture
 * reads without the bar. Kinds differ by SHAPE as well as tone: a solid bar
 * is a real amount, an outlined one is what should have been there, and a
 * hatched one is something the app cannot value or has not been told.
 */

/** A headline: a small label, one big figure (or words), and what it covers. */
export function Hero({
  label,
  figure,
  words = false,
  aside,
  children,
}: {
  label: string
  figure: ReactNode
  /** The figure is words ("Nothing logged"), set smaller than a number. */
  words?: boolean
  aside?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="iv-card iv-hero" aria-label={label}>
      <span className="iv-mono">{label}</span>
      <div className="iv-hero__n">
        <strong className={words ? "txt" : undefined}>{figure}</strong>
        {aside ? <span>{aside}</span> : null}
      </div>
      {children}
    </section>
  )
}

const pct = (share: number): CSSProperties => ({ width: `${Math.max(0, Math.min(1, share)) * 100}%` })

/** A bar on a track. `none` is hatched: there is no amount to draw. */
export function HBar({ share, kind = "solid" }: { share: number; kind?: "solid" | "outline" | "none" }) {
  if (kind === "none") return <span className="iv-hb iv-hb--none" aria-hidden="true" />
  return (
    <span className={`iv-hb${kind === "outline" ? " iv-hb--lite" : ""}`} aria-hidden="true">
      {share > 0 ? <i style={pct(share)} /> : null}
    </span>
  )
}

export type BarRow = {
  key: string
  label: ReactNode
  /** 0 to 1, on the scale the rows share. Ignored when `none`. */
  share: number
  /** The number the bar stands for, or the words for why there is none. */
  value: ReactNode
  /** Nothing to draw: hatched. */
  none?: boolean
  sub?: ReactNode
}

/** One row per thing, every bar on the same scale, the figure beside each. */
export function Bars({ rows, label }: { rows: BarRow[]; label: string }) {
  return (
    <ul className="iv-bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key}>
          <b>{r.label}</b>
          <HBar share={r.share} kind={r.none ? "none" : "solid"} />
          <span className={`v${r.none ? " v--none" : ""}`}>{r.value}</span>
          {r.sub ? <small>{r.sub}</small> : null}
        </li>
      ))}
    </ul>
  )
}

/** A quantity to one decimal, the way the report prints them. */
export function q(n: number): string {
  return fmtQty(Math.round(n * 10) / 10)
}

/** "Should have" (outlined) over "Counted" (solid), on one scale. */
export function TwoBars({ should, counted, unit }: { should: number; counted: number; unit: string }) {
  const s = gapBars({ should, counted })
  return (
    <div className="iv-two">
      <div className="iv-two__r">
        <span>Should have</span>
        <HBar share={s.should} kind="outline" />
        <b>{q(should)} {unit}</b>
      </div>
      <div className="iv-two__r">
        <span>Counted</span>
        <HBar share={s.counted} />
        <b>{q(counted)} {unit}</b>
      </div>
    </div>
  )
}

const VERDICT_PILL: Record<GapVerdict, string> = { match: "good", short: "warn", extra: "mute" }

/** "Matches" / "12 lb short" / "3 lb extra". */
export function VerdictPill({ verdict, missing, unit }: { verdict: GapVerdict; missing: number; unit: string }) {
  return (
    <span className={`iv-pill iv-pill--${VERDICT_PILL[verdict]}`}>
      {verdict === "match" ? "Matches" : verdict === "short" ? `${q(missing)} ${unit} short` : `${q(-missing)} ${unit} extra`}
    </span>
  )
}

/** The working, one line per step, the last one the result. */
export function Ledger({ rows }: { rows: Array<{ label: string; value: string; sum?: boolean }> }) {
  return (
    <dl className="iv-ledger">
      {rows.map((r) => (
        <div key={r.label} className={r.sum ? "sum" : undefined}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Something that is honestly not there yet: what is missing and what brings it. */
export function NotYetBox({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="iv-nybox">
      <b>{title}</b>
      {children}
    </div>
  )
}

/**
 * "$12.40 more than the 7 days before". Only ever two real figures: an empty
 * earlier window, or one nobody can value, is said in words.
 */
export function changeSay(change: MoneyChange | null, before: string): ReactNode {
  if (!change) return null
  if (change.kind === "nothing_before") return `Nothing in ${before} to compare with.`
  if (change.kind === "cant_tell") return `Can't be compared with ${before} yet: some of it has no price.`
  if (change.kind === "same") return <>The same as {before}.</>
  return <><b>{money(change.dollars)} {change.kind}</b> than {before}.</>
}

/** A row's name as the link to the item's own page, for the store shown. */
export function ItemLink({ id, store, className, children }: { id: string; store?: string | null; className?: string; children: ReactNode }) {
  const href = useSurfaceHref()
  const q = store ? `?${new URLSearchParams({ store })}` : ""
  return (
    <Link className={className} href={href(`/dashboard/count/item/${encodeURIComponent(id)}${q}`)}>
      {children}
    </Link>
  )
}
