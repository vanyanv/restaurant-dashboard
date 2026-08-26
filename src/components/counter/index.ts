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
export { StoreCards, type StoreCard, type TradingStore, type PreOpenStore } from "./surface/store-cards"
export { Toast, type ToastTone } from "./surface/toast"
export { Dispatch, type DispatchItem } from "./surface/dispatch"
export { HeadBlock, LeadFigure, type HeadFigure } from "./surface/head-block"
export { Say } from "./surface/say"
export { FloorMeter } from "./surface/floor-meter"
export { Moving, type MovingCell } from "./surface/moving"
export { AskGlyph } from "./surface/ask-glyph"

export { AskSurface } from "./ask/ask-surface"
export { AskBar } from "./ask/ask-bar"

export { AppShell, EntryItem } from "./shell/app-shell"
export { Rail, type RailUser } from "./shell/rail"
export { PageHead } from "./shell/page-head"
export { SyncChip, type SyncState } from "./shell/sync-chip"
export { Calendar } from "./shell/calendar"
export { Wordmark } from "./shell/wordmark"
export { StoreSwitcher, type SwitchableStore } from "./shell/store-switcher"
export { DateControl, type DateControlProps } from "./shell/date-control"
export { Topbar } from "./shell/topbar"

export { useEntry, ENTRY_STAGGER_MS, ENTRY_DURATION_MS, ENTRY_TOTAL_MS } from "./motion/use-entry"
export { useCountUp, COUNT_UP_MS } from "./motion/use-count-up"
export { useChartDraw, LINE_DRAW_MS, BAR_STAGGER_MS } from "./motion/use-chart-draw"
export { useReducedMotion } from "./motion/use-reduced-motion"

export { CounterThemeProvider, useCounterTheme, themeNoFlashScript } from "./theme-provider"
export { ThemeToggle } from "./theme-toggle"
