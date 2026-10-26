"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Section, useCounterTransition, usePageChrome } from "@/components/counter"
import {
  addCrewMember,
  emailCrewPin,
  setCrewActive,
  syncStoreCrew,
  updateCrewMember,
  type ActionResult,
} from "@/lib/counter/actions/checks"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { CrewData, CrewRow, CrewSections } from "@/lib/counter/adapters/checks"
import { ChecksHead, OutcomeLine, StorePicker, type Outcome } from "../checks-ui"

/**
 * Store checks — Crew & PINs. Crew come in from Harri with a PIN already
 * assigned; an owner can change a PIN, add someone by hand, switch someone
 * off, and email a PIN. PINs are hidden until asked for, one row at a time.
 */
export function ChecksCrewClient({ sections }: { sections: SectionSources<CrewSections> }) {
  usePageChrome({ leaf: "Crew & PINs" })
  const { pending } = useCounterTransition()
  return (
    <>
      <ChecksHead sub="Who can sign a check, and their PINs · owners only" />
      <Section title="Crew & PINs" meta={(d) => d.store.name} data={sections.crew} pending={pending} pad={false}>
        {(d) => <Crew key={d.store.id} data={d} />}
      </Section>
    </>
  )
}

function ago(iso: string | null): string {
  if (!iso) return "never"
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 60) return `${Math.max(1, min)} min ago`
  if (min < 48 * 60) return `${Math.round(min / 60)} hr ago`
  return `${Math.round(min / 1440)} days ago`
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function useAction() {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [outcome, setOutcome] = useState<Outcome>(null)
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn()
      setOutcome(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error })
      if (r.ok) {
        after?.()
        router.refresh()
      }
    })
  return { busy, outcome, run, setOutcome }
}

function Crew({ data }: { data: CrewData }) {
  const { busy, outcome, run } = useAction()
  const [showAll, setShowAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const active = data.crew.filter((c) => c.active).length

  return (
    <div style={{ display: "grid" }}>
      <div className="ck-spread" style={{ padding: 14, borderBottom: "1px solid var(--line)" }}>
        <div className="ck-row">
          <StorePicker stores={data.stores} current={data.store.id} path="/dashboard/checks/crew" />
          <span className="ck-mono">
            {data.harriLinked ? `Harri roster from ${ago(data.harriSyncedAt)}` : "This store isn't linked to Harri"} · {active} with a PIN
          </span>
        </div>
        <div className="ck-row">
          <OutcomeLine outcome={outcome} />
          <button type="button" className="btn" disabled={busy} onClick={() => run(() => syncStoreCrew({ storeId: data.store.id }))}>
            {busy ? "Working…" : "Sync from Harri"}
          </button>
          <button type="button" className="btn" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Hide all PINs" : "Show all PINs"}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "Add crew member"}
          </button>
        </div>
      </div>
      {!data.emailReady && (
        <p className="ck-meta" style={{ padding: "10px 14px", margin: 0, borderBottom: "1px solid var(--line)" }}>
          PIN emails are off until the dashboard has an email sender set up. Until then, read a PIN here and hand it over.
        </p>
      )}
      {adding && <AddForm storeId={data.store.id} onDone={() => setAdding(false)} />}
      <div className="ck-tablewrap">
        <table className="ck-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>PIN</th>
              <th>From</th>
              <th>Last check</th>
              <th>PIN email</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.crew.length === 0 && (
              <tr>
                <td colSpan={6} className="ck-meta">
                  Nobody here yet. Sync from Harri, or add someone by hand.
                </td>
              </tr>
            )}
            {data.crew.map((c) => (
              <CrewLine key={c.id} c={c} showAll={showAll} emailReady={data.emailReady} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CrewLine({ c, showAll, emailReady }: { c: CrewRow; showAll: boolean; emailReady: boolean }) {
  const [show, setShow] = useState(false)
  const [editing, setEditing] = useState(false)
  const { busy, outcome, run } = useAction()
  const visible = show || showAll

  if (editing) {
    return (
      <tr>
        <td colSpan={6} style={{ padding: 0 }}>
          <CrewForm
            initial={c}
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={(v) => updateCrewMember({ crewId: c.id, ...v })}
            onDone={() => setEditing(false)}
          />
        </td>
      </tr>
    )
  }

  return (
    <tr className={c.active ? "" : "off"}>
      <td>
        <b>{c.name}</b>
        {c.email && <div className="ck-meta">{c.email}</div>}
      </td>
      <td>
        {c.active && c.pin ? (
          <span className="ck-row">
            <span className="ck-pin">{visible ? c.pin : "••••"}</span>
            {!showAll && (
              <button type="button" className="ck-link" onClick={() => setShow((v) => !v)}>
                {show ? "Hide" : "Show"}
              </button>
            )}
          </span>
        ) : (
          <span className="ck-meta">{c.inactiveReason ?? "Off"} · PIN off</span>
        )}
      </td>
      <td>
        <span className={`ck-mono`}>{c.source === "HARRI" ? "Harri" : "Added by you"}</span>
      </td>
      <td className="ck-meta">{c.lastCheck ?? "Never"}</td>
      <td className="ck-meta">
        {!c.email ? (c.source === "HARRI" ? "No email in Harri" : "No email") : c.pinEmailedAt ? `Sent ${shortDate(c.pinEmailedAt)}` : "Not sent"}
      </td>
      <td>
        <span className="ck-row" style={{ justifyContent: "flex-end" }}>
          <OutcomeLine outcome={outcome} />
          {c.active && c.email && emailReady && (
            <button type="button" className="ck-link" disabled={busy} onClick={() => run(() => emailCrewPin({ crewId: c.id }))}>
              {c.pinEmailedAt ? "Resend" : "Send"}
            </button>
          )}
          <button type="button" className="ck-link" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            type="button"
            className="ck-link"
            disabled={busy}
            onClick={() => run(() => setCrewActive({ crewId: c.id, active: !c.active }))}
          >
            {c.active ? "Turn off" : "Turn on"}
          </button>
        </span>
      </td>
    </tr>
  )
}

type CrewValues = { firstName: string; lastName: string; email: string; pin: string }

function AddForm({ storeId, onDone }: { storeId: string; onDone: () => void }) {
  return (
    <CrewForm
      initial={{ firstName: "", lastName: "", email: "", pin: "" }}
      submitLabel="Add"
      pinHint="Leave empty to pick one"
      onCancel={onDone}
      onSubmit={(v) => addCrewMember({ storeId, ...v })}
      onDone={onDone}
    />
  )
}

function CrewForm({
  initial,
  submitLabel,
  pinHint,
  onSubmit,
  onCancel,
  onDone,
}: {
  initial: { firstName: string; lastName: string; email: string; pin: string | null }
  submitLabel: string
  pinHint?: string
  onSubmit: (v: CrewValues) => Promise<ActionResult>
  onCancel: () => void
  onDone: () => void
}) {
  const [v, setV] = useState<CrewValues>({ ...initial, pin: initial.pin ?? "" })
  const { busy, outcome, run } = useAction()
  const set = (k: keyof CrewValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV((x) => ({ ...x, [k]: k === "pin" ? e.target.value.replace(/\D/g, "").slice(0, 4) : e.target.value }))
  return (
    <form
      className="ck-crewform"
      onSubmit={(e) => {
        e.preventDefault()
        run(() => onSubmit(v), onDone)
      }}
    >
      <label className="ck-field">
        <span className="ck-mono">First name</span>
        <input className="ck-input" value={v.firstName} onChange={set("firstName")} required autoFocus />
      </label>
      <label className="ck-field">
        <span className="ck-mono">Last name</span>
        <input className="ck-input" value={v.lastName} onChange={set("lastName")} />
      </label>
      <label className="ck-field">
        <span className="ck-mono">Email</span>
        <input className="ck-input" type="email" value={v.email} onChange={set("email")} />
      </label>
      <label className="ck-field">
        <span className="ck-mono">PIN{pinHint ? ` · ${pinHint}` : ""}</span>
        <input className="ck-input ck-pin" inputMode="numeric" pattern="\d{4}" value={v.pin} onChange={set("pin")} />
      </label>
      <span className="ck-row">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>
          Cancel
        </button>
        <OutcomeLine outcome={outcome} />
      </span>
    </form>
  )
}
