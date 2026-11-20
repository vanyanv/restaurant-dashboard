"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Section, useCounterTransition, usePageChrome } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { WasteOne, WastePictureSections, WasteStoreBar, WasteView } from "@/lib/counter/adapters/inventory-waste"
import type { SwitcherSections } from "@/lib/counter/adapters/inventory-shelf"
import { barShares, type WasteReasonBar, type WasteSummary } from "@/lib/counter/waste-picture"
import { CountHead, money } from "../count-ui"
import { Bars, Hero, changeSay, type BarRow } from "../picture-ui"
import { WasteEntries, WasteLog } from "../waste-log"

/**
 * Inventory — Waste. The picture first: what was thrown out in the last 7
 * days against the 7 days before, why, what was logged and how the stores
 * compare. "Log waste" opens the form (`?log=1`), which is the same ten-second
 * form as before. One client for the desk and the phone.
 */
export function WasteClient({ sections }: { sections: SectionSources<WastePictureSections & SwitcherSections> }) {
  usePageChrome({ leaf: "Waste" })
  const { pending } = useCounterTransition()
  return (
    <>
      <CountHead sub="What got thrown out, and why" switcher={sections.switcher} allView />
      <Section bare title="Waste" data={sections.waste} pending={pending}>
        {(d) => (d ? <Body data={d} /> : null)}
      </Section>
    </>
  )
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function Body({ data }: { data: WasteView }) {
  const pathname = usePathname() ?? ""
  const logging = useSearchParams().get("log") === "1"
  if (logging) {
    return data.one ? <LogMode one={data.one} back={`${pathname}?store=${data.one.store.id}`} /> : <PickStore stores={data.byStore} pathname={pathname} />
  }
  const logHref = data.one ? `${pathname}?store=${data.one.store.id}&log=1` : `${pathname}?log=1`
  return (
    <>
      <div className="iv-foot iv-foot--one">
        <Link className="iv-btn iv-btn--ink" href={logHref}>Log waste</Link>
      </div>
      <div className="iv-c">
        {data.one ? <OneStore data={data} one={data.one} /> : <AllStores data={data} />}
      </div>
    </>
  )
}

/** A total, or the words for why there is none. Never $0 for an unknown. */
function figureOf(w: Pick<WasteSummary, "entries" | "dollars">): { figure: string; words: boolean } {
  if (w.entries === 0) return { figure: "Nothing logged", words: true }
  if (w.dollars === null) return { figure: "Not valued yet", words: true }
  return { figure: money(w.dollars), words: false }
}

/** "Value of 5 of 6 entries", as a bar and a sentence. */
function Valued({ w }: { w: Pick<WasteSummary, "entries" | "valued" | "unpriced"> }) {
  if (w.entries === 0) return null
  if (w.unpriced === 0) return <p className="iv-cover-t"><b>All {plural(w.entries, "entry", "entries")} valued.</b></p>
  return (
    <>
      <span className="iv-cover" aria-hidden="true">
        {w.valued > 0 ? <i style={{ flexGrow: w.valued }} /> : null}
        <i className="ny" style={{ flexGrow: w.unpriced }} />
      </span>
      <p className="iv-cover-t">
        <b>Value of {w.valued} of {plural(w.entries, "entry", "entries")}.</b>{" "}
        {w.unpriced === 1 ? "1 is on an item with no price on file yet. It is listed, not added in." : `${w.unpriced} are on items with no price on file yet. They are listed, not added in.`}
      </p>
    </>
  )
}

function reasonRows(reasons: WasteReasonBar[]): BarRow[] {
  const shares = barShares(reasons.map((r) => r.dollars))
  return reasons.map((r, i) => ({
    key: r.id,
    label: r.label,
    share: shares[i],
    none: r.dollars === null,
    value: r.dollars === null ? "Not valued yet" : money(r.dollars),
    sub: `${plural(r.entries, "entry", "entries")}${r.unpriced > 0 && r.dollars !== null ? `, ${r.unpriced} without a price not added in` : ""}`,
  }))
}

function storeRows(stores: WasteStoreBar[]): BarRow[] {
  const shares = barShares(stores.map((s) => s.dollars))
  return stores.map((s, i) => ({
    key: s.id,
    label: s.name,
    share: shares[i],
    none: s.dollars === null,
    value: s.entries === 0 ? "Nothing logged" : s.dollars === null ? "Not valued yet" : money(s.dollars),
    sub: s.entries === 0
      ? "Nothing thrown out, or nobody wrote it down."
      : `${plural(s.entries, "entry", "entries")}${s.unpriced > 0 && s.dollars !== null ? `, ${s.unpriced} without a price not added in` : ""}`,
  }))
}

function OneStore({ data, one }: { data: WasteView; one: WasteOne }) {
  const w = one.week
  const { figure, words } = figureOf(w)
  const n = data.byStore.length
  return (
    <div className="inv-stack">
      <div className="iv-cols">
        <Hero label={`Thrown out · last 7 days · ${one.store.name}`} figure={figure} words={words} aside={changeSay(one.change, "the 7 days before")}>
          {w.entries === 0 ? (
            <p className="iv-cover-t">No waste was logged at {one.store.name} in the last 7 days. Either nothing was thrown out, or nobody wrote it down.</p>
          ) : (
            <Valued w={w} />
          )}
        </Hero>
        <section className="iv-card" aria-label="Why">
          <div className="iv-card__h">
            <b>Why</b>
            <span className="iv-mono">{plural(w.entries, "entry", "entries")}</span>
          </div>
          {w.reasons.length > 0 ? <Bars rows={reasonRows(w.reasons)} label="Thrown out, by reason" /> : <p className="iv-quiet iv-pad">Nothing logged, so no reasons yet.</p>}
          <p className="iv-note">
            Thrown out is everything logged as dropped, went bad, burnt, remake, damaged or other.
            Theft and things sent back to a vendor are kept apart, never added in.
            {one.apart.length > 0 && (
              <>
                {" "}In the last 7 days:{" "}
                {one.apart.map((a) => `${a.label} ${a.dollars === null ? "not valued yet" : money(a.dollars)} (${a.dollars !== null && a.unpriced > 0 ? `value of ${a.entries - a.unpriced} of ${a.entries} entries` : plural(a.entries, "entry", "entries")})`).join(", ")}.
              </>
            )}
          </p>
        </section>
      </div>
      <div className={`iv-cols${n > 1 ? " iv-cols--even" : ""}`}>
        <section className="iv-card" aria-label="What was logged">
          <div className="iv-card__h">
            <b>What was logged</b>
            <span className="iv-mono">last 7 days</span>
          </div>
          <WasteEntries entries={one.logged} />
        </section>
        {n > 1 && (
          <section className="iv-card" aria-label={`The ${n} stores`}>
            <div className="iv-card__h">
              <b>The {n} stores</b>
              <span className="iv-mono">last 7 days</span>
            </div>
            <Bars rows={storeRows(data.byStore)} label="Thrown out, by store" />
          </section>
        )}
      </div>
    </div>
  )
}

function AllStores({ data }: { data: WasteView }) {
  const a = data.all
  const n = data.byStore.length
  const { figure, words } = figureOf(a)
  const quiet = data.byStore.filter((s) => s.entries === 0).map((s) => s.name)
  return (
    <div className="inv-stack">
      <Hero
        label={`Thrown out · last 7 days · ${a.storesLogged} of ${n} stores`}
        figure={figure}
        words={words}
        aside={quiet.length > 0 && quiet.length < n ? `${quiet.join(" and ")} logged nothing` : undefined}
      >
        {a.entries === 0 ? (
          <p className="iv-cover-t">No waste was logged at any store in the last 7 days. Either nothing was thrown out, or nobody wrote it down.</p>
        ) : (
          <Valued w={a} />
        )}
      </Hero>
      <div className="iv-cols iv-cols--even">
        <section className="iv-card" aria-label="By store">
          <div className="iv-card__h">
            <b>By store</b>
            <span className="iv-mono">last 7 days</span>
          </div>
          <Bars rows={storeRows(data.byStore)} label="Thrown out, by store" />
        </section>
        <section className="iv-card" aria-label="Why">
          <div className="iv-card__h">
            <b>Why</b>
            <span className="iv-mono">{plural(a.entries, "entry", "entries")}</span>
          </div>
          {a.reasons.length > 0 ? <Bars rows={reasonRows(a.reasons)} label="Thrown out, by reason" /> : <p className="iv-quiet iv-pad">Nothing logged, so no reasons yet.</p>}
          <p className="iv-note">Thrown out is everything logged as dropped, went bad, burnt, remake, damaged or other. Theft and things sent back to a vendor are kept apart, never added in.</p>
        </section>
      </div>
    </div>
  )
}

/** The form, for the store picked, with what was logged under it. */
function LogMode({ one, back }: { one: WasteOne; back: string }) {
  const base = (usePathname() ?? "").startsWith("/m/") ? "/m/count" : "/dashboard/count"
  return (
    <div className="iv-c">
      <div className="inv-stack">
        <Link className="iv-back" href={back}>‹ Waste · {one.store.name}</Link>
        <div className="iv-cols iv-cols--even">
          <section className="iv-card iv-pad" aria-label={`Log waste at ${one.store.name}`}>
            <WasteLog key={one.store.id} data={one} base={base} />
          </section>
          <section className="iv-card" aria-label="What was logged">
            <div className="iv-card__h">
              <b>What was logged</b>
              <span className="iv-mono">last 7 days</span>
            </div>
            <WasteEntries entries={one.logged} />
          </section>
        </div>
      </div>
    </div>
  )
}

/** Waste is logged at one store: with every store picked, ask which. */
function PickStore({ stores, pathname }: { stores: WasteStoreBar[]; pathname: string }) {
  return (
    <div className="iv-c">
      <section className="iv-card" aria-label="Which store">
        <div className="iv-card__h"><b>Which store is the waste at?</b></div>
        <div className="iv-picks">
          {stores.map((s) => (
            <Link key={s.id} className="iv-btn" href={`${pathname}?store=${s.id}&log=1`}>{s.name}</Link>
          ))}
        </div>
      </section>
    </div>
  )
}
