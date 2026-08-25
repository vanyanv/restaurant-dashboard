"use client"

import { useRef, useState, useTransition } from "react"
import { Eye, EyeOff } from "lucide-react"
import { changePassword } from "@/app/actions/user-actions"

type Banner =
  | { tone: "success"; message: string }
  | { tone: "error"; message: string }
  | null

export function CredentialsForm() {
  const [banner, setBanner] = useState<Banner>(null)
  const [isPending, startTransition] = useTransition()
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(formData: FormData) {
    setBanner(null)
    startTransition(async () => {
      const res = await changePassword(formData)
      if (!res.success) {
        setBanner({ tone: "error", message: res.error ?? "Update failed" })
      } else {
        setBanner({
          tone: "success",
          message: "Password rotated. Your next sign-in uses the new one.",
        })
        formRef.current?.reset()
      }
    })
  }

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      className="editorial-form-stack"
    >
      {banner ? (
        <div className="settings-banner" data-tone={banner.tone}>
          <span className="banner-label">
            {banner.tone === "success" ? "Filed" : "Held"}
          </span>
          <span>{banner.message}</span>
        </div>
      ) : null}

      <div className="editorial-form-field">
        <label htmlFor="credentials-current" className="font-label">
          Current password
        </label>
        <div className="editorial-field">
          <input
            id="credentials-current"
            name="currentPassword"
            type={showCurrent ? "text" : "password"}
            autoComplete="current-password"
            required
            disabled={isPending}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowCurrent((v) => !v)}
            disabled={isPending}
            className="field-toggle"
            aria-label={showCurrent ? "Hide password" : "Show password"}
          >
            {showCurrent ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      <div className="editorial-form-row">
        <div className="editorial-form-field">
          <label htmlFor="credentials-new" className="font-label">
            New password
          </label>
          <div className="editorial-field">
            <input
              id="credentials-new"
              name="newPassword"
              type={showNew ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              disabled={isPending}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowNew((v) => !v)}
              disabled={isPending}
              className="field-toggle"
              aria-label={showNew ? "Hide password" : "Show password"}
            >
              {showNew ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <span className="field-note">Minimum eight characters.</span>
        </div>

        <div className="editorial-form-field">
          <label htmlFor="credentials-confirm" className="font-label">
            Confirm new password
          </label>
          <div className="editorial-field">
            <input
              id="credentials-confirm"
              name="confirmPassword"
              type={showNew ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              disabled={isPending}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="submit"
          className="editorial-submit"
          disabled={isPending}
        >
          {isPending ? "Rotating…" : "Rotate password"}
        </button>
      </div>
    </form>
  )
}
