"use client"

import { useState, useTransition } from "react"
import { updateProfile } from "@/app/actions/user-actions"

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
  "Europe/London",
  "Europe/Paris",
]

type Banner =
  | { tone: "success"; message: string }
  | { tone: "error"; message: string }
  | null

export function TimezoneForm({
  name,
  phone,
  avatarUrl,
  timezone,
}: {
  name: string
  phone: string | null
  avatarUrl: string | null
  timezone: string
}) {
  const [banner, setBanner] = useState<Banner>(null)
  const [isPending, startTransition] = useTransition()

  async function handleSubmit(formData: FormData) {
    setBanner(null)
    // updateProfile validates the other fields too — carry them through.
    formData.set("name", name)
    if (phone) formData.set("phone", phone)
    if (avatarUrl) formData.set("avatarUrl", avatarUrl)
    startTransition(async () => {
      const res = await updateProfile(formData)
      if (!res.success) {
        setBanner({ tone: "error", message: res.error ?? "Update failed" })
      } else {
        setBanner({ tone: "success", message: "Time zone updated." })
      }
    })
  }

  return (
    <form action={handleSubmit} className="editorial-form-stack">
      {banner ? (
        <div className="settings-banner" data-tone={banner.tone}>
          <span className="banner-label">
            {banner.tone === "success" ? "Filed" : "Held"}
          </span>
          <span>{banner.message}</span>
        </div>
      ) : null}

      <div className="editorial-form-field">
        <label htmlFor="prefs-timezone" className="font-label">
          Publication time zone
        </label>
        <div className="editorial-field">
          <select
            id="prefs-timezone"
            name="timezone"
            defaultValue={timezone}
            disabled={isPending}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
        <span className="field-note">
          Dates, cut-off hours, and the weekly report all run against this zone.
        </span>
      </div>

      <div className="flex items-center justify-end pt-2">
        <button
          type="submit"
          className="editorial-submit"
          disabled={isPending}
        >
          {isPending ? "Filing…" : "Commit to print"}
        </button>
      </div>
    </form>
  )
}
