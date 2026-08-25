"use client"

import { useState, useTransition } from "react"
import { Switch } from "@/components/ui/switch"
import { updateNotificationPrefs } from "@/app/actions/user-actions"

type Banner =
  | { tone: "success"; message: string }
  | { tone: "error"; message: string }
  | null

type Prefs = {
  notifyInvoices: boolean
  notifyWeeklyReport: boolean
  notifyAnomaly: boolean
}

const LEDGER: Array<{
  key: keyof Prefs
  index: string
  title: string
  description: string
}> = [
  {
    key: "notifyInvoices",
    index: "01",
    title: "Invoice arrivals",
    description:
      "A dispatch whenever a new vendor invoice is ingested — arrives within minutes of the sync.",
  },
  {
    key: "notifyWeeklyReport",
    index: "02",
    title: "The weekly report",
    description:
      "The full Monday-morning summary of the week prior: sales, P&L, top movers, recipe cost drift.",
  },
  {
    key: "notifyAnomaly",
    index: "03",
    title: "Anomaly alerts",
    description:
      "Out-of-band telegrams: order gaps, sudden cost changes, sync failures. Sparing by design.",
  },
]

export function StandingOrdersForm({ initial }: { initial: Prefs }) {
  const [prefs, setPrefs] = useState<Prefs>(initial)
  const [banner, setBanner] = useState<Banner>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    setBanner(null)
    const formData = new FormData()
    if (prefs.notifyInvoices) formData.set("notifyInvoices", "on")
    if (prefs.notifyWeeklyReport) formData.set("notifyWeeklyReport", "on")
    if (prefs.notifyAnomaly) formData.set("notifyAnomaly", "on")
    startTransition(async () => {
      const res = await updateNotificationPrefs(formData)
      if (!res.success) {
        setBanner({ tone: "error", message: res.error ?? "Update failed" })
      } else {
        setBanner({ tone: "success", message: "Standing orders filed." })
      }
    })
  }

  return (
    <div className="editorial-form-stack">
      {banner ? (
        <div className="settings-banner" data-tone={banner.tone}>
          <span className="banner-label">
            {banner.tone === "success" ? "Filed" : "Held"}
          </span>
          <span>{banner.message}</span>
        </div>
      ) : null}

      <div>
        {LEDGER.map((row) => (
          <div key={row.key} className="ledger-row">
            <div>
              <div className="ledger-index">№ {row.index}</div>
              <div className="ledger-title">{row.title}</div>
              <div className="ledger-desc">{row.description}</div>
            </div>
            <Switch
              checked={prefs[row.key]}
              onCheckedChange={(value) =>
                setPrefs((p) => ({ ...p, [row.key]: value }))
              }
              disabled={isPending}
              aria-label={row.title}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end pt-2">
        <button
          type="button"
          onClick={handleSubmit}
          className="editorial-submit"
          disabled={isPending}
        >
          {isPending ? "Filing…" : "Update standing orders"}
        </button>
      </div>
    </div>
  )
}
