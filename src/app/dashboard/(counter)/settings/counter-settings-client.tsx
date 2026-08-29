"use client"

import { useEffect, useState, useTransition } from "react"
import {
  Kv,
  PageHead,
  Section,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
} from "@/components/counter"
import { saveNotificationPreferences } from "@/lib/counter/actions/settings"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
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
