/**
 * The recharts symbols this app uses, named explicitly.
 *
 * This was `export * from "recharts"`, and the star was the problem.
 * `next.config.ts` lists `recharts` in `optimizePackageImports`, which
 * rewrites a named import into per-module imports so a route pulls only the
 * charts it draws — but that transform matches imports of the PACKAGE, and
 * these ten call sites import this local alias instead. A star re-export also
 * gives a bundler nothing to narrow: it must assume every export is reachable.
 *
 * Listing them by name restores both. The list is exactly what the ten
 * consumers import today; adding a chart type means adding a line here, which
 * is the point — it is a decision, not drift.
 *
 * The alias exists at all so that `src/components/charts/*` has one place to
 * pin recharts behaviour if a version ever needs shimming (see the note in
 * `components/counter/surface/chart.tsx` about recharts 3's className
 * handling). Counter's own Chart, Matrix and Donut are hand-rolled SVG and do
 * not come through here.
 */
export {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

/*
 * TYPES still come through wholesale. They are erased at build time, so they
 * cost the bundle nothing and there is no narrowing to be had — while the
 * consumers below rely on them for inference (a `Tooltip` formatter's
 * parameters, for one, which fall to implicit `any` without them).
 */
export type * from "recharts"
