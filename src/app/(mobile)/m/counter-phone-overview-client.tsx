"use client"

import Link from "next/link"
import { useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  AskSheet,
  ChannelRows,
  Chart,
  MDateSheet,
  MHead,
  MList,
  MStrip,
  MTop,
  Moving,
  Section,
  StoreRows,
  type MListRow,
  type StoreCard,
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import {
  dayCount, rangeLabel, rangeSubtitle, rangeTitle,
  type ComparisonId, type DateRange, type PresetId,
} from "@/lib/counter/date-range"
import { count, money } from "@/lib/counter/format"
import type {
  OverviewSections,
  OverviewStoreCard,
  QueueEntry,
} from "@/lib/counter/adapters/overview"
import type { SwitchableStore } from "@/components/counter"

/**
 * Counter Overview, the phone.
 *
 * `P.overview.phone()` at line 4360 of `docs/counter/counter-prototype.html`,
 * composed in its order. The prototype renders BOTH surfaces from one `show()`
 * call — the desk and the phone are always the same page — and this file is the
 * second half of that sentence. It calls the SAME adapter the desk calls
 * (`getOverviewSections`), so no figure on this page can disagree with the same
 * figure on `/dashboard`: they are the same number, from the same rollup, read
 * through the same `SectionData`.
 *
 * ## The phone is a route, not a breakpoint
 *
 * `src/middleware.ts` redirects `/dashboard` to `/m` on a phone user agent, so
 * this — not `counter-overview-client.tsx` — is what the phone actually
 * renders, and what `npm run fidelity`'s `fidelity-mobile` project measures.
 * The plan's file list says to put the phone composition in the desk's client
 * island; that island is never reached from a phone. See the task 4 report.
 *
 * ## What the phone drops, and it is the prototype that drops it
 *
 * | Desk | Phone |
 * |---|---|
 * | `.dispatch` | — |
 * | `.headline` + two `.fig` + `.say` | one `.mhead` |
 * | `.strip` with six `.sp` sparklines | `.mstrip`, no sparklines at all |
 * | `.moving`, three cells | `.moving`, **ONE** cell |
 * | `.askbar` | `.masksheet` |
 * | `.stores` / `.stcard` | `.pstore` / `.prow` |
 * | `.drill` + `.tbl` comparison | — |
 * | Invoices + guest ratings | — |
 * | `.queue` | `.mlist` |
 *
 * **`.moving` is ONE cell, not three.** The sheet rules its cells off with
 * `border-right` and has no stacked-column rule, so three cells at 316px wrap
 * into a seamless block with rules in the middle of it. The prototype's phone
 * passes one, and the first is the one it passes — the range, which is the only
 * cell of the three that is about the page rather than about a figure that is
 * no longer on it.
 *
 * ## The controls, and where the prototype puts them
 *
 * The store selector and the date control are the phone SHELL's, not the
 * page's: the prototype puts them in `.mtop`, which sits outside `.mscroll` —
 * and therefore outside the fidelity surface, next to `.mtabs`. Nothing
 * measured this page's chrome, which is exactly how it came to be missing.
 * Until `MTop` landed, a phone-only reader could receive `?range` / `?store` /
 * `?cmp` from a desk redirect and could not change any of the three. That is a
 * functional regression, not a cosmetic gap: the editorial `MToolbar` this
 * page replaced did offer both controls.
 *
 * They write the SAME three parameters the desk writes, through the same
 * `writeCounterParams`. Driving Counter's range from `MToolbar`'s own
 * `?period=today` vocabulary instead would have put two range vocabularies on
 * one page, which is note 60's defect exactly.
 *
 * `.mtop` is rendered inside this island rather than in
 * `(mobile)/m/layout.tsx`: its rules read `--chrome` and `--line`, which only
 * resolve under a Counter root, and that layout is shared with a dozen
 * editorial `/m` pages that have their own toolbar. It moves to the shell the
 * day the shell is Counter.
 */
export function CounterPhoneOverviewClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  /** The query string as PLAIN TEXT — a `URLSearchParams` loses its prototype crossing the RSC boundary. */
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: OverviewSections
}) {
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])
  const router = useRouter()

  /**
   * Every control on this page goes through here, exactly as the desk's do.
   * `writeCounterParams` drops anything sitting at its default, so the URL a
   * reader shares off a phone is the same short URL the desk produces.
   *
   * push, not replace: a range change is a real navigation an owner expects
   * the back button to undo.
   */
  const push = useCallback(
    (next: Parameters<typeof writeCounterParams>[1]) => {
      const qs = writeCounterParams(params, next).toString()
      router.push(qs ? `/m?${qs}` : "/m", { scroll: false })
    },
    [params, router],
  )

  const { range, presetId, comparisonId } = counterParams
  const selectedStore = stores.find((s) => s.id === counterParams.storeId) ?? null
  const windowLabel = rangeLabel(range, "custom")
  const comparing = comparisonId !== "none"
  const days = dayCount(range)

  /**
   * A store's row and the panel it opens. The panel is built here rather than
   * in the adapter for the same reason the desk builds it in its own island: a
   * `ReactNode` cannot cross the RSC boundary. Every figure inside it came from
   * the adapter already.
   *
   * The two destinations are the phone's, not the desk's. `/m/pnl/{id}` is a
   * real mobile page; the store file has none — mobile's stores route was
   * deleted in the bloat cull — so it links to the desktop one, which this app
   * genuinely serves. A link to a real page a phone renders wide beats no link,
   * and beats a link to a 404.
   */
  const toRow = (c: OverviewStoreCard): StoreCard => {
    if (c.kind === "pre_open") {
      return {
        ...c,
        panel: (
          <ChannelRows
            caption={`${c.name} is not trading yet`}
            rows={[]}
            footer={
              c.missingFromFile.length === 0
                ? "Its store file is complete. Nothing here will be counted until it opens."
                : `Its store file is still missing ${c.missingFromFile.join(", ").toLowerCase()}.`
            }
            actions={
              <Link className="btn" href={`/dashboard/stores/${c.id}`}>
                Open the store file
              </Link>
            }
          />
        ),
      }
    }
    return {
      ...c,
      panel: (
        <ChannelRows
          caption={`Where ${c.name}'s ${money(c.netSales)} came from · ${windowLabel}`}
          rows={c.channels}
          footer={
            c.channels.length === 0
              ? "No channel readings for this range."
              : `${count(c.orders)} orders across ${c.channels.length} channels.`
          }
          actions={
            <>
              <Link className="btn" href={`/m/pnl/${c.id}`}>
                Open this store&rsquo;s P&amp;L
              </Link>
              <Link className="btn" href={`/dashboard/stores/${c.id}`}>
                Open the store file
              </Link>
            </>
          }
        />
      ),
    }
  }

  /** `QueueEntry` -> one `.mli`. The lead figure is the row's right-hand value. */
  const toListRow = (e: QueueEntry): MListRow => ({
    key: e.key,
    title: e.title,
    detail: e.body,
    value: e.lead,
    note: e.unit,
    href: e.href,
  })

  return (
    // `.ct-root` and `.ct-phone` sit ONE ELEMENT ABOVE `.mscroll`, so that
    // `.mtop` is inside them too. This is `.pframe`'s own arrangement: the
    // prototype's token root wraps the top chrome, the scroll region and the
    // sheets, and is none of them. `.mtop` reads `--chrome` and `--line`,
    // which the alias layer declares only on a Counter root.
    //
    // `.ct-root` is what makes every ported rule below live — it is the alias
    // layer's own selector and the element `container-name: fr` sits on.
    // `.ct-phone` is `.pframe`'s type scale, a step larger than the desk's at
    // every step because a phone is held closer and the column is 316px wide;
    // worn WITH `.ct-root`, never instead of it. Without it this page renders
    // the whole design at the desk's 13px, which the fidelity gate reported as
    // `font-size 14px / 13px` on every landmark it shares with the prototype.
    <div className="ct-root ct-phone">
      {/* The store and the range, in the prototype's own phone chrome. Outside
          `.mscroll`, and so outside the fidelity surface — which is why it
          went missing without a gate noticing. */}
      <MTop
        stores={stores}
        selectedStoreId={counterParams.storeId}
        onSelectStore={(id) => push({ storeId: id })}
        date={
          <MDateSheet
            presetId={presetId}
            comparisonId={comparisonId}
            range={range}
            onPreset={(id: PresetId) => push({ presetId: id })}
            onComparison={(id: ComparisonId) => push({ comparisonId: id })}
            onRange={(next: DateRange) => push({ range: next })}
          />
        }
      />

      {/* `.mscroll` is the phone page's grid: 12px of padding, 11px between
          blocks, and the staggered entry `counter-repairs.css` already repairs
          for `.mscroll > *`. */}
      <div className="mscroll">
        <div>
          <h2 className="mtitle">{rangeTitle(range)}</h2>
          <p className="msub">
            {rangeSubtitle(selectedStore?.name ?? "All stores", range, comparisonId)}
          </p>
        </div>

        {/* The whole head block, as one figure and one sentence. Two sections
            that fail independently: the figure is the sales rollup, the sentence
            is the verdict derived across every figure on the page. */}
        <Section bare title="Net sales" data={sections.sales}>
          {(d) => (
            <MHead
              label={days === 1 ? "Net sales" : `Net sales · ${count(days)} days`}
              value={money(d.netSales)}
              // Only when a comparison is on: with it off the string is "no
              // comparison set", which is what `.msub` above already says.
              //
              // The tone is the adapter's, and it is the reason `.mhead .d`
              // needed correcting at all — the sheet paints it `var(--good)`
              // unclassed, so before this a fall printed its ▼ in the colour of
              // a rise on this surface exactly as it did on the desk.
              delta={comparing ? d.comparison : undefined}
              deltaTone={comparing ? d.comparisonTone : undefined}
              note={
                <Section bare title="The verdict" data={sections.verdict}>
                  {(v) => (
                    <p>
                      <b>{v.headline}</b> {v.body}
                    </p>
                  )}
                </Section>
              }
            />
          )}
        </Section>

        {/* No state: a store that is not trading is still a store you can ask
            about, which is why the prototype prints this in every state. */}
        <AskSheet
          prompt={`Ask about ${days === 1 ? "today" : "this range"}`}
          href="/m/chat"
          suggestions={[
            "Why is food cost where it is?",
            comparing ? "What changed?" : "What moved this range?",
          ]}
        />

        <Section bare title="The figures" data={sections.strip}>
          {(cells) => <MStrip cells={cells} />}
        </Section>

        {/* ONE cell. See the module note. */}
        <Section bare title="Still moving" data={sections.moving}>
          {(cells) => <Moving cells={cells.slice(0, 1)} />}
        </Section>

        {/* `h` and `ticks` are the prototype's own phone values (108 and 104,
            both tickless): the axis row is what a 316px chart cannot afford, and
            the reading is on the tooltip either way. */}
        <Section title="Net sales" meta={windowLabel} data={sections.salesChart} askAbout="net sales over this range">
          {(spec) => <Chart {...spec} h={108} ticks={false} fmt={(v) => money(v)} />}
        </Section>

        <Section
          title="Sales per labor hour"
          meta={windowLabel}
          data={sections.splhChart}
          askAbout="sales per labour hour"
        >
          {(spec) => (
            <Chart {...spec} h={104} ticks={false} fmt={(v) => money(v, { cents: true })} />
          )}
        </Section>

        <Section title="Per store" meta="tap for where the money came from" data={sections.stores}>
          {(cards) => (
            <StoreRows
              stores={cards.map(toRow)}
              /* The selected store's row, or the first trading one — "tap for
                 where the money came from" is what this section is for, and a
                 page of shut drawers answers nothing. */
              defaultOpenId={counterParams.storeId ?? cards.find((c) => c.kind === "trading")?.id}
            />
          )}
        </Section>

        <Section title="What needs you" data={sections.needsYou} askAbout="what needs me">
          {(items) => <MList rows={items.map(toListRow)} />}
        </Section>
      </div>
    </div>
  )
}
