"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { PageHead, Section, useCounterTransition, usePageChrome } from "@/components/counter"
import {
  cancelInvite,
  copyInviteLink,
  invitePerson,
  removeAccess,
  restoreAccess,
  sendFreshLink,
  setPersonRole,
  type PeopleResult,
} from "@/lib/counter/actions/people"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { PeopleAccessData, PeopleAccessSections, PersonRow, PersonState } from "@/lib/counter/adapters/people-access"

/**
 * Admin > People (developer only). Everyone who can sign in, everyone waiting
 * on a link, and the buttons that change either: invite, send a fresh link,
 * cancel, remove (with Undo), give access back, switch Owner/Developer.
 *
 * "Made Plain": one sentence first, three counts, status in words, Needs you
 * folded shut, and on a phone the rows stack as cards (CSS, same markup).
 */
export function CounterPeopleAccessClient({ sections }: { sections: SectionSources<PeopleAccessSections> }) {
  usePageChrome({ leaf: "People" })
  const { pending } = useCounterTransition()
  return (
    <>
      <PageHead title="People" sub="Who can sign in, and who is waiting on a link · developer only" />
      <Section title="People" data={sections.people} pending={pending} bare>
        {(d) => <People data={d} />}
      </Section>
    </>
  )
}

type Flash = { tone: "ok" | "bad"; text: string; link?: string; undo?: string } | null

const STATE_WORDS: Record<PersonState, string> = {
  in: "Signed up",
  waiting: "Waiting",
  ran_out: "Link ran out",
  removed: "Removed",
}
const STATE_TONE: Record<PersonState, string> = { in: "good", waiting: "warn", ran_out: "bad", removed: "off" }

type Filter = "all" | PersonState

function initials(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean)
  return (parts.slice(0, 2).map((p) => p[0]).join("") || "?").toUpperCase()
}

function first(name: string): string {
  return name.split(/\s+/)[0] || name
}

function sentence(c: PeopleAccessData["counts"]): React.ReactNode {
  const people = c.in === 1 ? "1 person can" : `${c.in} people can`
  return (
    <>
      <b>{people} sign in.</b>
      {c.waiting > 0 ? ` ${c.waiting} ${c.waiting === 1 ? "is invited and hasn't" : "are invited and haven't"} signed up yet.` : null}
      {c.ran_out > 0 ? (
        <>
          {" "}
          <b>
            {c.ran_out} sign-up {c.ran_out === 1 ? "link" : "links"} ran out
          </b>
          , so send a fresh one.
        </>
      ) : null}
      {c.waiting === 0 && c.ran_out === 0 ? " Nobody is waiting on a link." : null}
    </>
  )
}

function useRun(setFlash: (f: Flash) => void) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const run = (fn: () => Promise<PeopleResult>, opts?: { undo?: string; after?: () => void }) =>
    start(async () => {
      const r = await fn()
      if (!r.ok) {
        setFlash({ tone: "bad", text: r.error })
        return
      }
      setFlash({ tone: "ok", text: r.message, link: r.link, undo: opts?.undo })
      if (r.link) {
        try {
          await navigator.clipboard.writeText(r.link)
        } catch {
          // The link is shown with its own Copy button below.
        }
      }
      opts?.after?.()
      router.refresh()
    })
  return { busy, run }
}

function People({ data }: { data: PeopleAccessData }) {
  const [flash, setFlash] = useState<Flash>(null)
  const [filter, setFilter] = useState<Filter>("all")
  const [inviting, setInviting] = useState(false)
  const [confirm, setConfirm] = useState<PersonRow | null>(null)
  const { busy, run } = useRun(setFlash)
  const c = data.counts
  const ranOut = data.rows.filter((r) => r.state === "ran_out")
  const rows = data.rows.filter((r) => filter === "all" || r.state === filter)

  // A success message fades on its own; an Undo stays up for ten seconds.
  useEffect(() => {
    if (!flash || flash.tone === "bad" || flash.link) return
    const t = setTimeout(() => setFlash(null), flash.undo ? 10_000 : 5_000)
    return () => clearTimeout(t)
  }, [flash])

  const tabs: Array<{ f: Filter; label: string; n: number }> = [
    { f: "all", label: "Everyone", n: data.rows.length },
    { f: "in", label: "Signed up", n: c.in },
    { f: "waiting", label: "Waiting", n: c.waiting },
    { f: "ran_out", label: "Ran out", n: c.ran_out },
    ...(c.removed > 0 ? [{ f: "removed" as const, label: "Removed", n: c.removed }] : []),
  ]

  return (
    <div className="pp">
      <div className="pp-top">
        <p className="pp-say">{sentence(c)}</p>
        <button type="button" className="btn btn--primary pp-invite-btn" onClick={() => setInviting((v) => !v)} aria-expanded={inviting}>
          {inviting ? "Close" : "+ Invite someone"}
        </button>
      </div>

      <div className="pp-figs">
        <div>
          <b className="tnum">{c.in}</b>
          <span>signed up</span>
        </div>
        <div>
          <b className="tnum">{c.waiting}</b>
          <span>invited, not signed up yet</span>
        </div>
        <div>
          <b className="tnum">{c.ran_out}</b>
          <span>link ran out</span>
        </div>
      </div>

      {!data.emailReady ? (
        <p className="pp-note">
          The dashboard can&rsquo;t send email yet, so every invite comes back as a link to copy and text. Add RESEND_API_KEY and
          CHECKS_EMAIL_FROM in Vercel to send them by email.
        </p>
      ) : null}

      {ranOut.length > 0 ? (
        <details className="pp-needs">
          <summary>
            <span className="pp-dot" aria-hidden="true" />
            <span>
              Needs you · {ranOut.length} sign-up {ranOut.length === 1 ? "link" : "links"} ran out
            </span>
            <span className="pp-chev" aria-hidden="true">
              ›
            </span>
          </summary>
          <div className="pp-needs__body">
            <p>
              {ranOut.map((r) => first(r.name)).join(", ")} didn&rsquo;t sign up before {ranOut.length === 1 ? "their link" : "their links"} stopped working.
              One tap sends each a fresh 7-day link.
            </p>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  let sent = 0
                  for (const r of ranOut) {
                    const res = await sendFreshLink({ inviteId: r.id })
                    if (!res.ok) return res
                    sent++
                  }
                  return { ok: true, message: `Fresh links sent to ${sent} ${sent === 1 ? "person" : "people"}` }
                })
              }
            >
              Send them all a fresh link
            </button>
          </div>
        </details>
      ) : null}

      {inviting ? (
        <InviteForm
          busy={busy}
          emailReady={data.emailReady}
          onSend={(v) => run(() => invitePerson(v), { after: () => setInviting(false) })}
        />
      ) : null}

      {flash ? (
        <div className={`pp-flash pp-flash--${flash.tone}`} role={flash.tone === "bad" ? "alert" : "status"}>
          <span>{flash.text}</span>
          {flash.undo ? (
            <button type="button" className="pp-flash__act" disabled={busy} onClick={() => run(() => restoreAccess({ userId: flash.undo as string }))}>
              Undo
            </button>
          ) : null}
          {flash.link ? <LinkBox link={flash.link} /> : null}
          <button type="button" className="pp-flash__x" aria-label="Dismiss" onClick={() => setFlash(null)}>
            ✕
          </button>
        </div>
      ) : null}

      <div className="pp-tabs" role="tablist" aria-label="Show">
        {tabs.map((t) => (
          <button key={t.f} type="button" role="tab" aria-selected={filter === t.f} onClick={() => setFilter(t.f)}>
            {t.label}
            <span className="tnum">{t.n}</span>
          </button>
        ))}
      </div>

      <ul className="pp-list">
        {rows.length === 0 ? <li className="pp-empty">Nobody here.</li> : null}
        {rows.map((r) => (
          <PersonLine
            key={r.key}
            r={r}
            busy={busy}
            canDemote={data.activeDevelopers > 1}
            onRun={run}
            onRemove={() => setConfirm(r)}
          />
        ))}
      </ul>

      {confirm ? (
        <RemoveDialog
          r={confirm}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const target = confirm
            setConfirm(null)
            run(() => removeAccess({ userId: target.id }), { undo: target.id })
          }}
        />
      ) : null}
    </div>
  )
}

function LinkBox({ link }: { link: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)
  return (
    <span className="pp-linkbox">
      <input ref={ref} readOnly value={link} aria-label="Sign-up link" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link)
            setCopied(true)
          } catch {
            ref.current?.select()
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  )
}

function InviteForm({
  busy,
  emailReady,
  onSend,
}: {
  busy: boolean
  emailReady: boolean
  onSend: (v: { name: string; email: string; role: "OWNER" | "DEVELOPER"; send: boolean }) => void
}) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"OWNER" | "DEVELOPER">("OWNER")
  return (
    <form
      className="pp-panel"
      onSubmit={(e) => {
        e.preventDefault()
        onSend({ name, email, role, send: emailReady })
      }}
    >
      <h3>Invite someone</h3>
      <div className="pp-two">
        <div className="field2">
          <label htmlFor="pp-name">Their name</label>
          <div className="inp">
            <input id="pp-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="Ana Reyes" maxLength={120} />
          </div>
        </div>
        <div className="field2">
          <label htmlFor="pp-email">Their email</label>
          <div className="inp">
            <input
              id="pp-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              placeholder="ana@example.com"
            />
          </div>
        </div>
      </div>
      <fieldset className="pp-choice">
        <legend>What they can do</legend>
        <label>
          <input type="radio" name="pp-role" checked={role === "OWNER"} onChange={() => setRole("OWNER")} />
          <span>
            <b>Owner</b>
            <small>Every store and money page. No Admin.</small>
          </span>
        </label>
        <label>
          <input type="radio" name="pp-role" checked={role === "DEVELOPER"} onChange={() => setRole("DEVELOPER")} />
          <span>
            <b>Developer</b>
            <small>Everything, plus Monitoring and People.</small>
          </span>
        </label>
      </fieldset>
      <div className="pp-row">
        <button type="submit" className="btn btn--primary" disabled={busy || !email.trim()}>
          {busy ? "Sending…" : emailReady ? "Email the invite" : "Make the link"}
        </button>
        {emailReady ? (
          <button
            type="button"
            className="btn"
            disabled={busy || !email.trim()}
            onClick={(e) => {
              const form = e.currentTarget.form
              if (form && !form.reportValidity()) return
              onSend({ name, email, role, send: false })
            }}
          >
            Copy link to text it
          </button>
        ) : null}
        <span className="pp-meta">The link works once and stops after 7 days. They choose their own password.</span>
      </div>
    </form>
  )
}

function PersonLine({
  r,
  busy,
  canDemote,
  onRun,
  onRemove,
}: {
  r: PersonRow
  busy: boolean
  canDemote: boolean
  onRun: (fn: () => Promise<PeopleResult>) => void
  onRemove: () => void
}) {
  const [menu, setMenu] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setMenu(false)
    }
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false)
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", esc)
    }
  }, [menu])

  const item = (label: string, fn: () => void, danger = false) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      className={danger ? "is-danger" : undefined}
      onClick={() => {
        setMenu(false)
        fn()
      }}
    >
      {label}
    </button>
  )

  let main: React.ReactNode = null
  let items: React.ReactNode[] = []
  if (r.kind === "invite") {
    main = (
      <button
        type="button"
        className={r.state === "ran_out" ? "btn btn--primary" : "btn"}
        disabled={busy}
        onClick={() => onRun(() => sendFreshLink({ inviteId: r.id }))}
      >
        {r.state === "ran_out" ? "Send a fresh link" : "Send again"}
      </button>
    )
    items = [
      item("Copy their link", () => onRun(() => copyInviteLink({ inviteId: r.id }))),
      item("Cancel invite", () => onRun(() => cancelInvite({ inviteId: r.id })), true),
    ]
  } else if (r.state === "removed") {
    main = (
      <button type="button" className="btn" disabled={busy} onClick={() => onRun(() => restoreAccess({ userId: r.id }))}>
        Give access back
      </button>
    )
  } else if (!r.you) {
    const to = r.role === "OWNER" ? "DEVELOPER" : "OWNER"
    items = [
      ...(to === "OWNER" && !canDemote
        ? []
        : [item(`Make ${to === "DEVELOPER" ? "Developer" : "Owner"}`, () => onRun(() => setPersonRole({ userId: r.id, role: to })))]),
      item("Remove access", onRemove, true),
    ]
  }

  return (
    <li className={`pp-person pp-person--${r.state}`}>
      <span className="pp-av" aria-hidden="true">
        {initials(r.name)}
      </span>
      <span className="pp-who">
        <b>
          {r.name}
          {r.you ? <em> (you)</em> : null}
        </b>
        <span>
          {r.email} · {r.role === "DEVELOPER" ? "Developer" : "Owner"}
        </span>
      </span>
      <span className="pp-when">{r.when}</span>
      <span className={`pp-pill pp-pill--${STATE_TONE[r.state]}`}>{STATE_WORDS[r.state]}</span>
      <span className="pp-acts" ref={wrap}>
        {main}
        {r.you ? <span className="pp-meta">You</span> : null}
        {items.length > 0 ? (
          <>
            <button
              type="button"
              className="pp-kebab"
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-label={`More for ${r.name}`}
              onClick={() => setMenu((v) => !v)}
            >
              ⋯
            </button>
            {menu ? (
              <span className="pp-menu" role="menu">
                {items}
              </span>
            ) : null}
          </>
        ) : null}
      </span>
    </li>
  )
}

function RemoveDialog({ r, busy, onCancel, onConfirm }: { r: PersonRow; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const keep = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    keep.current?.focus()
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCancel()
    document.addEventListener("keydown", esc)
    return () => document.removeEventListener("keydown", esc)
  }, [onCancel])
  const name = first(r.name)
  return (
    <div className="pp-scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="pp-dialog" role="alertdialog" aria-modal="true" aria-labelledby="pp-dialog-title">
        <h3 id="pp-dialog-title">Remove {name}&rsquo;s access?</h3>
        <ul>
          <li>{name} is signed out on their next page load, on every device.</li>
          <li>They can&rsquo;t sign in with {r.email} anymore.</li>
          <li>Invoices, recipes and counts they entered stay, under their name.</li>
        </ul>
        <div className="pp-row pp-row--end">
          <button ref={keep} type="button" className="btn" onClick={onCancel}>
            Keep {name}
          </button>
          <button type="button" className="btn pp-danger" disabled={busy} onClick={onConfirm}>
            Remove access
          </button>
        </div>
      </div>
    </div>
  )
}
