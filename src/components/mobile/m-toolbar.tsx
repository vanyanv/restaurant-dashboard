import Link from "next/link"
import {
  MOBILE_PERIODS,
  formatCustomRangeShort,
  type MobileRange,
} from "@/lib/mobile/period"
import { MobileStoreSelect, type ToolbarStore } from "./m-store-select"
import { CustomPillTrigger } from "./date-sheet/custom-pill-trigger"

export type { ToolbarStore }

type Props = {
  /** Current pathname (e.g. "/m" or "/m/analytics") — used to keep the
   *  period segments routing back to the same page. */
  pathname: string
  /** All search params currently on the URL. Preserved when the toolbar
   *  swaps store or period so per-page filters (?status, ?platform, etc.)
   *  don't get dropped. */
  searchParams: Record<string, string | undefined>
  stores: ToolbarStore[]
  storeId: string | null
  /** Resolved range — either a named period or a custom window. */
  range: MobileRange
}

/**
 * Server-rendered toolbar. Named pills are <a> tags so navigation is pure
 * URL — back/forward + opening in new tab Just Works. The Custom pill is a
 * tiny client island because it opens an interactive bottom sheet.
 */
export function MToolbar({
  pathname,
  searchParams,
  stores,
  storeId,
  range,
}: Props) {
  const isCustom = range.kind === "custom"
  return (
    <div
      className="dock-in dock-in-1 m-toolbar"
      style={{
        margin: "0 -16px 14px",
        padding: "0 16px",
        background: "rgba(255, 253, 247, 0.55)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 0",
        }}
      >
        <span className="m-cap">STORE</span>
        <MobileStoreSelect
          stores={stores}
          storeId={storeId}
          pathname={pathname}
          searchParams={searchParams}
        />
      </div>
      <div
        className="m-segmented"
        role="tablist"
        aria-label="Period"
        style={{ margin: "0 -16px" }}
      >
        {MOBILE_PERIODS.map((p) => {
          const active = !isCustom && range.period === p.value
          // When swapping to a named period, drop start/end/grain.
          const next = withParams(searchParams, {
            period: p.value,
            start: null,
            end: null,
            grain: null,
          })
          const href = next ? `${pathname}?${next}` : pathname
          return (
            <Link
              key={p.value}
              href={href}
              role="tab"
              aria-selected={active}
              prefetch={false}
              className={`m-segmented__item${active ? " is-active" : ""}`}
              style={{ padding: "10px 6px", fontSize: 9.5 }}
            >
              {p.short}
            </Link>
          )
        })}
        <CustomPillTrigger
          variant="toolbar"
          pathname={pathname}
          searchParams={searchParams}
          isActive={isCustom}
          activeLabel={isCustom ? formatCustomRangeShort(range.start, range.end) : undefined}
          initialStart={isCustom ? range.start : null}
          initialEnd={isCustom ? range.end : null}
        />
      </div>
    </div>
  )
}

function withParams(
  current: Record<string, string | undefined>,
  patch: Record<string, string | null | undefined>,
): string {
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(current)) {
    if (v != null && v !== "") merged[k] = v
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") delete merged[k]
    else merged[k] = v
  }
  const params = new URLSearchParams(merged)
  return params.toString()
}
