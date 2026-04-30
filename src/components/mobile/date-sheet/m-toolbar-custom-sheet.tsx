"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { localDateStr } from "@/lib/dashboard-utils"
import { formatCustomRangeLong } from "@/lib/mobile/period"
import { DateSheetShell } from "./date-sheet-shell"
import { EditorialCalendar } from "./editorial-calendar"

type Props = {
  open: boolean
  onClose: () => void
  pathname: string
  searchParams: Record<string, string | undefined>
  initialStart: Date | null
  initialEnd: Date | null
}

export function MToolbarCustomSheet({
  open,
  onClose,
  pathname,
  searchParams,
  initialStart,
  initialEnd,
}: Props) {
  const router = useRouter()
  const [start, setStart] = useState<Date | null>(initialStart)
  const [end, setEnd] = useState<Date | null>(initialEnd)

  function apply() {
    if (!start || !end) return
    const merged: Record<string, string> = {}
    for (const [k, v] of Object.entries(searchParams)) {
      if (v != null && v !== "" && k !== "period" && k !== "start" && k !== "end" && k !== "grain") {
        merged[k] = v
      }
    }
    merged.period = "custom"
    merged.start = localDateStr(start)
    merged.end = localDateStr(end)
    const qs = new URLSearchParams(merged).toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
    onClose()
  }

  const readout = start && end
    ? formatCustomRangeLong(start, end)
    : start
    ? "Pick an end date"
    : "Pick a start date"

  return (
    <DateSheetShell
      open={open}
      onClose={onClose}
      dept="DATE RANGE"
      footer={
        <>
          <button type="button" className="m-sheet__btn m-sheet__btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="m-sheet__btn m-sheet__btn--primary"
            disabled={!start || !end}
            onClick={apply}
          >
            Apply
          </button>
        </>
      }
    >
      <div
        className={`m-sheet__readout${start && end ? "" : " m-sheet__readout--placeholder"}`}
      >
        {readout}
      </div>
      <EditorialCalendar
        initialStart={initialStart}
        initialEnd={initialEnd}
        onChange={(s, e) => {
          setStart(s)
          setEnd(e)
        }}
      />
    </DateSheetShell>
  )
}
