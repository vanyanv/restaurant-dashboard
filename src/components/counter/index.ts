/**
 * The Counter public surface.
 *
 * A page imports from here and nowhere deeper. Note the deliberate omission:
 * `state/` is NOT re-exported. Those five components are the implementation of
 * note 22 — states live in the builders — and a page that reached one directly
 * would be re-implementing state handling, which is exactly what this design
 * exists to prevent. `tests/components/counter/boundary.test.ts` enforces it.
 */
export { Section } from "./surface/section"
export { Strip } from "./surface/strip"
export { Chart, type ChartProps, type ChartSeries } from "./surface/chart"
export { Figure, type FigureProps, type DeltaTone } from "./surface/figure"
export { Bullet } from "./surface/bullet"
export { Spark } from "./surface/spark"
export { Table, type Column, type Row, type Cell, type CellObject } from "./surface/table"
export { Queue, type QueueItem } from "./surface/queue"
export { Kv, type KvRow } from "./surface/kv"
export { type Tone } from "./surface/tone"
export { Meter } from "./surface/meter"
export { MoneyLines, type MoneyLine } from "./surface/money-lines"
export { Cascade, type CascadeStart, type CascadeCut, type CascadeEnd } from "./surface/cascade"
export { Caret } from "./surface/caret"
export { Drill } from "./surface/drill"
export { GapBar, type GapCause, type GapResidual, type GapTone } from "./surface/gap-bar"
export { ChannelRows, type ChannelRow } from "./surface/channel-rows"
export { StoreCards, stageLabel, type StoreCard, type TradingStore, type PreOpenStore } from "./surface/store-cards"
export { StoreRows } from "./surface/store-rows"
export { Toast, type ToastTone } from "./surface/toast"
export { Dispatch, type DispatchItem } from "./surface/dispatch"
export { HeadBlock, LeadFigure, type HeadFigure } from "./surface/head-block"
export { Say } from "./surface/say"
export { FloorMeter } from "./surface/floor-meter"
export { Moving, type MovingCell } from "./surface/moving"
export { AskGlyph } from "./surface/ask-glyph"
export { WeekTable, type WeekRow, type WeekTableProps } from "./surface/week-table"
export { Filters, type FilterToggle } from "./surface/filters"
export { SearchGlyph } from "./surface/search-glyph"

export { AskSurface } from "./ask/ask-surface"
export { AskBar } from "./ask/ask-bar"
export { AskSheet } from "./ask/ask-sheet"

export { AppShell, EntryItem } from "./shell/app-shell"
export { Rail, type RailUser } from "./shell/rail"
export { PageHead } from "./shell/page-head"
export { SyncChip, type SyncState } from "./shell/sync-chip"
export { Calendar } from "./shell/calendar"
export { Wordmark } from "./shell/wordmark"
export { StoreSwitcher, STAGE_TAG, type SwitchableStore } from "./shell/store-switcher"
export { DateControl, type DateControlProps } from "./shell/date-control"
export { Topbar } from "./shell/topbar"

/* The phone's own three. `.mhead`, `.mstrip` and `.mlist` had no emitter
   anywhere in this tree until Phase C task 4; the phone surface was 0 of 51
   landmarks and could not move without them. */
export { MHead } from "./shell/m-head"
export { MStrip } from "./shell/m-strip"
export { MList, type MListRow } from "./shell/m-list"

/* The phone's top chrome. `.mtop` sits OUTSIDE `.mscroll` and so outside the
   fidelity surface, which is exactly why it was the last thing on this page to
   be built — and why a phone-only reader could not change the store, the range
   or the comparison until it was. */
export { MTop, type MTopProps } from "./shell/m-top"
export { MDateSheet, type MDateSheetProps } from "./shell/m-date-sheet"
export { PhoneSheet } from "./shell/phone-sheet"

export { useEntry, ENTRY_STAGGER_MS, ENTRY_DURATION_MS, ENTRY_TOTAL_MS } from "./motion/use-entry"
export { useCountUp, COUNT_UP_MS } from "./motion/use-count-up"
export { useChartDraw, LINE_DRAW_MS, BAR_STAGGER_MS } from "./motion/use-chart-draw"
export { useReducedMotion } from "./motion/use-reduced-motion"

export { CounterThemeProvider, useCounterTheme, themeNoFlashScript } from "./theme-provider"
export { ThemeToggle } from "./theme-toggle"
