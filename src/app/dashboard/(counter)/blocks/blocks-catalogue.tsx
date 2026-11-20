"use client"

import { useState, type ReactNode } from "react"
import {
  Answer,
  BigNumber,
  BigNumbers,
  Button,
  ButtonRow,
  Card,
  Fold,
  NeedsYou,
  Rows,
  Status,
  StoreCard,
  StoreCardGrid,
  Tabs,
  Tile,
  Tiles,
  WeekBars,
  BarRows,
  ChartKey,
  Compare,
  SplitBars,
  NeedsYouItem,
  NeedsYouList,
  Notice,
  useAct,
  useLeaving,
  type ActResult,
  type RowsColumn,
} from "@/components/counter/ui"

type Invoice = { id: string; vendor: string; where: string; checked: boolean; amount: string }

const INVOICES: Invoice[] = [
  { id: "a", vendor: "Sysco", where: "Van Nuys · Nov 14", checked: true, amount: "$2,318.40" },
  { id: "b", vendor: "Premier Meats", where: "Glendale · Nov 13", checked: false, amount: "$1,742.10" },
  { id: "c", vendor: "Individual FoodService", where: "Hollywood · Nov 12", checked: true, amount: "$618.75" },
]

const COLUMNS: RowsColumn<Invoice>[] = [
  { key: "vendor", label: "Vendor", slot: "title", render: (r) => r.vendor },
  { key: "where", label: "Invoice", slot: "detail", render: (r) => r.where },
  {
    key: "status",
    label: "Status",
    slot: "status",
    render: (r) =>
      r.checked ? <Status tone="good">Checked</Status> : <Status tone="warn">Needs a store</Status>,
  },
  { key: "amount", label: "Amount", slot: "amount", align: "end", render: (r) => r.amount },
]

function Both({ name, replaces, note, children }: { name: string; replaces: string; note: string; children: ReactNode }) {
  return (
    <section className="cu-cat" aria-labelledby={`cu-cat-${name}`}>
      <div className="cu-cat__head">
        <h2 id={`cu-cat-${name}`}>{name}</h2>
        <span className="cu-cat__replaces">replaces {replaces}</span>
      </div>
      <p className="cu-cat__note">{note}</p>
      <div className="cu-cat__pair">
        <div className="cu-cat__frame cu-cat__frame--desk">
          <span className="cu-cat__bar">Desk</span>
          <div className="cu-cat__body">{children}</div>
        </div>
        <div className="cu-cat__frame cu-cat__frame--phone">
          <span className="cu-cat__bar">Phone · 390 px</span>
          <div className="cu-cat__body">{children}</div>
        </div>
      </div>
    </section>
  )
}

/** A pretend save, so the catalogue shows a tap from start to finish. */
const pretend = (ms: number, ok = true): Promise<ActResult> =>
  new Promise((r) => setTimeout(() => r(ok ? { ok: true } : { ok: false, error: "network" }), ms))

function TapDemo() {
  const { act, stateOf, doneOf, busy, error } = useAct()
  const leaving = useLeaving()
  const [note, setNote] = useState<string | null>(null)
  return (
    <>
      <ButtonRow>
        <Button variant="primary" state={stateOf("ok")} doneLabel={doneOf("ok")} disabled={busy}
          onClick={() => act("ok", () => pretend(600), { done: "Approved" })}>
          Approve
        </Button>
        <Button state={stateOf("bad")} disabled={busy} onClick={() => act("bad", () => pretend(600, false))}>
          A save that fails
        </Button>
      </ButtonRow>
      {error ? <Notice tone="bad">That didn&apos;t save. Try again.</Notice> : null}
      <NeedsYouList>
        <NeedsYouItem what="Link Fryer oil 35 lb" why="Reached no ingredient" leaving={leaving.isLeaving("oil")}>
          <Button variant="primary" state={stateOf("link")} doneLabel={doneOf("link")} disabled={busy}
            onClick={() => act("link", () => pretend(500), { done: "Linked", optimistic: () => leaving.mark("oil"),
              onDone: () => { leaving.keep("oil"); setNote("Fryer oil linked.") } })}>
            Yes, link
          </Button>
        </NeedsYouItem>
      </NeedsYouList>
      {note ? <Notice tone="good" onUndo={() => { leaving.restore("oil"); setNote(null) }}>{note}</Notice> : null}
    </>
  )
}

export function BlocksCatalogue() {
  const [period, setPeriod] = useState("week")
  return (
    <div className="cu-cat__page">
      <p className="cu-cat__note">Example figures, not your numbers. Each block is the same markup in both frames.</p>

      <Both name="Answer" replaces=".say .lede .pl-lead .iv-lede .ck-plain .pp-say .rs-lead" note="The one plain sentence a page opens with.">
        <Answer>
          You kept <b>$6,420</b> last week, <b>$310</b> more than the week before. Glendale&apos;s labor is
          missing for 2 days, so the real figure may be lower.
        </Answer>
      </Both>

      <Both name="BigNumber" replaces=".headline .fig .mhead .pl-big .pl-hero .ck-big .mi-hero .cw-fig" note="Lead figure with vs last period; missing inputs labelled, never counted as $0.">
        <BigNumbers>
          <BigNumber label="Sales this week" value="$48,210" vs={{ change: "▲ 4.2%", tone: "up", against: "vs last week" }} />
          <BigNumber label="Food cost" value="29.8%" vs={{ change: "▲ 0.6 pts", tone: "down", against: "vs last week" }} />
          <BigNumber label="Labor" value="24.1%" atMost missing="Glendale missing 2 days" />
        </BigNumbers>
      </Both>

      <Both name="Status" replaces=".statuspill .mtag .pl-pill .iv-pill .inv-pill .pp-pill .rs-pill" note="Status in words with a dot.">
        <span className="cu-cat__row">
          <Status tone="good">On track</Status>
          <Status tone="warn">Needs a look</Status>
          <Status tone="bad">Behind</Status>
          <Status tone="wait">Waiting on data</Status>
        </span>
      </Both>

      <Both name="Button" replaces=".btn .mbtn .iv-btn .ibtn .qbtn .pagebtn" note="Main, plain and quiet. Full width and 44 px tall on the phone.">
        <ButtonRow>
          <Button variant="primary">Yes, Glendale</Button>
          <Button>Different store</Button>
          <Button variant="quiet">Undo</Button>
        </ButtonRow>
      </Both>

      <Both name="Tap feedback" replaces="Saving… labels" note="useAct: the tapped button works, then shows a tick; a done row slides away with Undo. All motion stops under reduced motion.">
        <TapDemo />
      </Both>

      <Both name="Card" replaces=".pl-card .iv-card .iv-tile .mi-card .sh-tile .ck-tile" note="Layout-contained, so a change inside it doesn't re-lay-out the page; a menu still shows past its edge.">
        <Card>
          <span className="cu-cat__menuhost">
            <b>Fries case</b>
            <span className="cu-cat__menu" role="note">Menus and tooltips overflow the card</span>
          </span>
          <span>Up $4.20 a case, about $67 a month.</span>
        </Card>
      </Both>

      <Both name="StoreCard" replaces=".stcard .pstore .prow .pl-store .iv-store .ck-store .cw-store" note="Side by side on the desk, stacked on the phone.">
        <StoreCardGrid>
          <StoreCard name="Hollywood" status={{ tone: "good", label: "On track" }} figures={[{ label: "Sales", value: "$21,940" }, { label: "Kept", value: "$3,180" }]} note="Up $820 on last week" />
          <StoreCard name="Van Nuys" status={{ tone: "warn", label: "Needs a look" }} figures={[{ label: "Sales", value: "$15,310" }, { label: "Kept", value: "$2,140" }]} note="Food cost 31.2%, above target" />
          <StoreCard name="Glendale" status={{ tone: "wait", label: "Waiting on data" }} figures={[{ label: "Sales", value: "$10,960" }, { label: "Kept", value: "≤ $1,100" }]} note="Labor missing Nov 12–13" />
        </StoreCardGrid>
      </Both>

      <Both name="Rows" replaces=".tbl (desk only) .mlist .iv-row .ck-row .pp-row" note="A table on the desk, stacked cards on the phone, from the same rows.">
        <Rows columns={COLUMNS} rows={INVOICES} rowKey={(r) => r.id} />
      </Both>

      <Both name="NeedsYou" replaces=".queue .mlist .pl-todos .iv-tasks .iv-needs .mi-needs .pp-needs .sh-queue" note="A few groups, one fix button each. Collapsed by default on real pages.">
        <NeedsYou
          defaultOpen
          groups={[
            { key: "store", what: "2 invoices need a store", why: "Premier Meats, $3,484 together", action: <Button variant="primary">Yes, Glendale</Button> },
            { key: "labor", what: "Labor is missing for 2 days", why: "Glendale, Nov 12–13", action: <Button>Sync from Harri</Button> },
            { key: "price", what: "1 price went up", why: "Fries case, +$4.20, about $67 a month", action: <Button>See price</Button> },
          ]}
        />
      </Both>

      <Both name="Tabs" replaces=".seg .pp-tabs .rs-seg .iv-sw .cd-switch .ck-secswitch" note="Fills the width on the phone.">
        <Tabs
          label="Period"
          active={period}
          onSelect={setPeriod}
          items={[
            { key: "week", label: "Week" },
            { key: "month", label: "Month" },
            { key: "custom", label: "Custom" },
          ]}
        />
      </Both>

      <Both name="Tile" replaces=".sh-tile .ck-rep__tile" note="A small figure that usually opens the list behind it. Red when it is the thing to look at.">
        <Tiles>
          <Tile label="To ship" value={3} sub="1 late" bad href="#" />
          <Tile label="To bag" value={2} sub="Pickup orders to pack" href="#" />
          <Tile label="Food cost" value="27.4%" sub="After discounts" />
          <Tile label="Missed" value={1} tone="bad" />
        </Tiles>
      </Both>

      <Both name="Fold" replaces=".iv-fold .rs-fold .ck-logfold .ckp-more" note="Everything that isn't the answer, folded at the bottom.">
        <Fold summary="Show every number">The full statement sits here, folded away.</Fold>
      </Both>

      <Both name="WeekBars" replaces=".pl-weeks .pl-wk" note="The last weeks as bars that pick the week. A hatched bar is an at-most figure.">
        <CatWeeks />
      </Both>

      <Both name="SplitBars" replaces="a one-off week chart" note="Periods where the whole bar is one figure and the filled part another. Tap a bar to open it; a hatched bar has an input missing.">
        <CatSplit />
      </Both>

      <Both name="BarRows" replaces="one-off bar lists" note="A name, a bar and a figure per line, with one reference mark. Rows on a phone; with cells, side by side on a desk.">
        <Card>
          <ChartKey items={[{ kind: "fill", label: "labor, share of sales" }, { kind: "mark", label: "the week, 28.0%" }, { kind: "hatched", label: "labor missing" }]} />
          <BarRows
            cells
            mark={66}
            rows={[
              { key: "mon", title: "Mon", sub: "Nov 9", value: "32.0%", fill: 76, detail: "$2,050 on $6,400 · 112 h" },
              { key: "tue", title: "Tue", sub: "Nov 10", value: "25.0%", fill: 59, detail: "$2,450 on $9,800 · 132 h", tag: "so far" },
              { key: "wed", title: "Wed", sub: "Nov 11", value: "missing", fill: 0, hatched: true, detail: "sold $8,700 · no labor from Harri" },
            ]}
          />
        </Card>
      </Both>

      <Both name="Compare" replaces="one-off comparison tables" note="Two periods side by side with the change. A missing side leaves the change blank.">
        <Card>
          <Compare
            a={{ key: "a", label: "Week of Nov 9" }}
            b={{ key: "b", label: "Week of Nov 2" }}
            rows={[
              { key: "sales", label: "Sales", a: "$55,800", b: "$52,000", change: "▲ $3,800", tone: "up" },
              { key: "share", label: "Labor, share of sales", a: "28.0%", b: "26.9%", change: "▲ 1.1 pts", tone: "down" },
              { key: "hours", label: "Hours worked", a: "850 h", b: "missing", change: "", tone: "flat" },
            ]}
          />
        </Card>
      </Both>
    </div>
  )
}

const WEEKS = [
  { key: "10/12", value: 98_200, partial: false },
  { key: "10/19", value: 99_730, partial: false },
  { key: "10/26", value: 109_607, partial: true },
]

function CatWeeks() {
  const [picked, setPicked] = useState("10/26")
  return (
    <WeekBars
      title="Sales, last 3 weeks · tap a week"
      partialLabel="labor missing"
      weeks={WEEKS.map((w) => ({
        key: w.key,
        label: w.key,
        value: w.value,
        top: `$${(w.value / 1000).toFixed(1)}k`,
        partial: w.partial,
        selected: w.key === picked,
        ariaLabel: `Week of ${w.key}`,
      }))}
      onPick={setPicked}
    />
  )
}

const SPLIT = [
  { key: "10/26", value: 92, inner: 27, hatched: false },
  { key: "11/2", value: 86, inner: 27, hatched: true },
  { key: "11/9", value: 100, inner: 28, hatched: false },
]

function CatSplit() {
  const [picked, setPicked] = useState("11/9")
  return (
    <Card>
      <ChartKey items={[{ kind: "base", label: "sales" }, { kind: "fill", label: "labor" }, { kind: "hatched", label: "labor missing" }]} />
      <SplitBars
        bars={SPLIT.map((w) => ({
          key: w.key,
          label: w.key,
          top: `${w.inner}.0%`,
          value: w.value,
          inner: w.inner,
          hatched: w.hatched,
          selected: w.key === picked,
          ariaLabel: `Week of ${w.key}`,
        }))}
        onPick={setPicked}
      />
    </Card>
  )
}
