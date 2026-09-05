"use client"

import { useEffect, useState, useTransition } from "react"
import { signOut } from "next-auth/react"
import {
  Kv,
  Note,
  PageHead,
  Section,
  Table,
  toneStyle,
  useCounterTransition,
  usePageChrome,
  Logo,
  ThemeRow,
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
  // The OUTCOME travels with the text. Held as a string alone, "Saved." and
  // "Could not save: …" landed in the same neutral note and a reader could not
  // tell which had happened.
  const [zoneSaid, setZoneSaid] = useState<{ ok: boolean; text: string } | null>(null)

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
      setZoneSaid({ ok: result.ok, text: result.ok ? "Saved." : `Could not save: ${result.error}.` })
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
        <Note live tone={zoneSaid.ok ? "good" : "bad"}>
          {zoneSaid.text}
        </Note>
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
      <Note live tone={problem === null ? undefined : "bad"}>
        {problem === null ? data.note : `Could not save: ${problem}.`}
      </Note>
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
            {/* `P.settings`' Account is SETROWS, not a `.kv` — see
                `SettingRow`. The two that carry a control (the timezone
                select, the password button) are `AccountControls` below. */}
            {a.rows.map((r) => (
              <div className="setrow" key={r.label}>
                <div className="tx">
                  <b>{r.label}</b>
                  <span>{r.detail}</span>
                </div>
                <span className="mono" style={toneStyle(r.tone)}>
                  {r.value}
                </span>
              </div>
            ))}
            <AccountControls data={a} />
            {a.clockWarning !== null ? (
              <Note>
                {a.clockWarning}
              </Note>
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
        askAbout="who has signed in recently"
      >
        {(s) => (
          <>
            {/* `P.settings`' Sessions panel is setrows, one device a line.
                Ours are the same rows read off the log — see the adapter for
                why a live session list is not available. */}
            {s.rows.map((r) => (
              <div className="setrow" key={r.label}>
                <div className="tx">
                  <b>{r.label}</b>
                  <span>{r.detail}</span>
                </div>
                <span className="mono">{r.value}</span>
              </div>
            ))}
            {/* `P.settings`' Sessions panel closes with a `.btnrow` holding
                "Sign out everywhere", then its note — this is that row, in
                that position, holding the one of the two the product can
                honour.

                NOT "Sign out everywhere". Auth is `strategy: "jwt"` with no
                session table, so there is no way to revoke a token this
                browser is not holding, and a button that claimed to would be
                lying about a security control — the same reason the manifest
                declares "End" absent on every row above. Signing out HERE is
                a cookie and needs none of that. The manifest's absence entry
                is narrowed by one rather than deleted. */}
            <div className="btnrow" style={{ marginTop: 12 }}>
              <button
                className="btn"
                type="button"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                Sign out
              </button>
            </div>
            <Note>
              {s.note}
            </Note>
          </>
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
            {/* The one preference that is a control, not a reading. Kept out of
                the adapter's rows because a row is a string and this one is not. */}
            <ThemeRow />
            <Note>
              {p.note}
            </Note>
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
            {/* The mark, not the name set in type. This panel's own meta line
                says "used on login and in the rail", and login draws
                `Logo` now — but the better reason is note 15's: "the wordmark
                is the palette's alibi". Beside an Accent and a Signal swatch,
                the artwork that IS that red and that yellow demonstrates the
                claim; a line of Bricolage only asserts it. The rail still
                draws the type, which is why the meta line still says both. */}
            <Logo width={180} />
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
            <Note bare measure>{b.note}</Note>
          </div>
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
            {/* `P.settings` closes Team with a real `.sec__body` under the
                table — it holds the invite buttons there, and the note. We
                have the note; the buttons are declared in the manifest. */}
            <div className="sec__body">
              <Note bare>
                {t.note}
              </Note>
            </div>
          </>
        )}
      </Section>
    </>
  )
}
