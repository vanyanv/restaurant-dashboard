"use client"

import { useEffect, useState, useTransition } from "react"
import {
  Wordmark,
  Kv,
  PageHead,
  Section,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
} from "@/components/counter"
import {
  saveNewPassword,
  saveNotificationPreferences,
  saveTimezone,
} from "@/lib/counter/actions/settings"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  SettingsAccount,
  SettingsNotifications,
  SettingsSections,
} from "@/lib/counter/adapters/settings"

/**
 * Settings — `P.settings`.
 *
 * The prototype's six panels, minus the two that cannot exist: a device list
 * (JWT, no session table, zero sign-outs ever) and the invite buttons
 * (nothing issues an invite). Both are replaced by a statement of what the
 * data does say rather than a control that would do nothing. See the adapter.
 */
const SIGNIN_COLUMNS: Column[] = [
  { key: "agent", label: "Came from" },
  { key: "signins", label: "Sign-ins", numeric: true },
  { key: "addresses", label: "Addresses", numeric: true },
  { key: "last", label: "Most recent" },
]

const TEAM_COLUMNS: Column[] = [
  { key: "person", label: "Person" },
  { key: "email", label: "Email" },
  { key: "role", label: "Role" },
  { key: "timezone", label: "Timezone" },
  { key: "stores", label: "Stores owned", numeric: true },
  { key: "you", label: "" },
]

/** The three that write. Labels are the prototype's, minus the daily digest. */
const TOGGLES = [
  {
    key: "anomaly" as const,
    label: "Critical alerts",
    detail: "Reconciliation breaks and sync failures",
  },
  {
    key: "invoices" as const,
    label: "Invoice review",
    detail: "When something needs approving",
  },
  {
    key: "weekly" as const,
    label: "Weekly report",
    detail: "Sunday evening, the week behind",
  },
]

/**
 * The timezone and the password — the two things the editorial settings could
 * change and this page must not lose. A page that reports the owner's clock is
 * three hours out and offers no way to set it would be half a page.
 */
function AccountControls({ data }: { data: SettingsAccount }) {
  const editable = data.editable
  const [zone, setZone] = useState(editable?.timezone ?? "")
  const [saving, startSaving] = useTransition()
  const [zoneSaid, setZoneSaid] = useState<string | null>(null)

  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [pwSaid, setPwSaid] = useState<string | null>(null)

  useEffect(() => {
    setZone(editable?.timezone ?? "")
  }, [editable?.timezone])

  if (editable === null) return null

  function changeZone(value: string) {
    setZone(value)
    setZoneSaid(null)
    startSaving(async () => {
      const result = await saveTimezone({ name: editable!.name, timezone: value })
      setZoneSaid(result.ok ? "Saved." : `Could not save: ${result.error}.`)
      if (!result.ok) setZone(editable!.timezone)
    })
  }

  function submitPassword() {
    setPwSaid(null)
    startSaving(async () => {
      const result = await saveNewPassword({
        currentPassword: current,
        newPassword: next,
        confirmPassword: confirm,
      })
      if (result.ok) {
        setCurrent("")
        setNext("")
        setConfirm("")
        setOpen(false)
        setPwSaid("Password changed.")
        return
      }
      setPwSaid(result.error)
    })
  }

  return (
    <>
      <div className="setrow">
        <div className="tx">
          <b>Timezone</b>
          <span>Used wherever a figure is bucketed by day</span>
        </div>
        <select
          className="inp"
          aria-label="Your timezone"
          value={zone}
          disabled={saving}
          onChange={(e) => changeZone(e.target.value)}
        >
          {(data.timezoneChoices.includes(zone)
            ? data.timezoneChoices
            : [zone, ...data.timezoneChoices]
          ).map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>

      <div className="setrow">
        <div className="tx">
          <b>Password</b>
          <span>{pwSaid ?? "Eight characters or more"}</span>
        </div>
        <button className="btn" type="button" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "Change"}
        </button>
      </div>

      {open ? (
        <div className="setrow" style={{ display: "grid", gap: 8 }}>
          <input
            className="inp"
            type="password"
            aria-label="Current password"
            placeholder="Current password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <input
            className="inp"
            type="password"
            aria-label="New password"
            placeholder="New password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <input
            className="inp"
            type="password"
            aria-label="Confirm new password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <div className="btnrow">
            <button
              className="btn btn--primary"
              type="button"
              disabled={saving}
              onClick={submitPassword}
            >
              {saving ? "Saving…" : "Change the password"}
            </button>
          </div>
        </div>
      ) : null}

      {zoneSaid !== null ? (
        <p className="mono" style={{ margin: "10px 0 0" }}>
          {zoneSaid}
        </p>
      ) : null}
    </>
  )
}

function Notifications({ data }: { data: SettingsNotifications }) {
  const [state, setState] = useState({
    invoices: data.invoices,
    weekly: data.weekly,
    anomaly: data.anomaly,
  })
  const [saving, startSaving] = useTransition()
  const [problem, setProblem] = useState<string | null>(null)

  // The server is the truth: if a section re-resolves, take its answer over
  // whatever this component was holding.
  useEffect(() => {
    setState({ invoices: data.invoices, weekly: data.weekly, anomaly: data.anomaly })
  }, [data.invoices, data.weekly, data.anomaly])

  function toggle(key: "invoices" | "weekly" | "anomaly") {
    const next = { ...state, [key]: !state[key] }
    setState(next)
    setProblem(null)
    startSaving(async () => {
      const result = await saveNotificationPreferences(next)
      if (!result.ok) {
        setProblem(result.error)
        setState(state)
      }
    })
  }

  return (
    <>
      {TOGGLES.map((t) => (
        <div className="setrow" key={t.key}>
          <div className="tx">
            <b>{t.label}</b>
            <span>{t.detail}</span>
          </div>
          <button
            className="sw"
            type="button"
            aria-pressed={state[t.key]}
            aria-label={t.label}
            disabled={saving}
            onClick={() => toggle(t.key)}
          >
            <i />
          </button>
        </div>
      ))}
      <p className="mono" style={{ margin: "10px 0 0" }}>
        {problem === null ? data.note : `Could not save: ${problem}.`}
      </p>
    </>
  )
}

export function CounterSettingsClient({
  sections,
}: {
  sections: SectionSources<SettingsSections>
}) {
  usePageChrome({
    leaf: "Settings",
    askSuggestions: ["Who can see this account?", "What timezone am I set to?"],
  })
  const { pending } = useCounterTransition()

  return (
    <>
      <PageHead title="Settings" sub="Account, notifications, preferences" />

      <Section title="Account" meta={(a) => a.meta} data={sections.account} pending={pending}>
        {(a) => (
          <>
            <Kv rows={a.rows} />
            <AccountControls data={a} />
            {a.clockWarning !== null ? (
              <p className="mono" style={{ marginBottom: 0 }}>
                {a.clockWarning}
              </p>
            ) : null}
          </>
        )}
      </Section>

      <Section
        title="Notifications"
        meta={(n) => n.meta}
        data={sections.notifications}
        pending={pending}
      >
        {(n) => <Notifications data={n} />}
      </Section>

      <Section
        title="Where sign-ins came from"
        meta={(s) => s.meta}
        data={sections.signins}
        pending={pending}
        pad={false}
        askAbout="who has signed in recently"
      >
        {(s) => (
          <>
            <Table columns={SIGNIN_COLUMNS} rows={s.rows} />
            {/* No `.sec__body` — a table section emits the table alone. */}
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {s.note}
            </p>
          </>
        )}
      </Section>

      {/* `P.settings`' "Brand". Static — it describes the design system, not
          this account. The prototype's own copy claims the accent is sampled
          from the wordmark; nothing here records that, so the panel says what
          the colours are FOR instead. */}
      <Section title="Brand" meta={() => "used on login and in the rail"} data={sections.brand} pending={pending}>
        {(b) => (
          <div style={{ display: "grid", gap: 12, justifyItems: "start" }}>
            <Wordmark />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {b.swatches.map((sw) => (
                <span
                  className="qbtn"
                  key={sw.key}
                  style={{ ["--qc" as string]: `var(--${sw.token})` }}
                >
                  <i />
                  {sw.label}
                  <span className="n">{sw.what}</span>
                </span>
              ))}
            </div>
            <p className="mono" style={{ margin: 0, maxWidth: "56ch" }}>
              {b.note}
            </p>
          </div>
        )}
      </Section>

      <Section
        title="Preferences"
        meta={(p) => p.meta}
        data={sections.preferences}
        pending={pending}
      >
        {(p) => (
          <>
            <Kv rows={p.rows} />
            <p className="mono" style={{ marginBottom: 0 }}>
              {p.note}
            </p>
          </>
        )}
      </Section>

      <Section
        title="Who can see this"
        meta={(t) => t.meta}
        data={sections.team}
        pending={pending}
        pad={false}
        askAbout="who can see this account"
      >
        {(t) => (
          <>
            <Table columns={TEAM_COLUMNS} rows={t.rows} />
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {t.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
