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

export function IdentityForm({
  name,
  email,
  phone,
  timezone,
  avatarUrl,
}: {
  name: string
  email: string
  phone: string | null
  timezone: string
  avatarUrl: string | null
}) {
  const [banner, setBanner] = useState<Banner>(null)
  const [isPending, startTransition] = useTransition()

  async function handleSubmit(formData: FormData) {
    setBanner(null)
    startTransition(async () => {
      const res = await updateProfile(formData)
      if (!res.success) {
        setBanner({ tone: "error", message: res.error ?? "Update failed" })
      } else {
        setBanner({ tone: "success", message: "Identity updated." })
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

      <div className="editorial-form-row">
        <div className="editorial-form-field">
          <label htmlFor="identity-name" className="font-label">
            Name in print
          </label>
          <div className="editorial-field">
            <input
              id="identity-name"
              name="name"
              type="text"
              defaultValue={name}
              autoComplete="name"
              required
              disabled={isPending}
            />
          </div>
        </div>
        <div className="editorial-form-field">
          <label htmlFor="identity-email" className="font-label">
            Correspondence address
          </label>
          <div className="editorial-field" data-readonly="true">
            <input
              id="identity-email"
              name="email"
              type="email"
              defaultValue={email}
              readOnly
              disabled
            />
          </div>
          <span className="field-note">
            Contact the editor to change your published email.
          </span>
        </div>
      </div>

      <div className="editorial-form-row">
        <div className="editorial-form-field">
          <label htmlFor="identity-phone" className="font-label">
            Telephone
          </label>
          <div className="editorial-field">
            <input
              id="identity-phone"
              name="phone"
              type="tel"
              defaultValue={phone ?? ""}
              placeholder="(optional)"
              autoComplete="tel"
              disabled={isPending}
            />
          </div>
        </div>
        <div className="editorial-form-field">
          <label htmlFor="identity-timezone" className="font-label">
            Time zone
          </label>
          <div className="editorial-field">
            <select
              id="identity-timezone"
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
        </div>
      </div>

      <div className="editorial-form-field">
        <label htmlFor="identity-avatar" className="font-label">
          Portrait URL
        </label>
        <div className="editorial-field">
          <input
            id="identity-avatar"
            name="avatarUrl"
            type="url"
            defaultValue={avatarUrl ?? ""}
            placeholder="https://…"
            disabled={isPending}
          />
        </div>
        <span className="field-note">
          Paste the full URL to a square image. Leave blank to keep your monogram.
        </span>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="submit"
          className="editorial-submit"
          disabled={isPending}
        >
          {isPending ? "Setting type…" : "Commit to print"}
        </button>
      </div>
    </form>
  )
}
