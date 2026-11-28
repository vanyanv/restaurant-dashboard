"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { ModalDialog } from "@/components/counter/modal-dialog"
import { Answer, Button, ServiceMark, freshTime, useAct, type ActResult } from "@/components/counter/ui"
import { exportEnvFile, lockKeys, revealKey, unlockKeys } from "@/lib/counter/actions/developer"
import type { DeveloperKeyRow, DeveloperKeys } from "@/lib/counter/adapters/developer"
import { copyText, downloadText, selectText } from "./developer-copy"

/**
 * The Keys tab: every key by name, where it lives, and (after the password)
 * its value.
 *
 * ## What this file may and may not do with a value
 *
 * A value reaches the browser only from `revealKey` / `exportEnvFile`, after
 * `unlockKeys`. It is held in this component's state and nowhere else: not
 * in localStorage or sessionStorage, not in the address, not in a `data-`
 * attribute, not in a log line. It is dropped when the keys are locked, when
 * the unlock runs out, and when the tab is left: the page mounts
 * `KeysPanel` under a key that changes with the open tab, so leaving the tab
 * throws this state away. The typed password is read once from the form and
 * never stored at all.
 *
 * The server enforces every rule again (see the actions' docblock); this is
 * the half that keeps a value from lingering on a screen.
 */

type Filter = "all" | "missing" | "unused" | "github"

/** What to do once the password has been accepted. */
type Pending = { kind: "reveal" | "copy"; name: string } | { kind: "export" }

type Said = { tone: "good" | "bad"; text: string }

type Exported = { filename: string; text: string; count: number; skipped: string[] }

/** How many rows show before "Show all". */
const CAP = 7
const MASK = "••••••••••••"

const UNLOCK_FAILED = "That didn't work. Check the password and try again."

/** A refusal from the server, in words. `locked` is handled by asking for the password again. */
const REFUSED: Record<string, string> = {
  forbidden: "Only a developer can see key values. Sign in again as one.",
  unknown: "That key can't be shown here.",
  notSet: "That key isn't set on this server.",
  withheld: "That key is never shown. Make your own for local work.",
  unavailable: "Showing values is switched off on this server.",
  network: "Couldn't reach the server. Try again.",
}
const refusedWords = (code: string) => REFUSED[code] ?? "That didn't work. Try again."

/** Why a row has no value to show, in words. */
function whyNoValue(row: DeveloperKeyRow): string {
  if (row.neverShown) return "Never shown. Make your own for local work."
  switch (row.state) {
    case "missing":
      return "Not set on this server"
    case "githubOnly":
      return "Kept in GitHub, which never shows a saved secret"
    case "unused":
      return "Vercel holds it, nothing in the code reads it"
    case "notNeededHere":
      return row.localNote ?? "Not set here, and nothing needs it"
    default:
      return "Not set on this server"
  }
}

/** Where Vercel keeps it, as one short pill. */
function vercelWords(targets: readonly string[]): string {
  return targets.length >= 3 || targets.length === 0 ? "Vercel" : `Vercel: ${targets.join(", ")}`
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

function KeysAnswer({ keys }: { keys: DeveloperKeys }) {
  const { missing, unused } = keys.counts
  return (
    <Answer>
      <b>
        {keys.rows.length} {plural(keys.rows.length, "key", "keys")}
      </b>{" "}
      in all.{" "}
      {missing === 0
        ? "None are missing on this server"
        : `${missing} ${plural(missing, "is", "are")} missing on this server`}
      {keys.vercelStatus.ok
        ? unused === 0
          ? " and every one Vercel holds is used."
          : ` and ${unused} ${plural(unused, "is", "are")} used by nothing.`
        : "."}
    </Answer>
  )
}

function UnlockDialog({
  onClose,
  onUnlocked,
}: {
  onClose: () => void
  onUnlocked: (expiresAt: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // False once the dialog is closed. An answer to a password that was typed
  // and then walked away from must not unlock anything.
  const open = useRef(true)
  useEffect(() => {
    open.current = true
    return () => {
      open.current = false
    }
  }, [])

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    // Read once, from the field, and never kept: not in state, not in a log.
    const password = String(new FormData(form).get("password") ?? "")
    if (password === "") return
    setBusy(true)
    setFailed(false)
    let result: Awaited<ReturnType<typeof unlockKeys>>
    try {
      result = await unlockKeys(password)
    } catch {
      result = { ok: false }
    }
    if (!open.current) return
    form.reset()
    setBusy(false)
    if (result.ok) {
      onUnlocked(result.expiresAt)
      return
    }
    // One message whatever went wrong: the server gives no reason on purpose.
    setFailed(true)
    form.querySelector<HTMLInputElement>("input")?.focus()
  }

  return (
    <ModalDialog className="dv-scrim" onClose={onClose} aria-labelledby="dv-unlock-title">
      <form className="dv-dialog" onSubmit={submit}>
        <h1 id="dv-unlock-title">Type your password</h1>
        <p>Key values stay hidden until you do. They open for five minutes, and every reveal and every "Copy all" is logged.</p>
        <label>
          Your password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            autoFocus
            aria-describedby="dv-unlock-err"
            aria-invalid={failed || undefined}
          />
        </label>
        <p id="dv-unlock-err" className="dv-dialog__err" role="alert">
          {failed ? UNLOCK_FAILED : null}
        </p>
        <div className="cu-btnrow">
          <div className="cu-btnrow__in">
            <Button type="submit" variant="primary" state={busy ? "busy" : undefined}>
              Unlock
            </Button>
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </form>
    </ModalDialog>
  )
}

function KeyRow({
  row,
  value,
  canAsk,
  stateOf,
  onReveal,
  onHide,
  onCopy,
}: {
  row: DeveloperKeyRow
  /** The revealed value, when there is one on screen. */
  value: string | undefined
  /** False when this server never hands out values. */
  canAsk: boolean
  stateOf: (key: string) => ReturnType<ReturnType<typeof useAct>["stateOf"]>
  onReveal: () => void
  onHide: () => void
  onCopy: () => void
}) {
  const offered = row.canReveal && canAsk
  return (
    <li className="dv-krow" data-key-row={row.name}>
      <div className="dv-kid">
        <span className="dv-tile">
          <ServiceMark icon={row.icon} />
        </span>
        <div>
          <div className="dv-kname">{row.name}</div>
          <div className="dv-sub">{row.connectionName ?? "Not on the app's list"}</div>
        </div>
      </div>

      {value !== undefined ? (
        <span className="dv-kval dv-kval--shown" data-revealed="">
          {value}
        </span>
      ) : row.canReveal ? (
        row.secret ? (
          <span className="dv-kval dv-kval--mask" aria-label="Hidden">
            {MASK}
          </span>
        ) : (
          <span className="dv-kval">Not a secret</span>
        )
      ) : (
        <span className="dv-kval">{whyNoValue(row)}</span>
      )}

      <div className="dv-where">
        {row.vercel ? <span className="dv-pill">{vercelWords(row.vercel.targets)}</span> : null}
        {row.github ? <span className="dv-pill">GitHub</span> : null}
        {row.state === "missing" ? <span className="dv-pill dv-pill--bad">Missing</span> : null}
        {row.state === "unused" ? <span className="dv-pill dv-pill--warn">Used by nothing</span> : null}
      </div>

      <div className="dv-kact">
        {offered ? (
          <>
            {value !== undefined ? (
              <Button onClick={onHide} aria-label={`Hide ${row.name}`}>
                Hide
              </Button>
            ) : (
              <Button state={stateOf(`reveal:${row.name}`)} doneLabel="Shown" onClick={onReveal} aria-label={`Reveal ${row.name}`}>
                Reveal
              </Button>
            )}
            <Button state={stateOf(`copy:${row.name}`)} doneLabel="Copied" onClick={onCopy} aria-label={`Copy ${row.name}`}>
              Copy
            </Button>
          </>
        ) : null}
      </div>
    </li>
  )
}

export function KeysPanel({ keys }: { keys: DeveloperKeys }) {
  const { act, stateOf } = useAct()
  const [filter, setFilter] = useState<Filter>("all")
  const [showAll, setShowAll] = useState(false)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [exported, setExported] = useState<Exported | null>(null)
  const [asking, setAsking] = useState<Pending | null>(null)
  const [said, setSaid] = useState<Said | null>(null)
  const list = useRef<HTMLUListElement>(null)

  const unlocked = expiresAt !== null
  const canAsk = keys.valuesAvailable

  // Which unlock we are in. It moves on every time an unlock ends (the time
  // runs out, "Lock now", the server says locked, the panel goes away), and
  // an answer that was asked for under an earlier number is thrown away
  // unread: a value must never land on screen after "Locked".
  const unlockRun = useRef(0)
  useEffect(
    () => () => {
      unlockRun.current++
    },
    [],
  )
  /** Marks an answer that came back after its unlock ended. Never shown, never worded. */
  const LATE = "late"

  /** Drops everything that came from behind the password. */
  const forget = () => {
    unlockRun.current++
    setValues({})
    setExported(null)
    setExpiresAt(null)
  }

  // When the five minutes are up, every value on screen goes with them.
  useEffect(() => {
    if (expiresAt === null) return
    const t = setTimeout(() => {
      unlockRun.current++
      setValues({})
      setExported(null)
      setExpiresAt(null)
      setSaid({ tone: "good", text: "Locked again. The values that were showing are gone." })
    }, Math.max(0, expiresAt - Date.now()))
    return () => clearTimeout(t)
  }, [expiresAt])

  /** The server said the unlock is gone: drop what we hold and ask again. */
  const relock = (then: Pending) => {
    forget()
    setAsking(then)
  }

  const refused = (code: string, then: Pending) => {
    if (code === LATE) return
    if (code === "locked") relock(then)
    else setSaid({ tone: "bad", text: refusedWords(code) })
  }

  /** Shows a value and selects it, for a browser that would not copy. */
  const showSelected = (name: string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }))
    requestAnimationFrame(() =>
      selectText(list.current?.querySelector(`[data-key-row="${name}"] [data-revealed]`) ?? null),
    )
  }

  const reveal = (name: string) => {
    const then: Pending = { kind: "reveal", name }
    setSaid(null)
    act(
      `reveal:${name}`,
      async (): Promise<ActResult> => {
        const run = unlockRun.current
        const r = await revealKey(name)
        if (run !== unlockRun.current) return { ok: false, error: LATE }
        if (!r.ok) return { ok: false, error: r.code }
        setValues((v) => ({ ...v, [name]: r.value }))
        return { ok: true }
      },
      { onFailed: (code) => refused(code, then) },
    )
  }

  const copy = (name: string) => {
    const then: Pending = { kind: "copy", name }
    setSaid(null)
    act(
      `copy:${name}`,
      async (): Promise<ActResult> => {
        const run = unlockRun.current
        let value = values[name]
        if (value === undefined) {
          const r = await revealKey(name)
          if (run !== unlockRun.current) return { ok: false, error: LATE }
          if (!r.ok) return { ok: false, error: r.code }
          value = r.value
        }
        if (await copyText(value)) return { ok: true }
        if (run !== unlockRun.current) return { ok: false, error: LATE }
        showSelected(name, value)
        return { ok: false, error: "clipboard" }
      },
      {
        onFailed: (code) =>
          code === "clipboard"
            ? setSaid({ tone: "bad", text: `Couldn't copy from here. ${name} is shown and selected: copy it by hand, or press Copy again.` })
            : refused(code, then),
      },
    )
  }

  const exportAll = () => {
    setSaid(null)
    act(
      "export",
      async (): Promise<ActResult> => {
        const run = unlockRun.current
        const r = await exportEnvFile()
        if (run !== unlockRun.current) return { ok: false, error: LATE }
        if (!r.ok) return { ok: false, error: r.code }
        setExported({ filename: r.filename, text: r.text, count: r.count, skipped: r.skipped })
        if (await copyText(r.text)) {
          if (run !== unlockRun.current) return { ok: false, error: LATE }
          setSaid({ tone: "good", text: `Copied ${r.count} ${plural(r.count, "key", "keys")} as ${r.filename}.` })
          return { ok: true }
        }
        return { ok: false, error: run !== unlockRun.current ? LATE : "clipboard" }
      },
      {
        onFailed: (code) =>
          code === "clipboard"
            ? setSaid({ tone: "bad", text: "Couldn't copy from here. Download the file instead." })
            : refused(code, { kind: "export" }),
      },
    )
  }

  const run = (p: Pending) => {
    if (p.kind === "export") exportAll()
    else if (p.kind === "reveal") reveal(p.name)
    else copy(p.name)
  }

  /** Every way to a value goes through here: locked means the password first. */
  const ask = (p: Pending) => {
    if (!canAsk) return
    // A value already on screen can be copied without another trip.
    if (unlocked) run(p)
    else setAsking(p)
  }

  const lockNow = () => {
    forget()
    setSaid({ tone: "good", text: "Locked. The values that were showing are gone." })
    void lockKeys().catch(() => {})
  }

  const counts: Record<Filter, number> = {
    all: keys.rows.length,
    missing: keys.counts.missing,
    unused: keys.counts.unused,
    github: keys.counts.githubOnly,
  }
  const chips: Array<[Filter, string]> = [
    ["all", "All"],
    ["missing", "Missing"],
    // Without Vercel's answer nobody knows what is unused, so the chip is left out.
    ...(keys.vercelStatus.ok ? ([["unused", "Unused"]] as Array<[Filter, string]>) : []),
    ["github", "GitHub only"],
  ]
  const matches = (r: DeveloperKeyRow) =>
    filter === "all" ||
    (filter === "missing" && r.state === "missing") ||
    (filter === "unused" && r.state === "unused") ||
    (filter === "github" && r.state === "githubOnly")
  const filtered = keys.rows.filter(matches)
  const shown = showAll ? filtered : filtered.slice(0, CAP)

  return (
    <div className="dv-panel cu-stack">
      <KeysAnswer keys={keys} />

      {!keys.vercelStatus.ok ? (
        <p className="dv-note" role="note">
          <b>
            {keys.vercelStatus.reason === "not set up"
              ? "Vercel isn't connected on this server"
              : "Couldn't reach Vercel"}
          </b>
          , so where each key lives is unknown. Whether it is set on this server still shows.
        </p>
      ) : null}

      {canAsk ? (
        <div className="dv-toolbar">
          <Button variant="primary" state={stateOf("export")} doneLabel="Copied" onClick={() => ask({ kind: "export" })}>
            Copy all as .env.local
          </Button>
          {exported ? (
            <Button onClick={() => downloadText(exported.filename, exported.text)}>Download {exported.filename}</Button>
          ) : null}
          {unlocked ? (
            <>
              <span className="dv-mono">Unlocked until {freshTime(expiresAt)}</span>
              <button type="button" className="dv-link" onClick={lockNow}>
                Lock now
              </button>
            </>
          ) : (
            <span className="dv-mono">Asks for your password · every reveal is logged</span>
          )}
        </div>
      ) : (
        <p className="dv-note" role="note">
          {keys.valuesOffReason === "otherAccount" ? (
            <b>Values can't be shown on this account.</b>
          ) : (
            <>
              <b>Showing values is switched off</b> until the <span className="dv-kname">DEVELOPER_PORTAL_ACCOUNT_ID</span> setting is
              added on the server.
            </>
          )}{" "}
          Names, where each key lives and what is missing still show.
        </p>
      )}

      {/* Always in the page, so a screen reader hears what a tap did. */}
      <p className={`dv-said${said ? ` cu-notice cu-notice--${said.tone}` : ""}`} role="status">
        {said ? said.text : "\u00a0"}
      </p>

      {exported && exported.skipped.length > 0 ? (
        <p className="dv-note" role="note">
          <b>
            {exported.skipped.length} {plural(exported.skipped.length, "key", "keys")} couldn't be written to the file:
          </b>{" "}
          <span className="dv-kname">{exported.skipped.join(", ")}</span>. Copy {plural(exported.skipped.length, "it", "them")} one at a
          time.
        </p>
      ) : null}

      <div>
        <div className="dv-chips cu-chips" role="group" aria-label="Show">
          {chips.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="dv-chip"
              aria-pressed={filter === id}
              onClick={() => {
                setFilter(id)
                setShowAll(false)
              }}
            >
              {label} {counts[id]}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <p className="dv-sub">Nothing here.</p>
        ) : (
          <ul key={filter} className="dv-keys cu-filtered" ref={list} aria-label="Keys">
            {shown.map((row) => (
              <KeyRow
                key={row.name}
                row={row}
                value={values[row.name]}
                canAsk={canAsk}
                stateOf={stateOf}
                onReveal={() => ask({ kind: "reveal", name: row.name })}
                onHide={() =>
                  setValues((v) => {
                    const next = { ...v }
                    delete next[row.name]
                    return next
                  })
                }
                onCopy={() => ask({ kind: "copy", name: row.name })}
              />
            ))}
          </ul>
        )}
      </div>

      {filtered.length > CAP ? (
        <div>
          <Button onClick={() => setShowAll((s) => !s)}>{showAll ? "Show fewer" : `Show all ${filtered.length}`}</Button>
        </div>
      ) : null}

      {asking ? (
        <UnlockDialog
          onClose={() => setAsking(null)}
          onUnlocked={(iso) => {
            const then = asking
            setAsking(null)
            setExpiresAt(new Date(iso).getTime())
            run(then)
          }}
        />
      ) : null}
    </div>
  )
}
