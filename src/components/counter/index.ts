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
export { Figure, type FigureProps } from "./surface/figure"
export { Table, type Column, type Row } from "./surface/table"
export { Meter } from "./surface/meter"
export { Cascade, type CascadeStep } from "./surface/cascade"
export { Toast, type ToastTone } from "./surface/toast"

export { CounterThemeProvider, useCounterTheme, themeNoFlashScript } from "./theme-provider"
export { ThemeToggle } from "./theme-toggle"
