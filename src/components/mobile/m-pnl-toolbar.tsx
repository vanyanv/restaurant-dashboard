import Link from "next/link"
import {
  MOBILE_PNL_PERIODS,
  type MobilePnLRange,
} from "@/lib/mobile/pnl-period"
import { formatCustomRangeShort } from "@/lib/mobile/period"
import { CustomPillTrigger } from "./date-sheet/custom-pill-trigger"

type Props = {
  pathname: string
  searchParams: Record<string, string | undefined>
  range: MobilePnLRange
}

export function MPnLToolbar({ pathname, searchParams, range }: Props) {
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
        className="m-segmented"
        role="tablist"
        aria-label="P&L period"
        style={{ margin: "0 -16px" }}
      >
        {MOBILE_PNL_PERIODS.map((p) => {
          const active = !isCustom && range.period === p.value
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
              style={{ padding: "10px 6px", fontSize: 9 }}
            >
              {p.short}
            </Link>
          )
        })}
        <CustomPillTrigger
          variant="pnl"
          pathname={pathname}
          searchParams={searchParams}
          isActive={isCustom}
          activeLabel={isCustom ? formatCustomRangeShort(range.start, range.end) : undefined}
          initialStart={isCustom ? range.start : null}
          initialEnd={isCustom ? range.end : null}
          initialGrain={isCustom && !range.grainAuto ? range.grain : null}
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
  return new URLSearchParams(merged).toString()
}
