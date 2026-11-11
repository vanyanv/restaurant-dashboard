"use client"

import { useEffect, useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { reviewCheckPhoto } from "@/lib/counter/actions/checks"
import type { CellView } from "@/lib/counter/adapters/checks"
import { Glyph, Lightbox, markPhotoSrc, OutcomeLine, photoSrc, type Outcome } from "./checks-ui"

/**
 * The parts of Store checks "made plain", shared by the desk and the phone so
 * the two say the same thing in the same words: the sentence and big figure
 * a page opens with, when the ticks happened, the record task by task, and
 * each photo with the owner's Looks good / Redo.
 */

/** One sentence, then the figure that answers it, then the change. */
export function PlainHead({
  sentence,
  figure,
  figureLabel,
  delta,
  deltaLabel,
}: {
  sentence: string
  figure: string | null
  figureLabel: string
  delta: number | null
  deltaLabel: string
}) {
  return (
    <div className="ck-plain">
      <p className="ck-plain__say">{sentence}</p>
      <div className="ck-plain__fig">
        <b>{figure ?? "—"}</b>
        <span className="ck-meta">{figureLabel}</span>
        {delta !== null && delta !== 0 && (
          <span className={`ck-plain__delta ${delta > 0 ? "up" : "down"}`}>
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)} pts {deltaLabel}
          </span>
        )}
        {delta === 0 && <span className="ck-meta">Same as {deltaLabel.replace(/^vs /, "")}</span>}
      </div>
    </div>
  )
}

/** When the ticks happened against the due time and the grace after it. */
export function TickStrip({ cell }: { cell: CellView }) {
  const t = cell.timeline
  if (!t) return null
  return (
    <div className="ck-tl" aria-label={`Ticks from ${t.startLabel} to ${t.endLabel}, due ${t.dueLabel}`}>
      <span className="ck-mono">When tasks were ticked</span>
      <div className="ck-tl__bar">
        <i className="ck-tl__grace" style={{ left: `${t.duePct}%` }} />
        {t.ticks.map((k, i) => (
          <i key={i} className={`ck-tl__tick${k.late ? " late" : ""}`} style={{ left: `${k.pct}%` }} />
        ))}
        <i className="ck-tl__due" style={{ left: `${t.duePct}%` }} />
      </div>
      <div className="ck-tl__labels ck-mono">
        <span>{t.startLabel}</span>
        <span>due {t.dueLabel}</span>
        <span>{t.endLabel}</span>
      </div>
    </div>
  )
}

/** "9 tasks ticked 1:10–1:13 am by Jose M." */
export function BurstNote({ cell }: { cell: CellView }) {
  if (!cell.burst) return null
  return (
    <div className="ck-burst" role="note">
      <b>{cell.burst}.</b>
      <span className="ck-meta"> That many at once usually means they were ticked at the end, not as the work was done.</span>
    </div>
  )
}

/** The record task by task, a fold per section with its count; missed tasks first in each. */
export function RecordSections({ cell, open }: { cell: CellView; open?: boolean }) {
  if (cell.tasks.length === 0) return null
  return (
    <div className="ck-rec">
      {cell.tasks.map((s) => {
        const done = s.items.filter((i) => i.done).length
        return (
          <details key={s.section} className="ck-rec__sec" open={open}>
            <summary>
              <span>{s.section}</span>
              <span className={done === s.items.length ? "ck-meta" : "ck-tone-bad"}>
                {done} of {s.items.length}
              </span>
            </summary>
            <ul>
              {s.items.map((i) => (
                <li key={i.item} className={i.done ? "" : "miss"}>
                  <span className="g" aria-hidden>
                    {i.done ? (i.late ? "◐" : "✓") : "✕"}
                  </span>
                  <span>
                    {i.item}
                    {i.note && <span className="ck-tone-warn"> · {i.note}</span>}
                    <span className="ck-meta">
                      {i.done ? ` · ${i.by ?? "crew"}${i.at ? ` · ${i.at}` : ""}${i.late ? " · late" : ""}${i.photo ? " · photo" : ""}` : " · missed"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )
      })}
    </div>
  )
}

/** Each task's photo, large enough to judge, with Looks good / Redo. */
export function PhotoReview({ cell, caption }: { cell: CellView; caption: string }) {
  const [open, setOpen] = useState<{ id: string; task: string } | null>(null)
  if (cell.markPhotos.length === 0) return null
  return (
    <div className="ck-prv">
      <span className="ck-mono">Photos · {cell.markPhotos.length}</span>
      <div className="ck-prv__grid">
        {cell.markPhotos.map((p) => (
          <PhotoCard key={p.id} p={p} onOpen={() => setOpen({ id: p.id, task: p.task })} />
        ))}
      </div>
      {open && (
        <Lightbox photo={{ id: open.id, section: open.task }} src={markPhotoSrc(open.id)} caption={caption} onClose={() => setOpen(null)} />
      )}
    </div>
  )
}

function PhotoCard({ p, onOpen }: { p: CellView["markPhotos"][number]; onOpen: () => void }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState("")
  const [outcome, setOutcome] = useState<Outcome>(null)
  const send = (verdict: "ok" | "redo") =>
    start(async () => {
      const r = await reviewCheckPhoto({ markId: p.id, verdict, note: verdict === "redo" ? note : undefined })
      setOutcome(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error })
      if (r.ok) {
        setAsking(false)
        router.refresh()
      }
    })
  return (
    <figure className={`ck-prv__card${p.review === "redo" ? " is-redo" : ""}`}>
      <button type="button" className="ck-prv__img" onClick={onOpen} aria-label={`Open ${p.task} photo`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- private, session-gated image route */}
        <img src={markPhotoSrc(p.id)} alt="" loading="lazy" />
      </button>
      <figcaption>
        <b>{p.task}</b>
        <span className="ck-meta">
          {p.by} · {p.at}
        </span>
        {p.review === "ok" && <span className="ck-tone-good">Looks good</span>}
        {p.review === "redo" && <span className="ck-tone-bad">Sent back{p.reviewNote ? `: ${p.reviewNote}` : ""}</span>}
      </figcaption>
      {p.review !== "redo" &&
        (asking ? (
          <div className="ck-prv__ask">
            <input
              className="ck-input"
              value={note}
              maxLength={200}
              placeholder="What needs redoing? (optional)"
              aria-label={`What needs redoing on ${p.task}`}
              onChange={(e) => setNote(e.target.value)}
            />
            <span className="ck-row">
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => send("redo")}>
                {busy ? "Sending…" : "Send it back"}
              </button>
              <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => setAsking(false)}>
                Cancel
              </button>
            </span>
          </div>
        ) : (
          <div className="ck-prv__act">
            <button type="button" className="ok" disabled={busy || p.review === "ok"} onClick={() => send("ok")}>
              {p.review === "ok" ? "✓ Looks good" : "Looks good"}
            </button>
            <button type="button" className="redo" disabled={busy} onClick={() => setAsking(true)}>
              Redo
            </button>
          </div>
        ))}
      <OutcomeLine outcome={outcome} />
    </figure>
  )
}

const DAY_FMT: Intl.DateTimeFormatOptions = { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }

/**
 * One check on one day: status, who took part, and the full log, every tick,
 * untick and note with its time and person, then the submit. Today and
 * History both open it.
 */
export function CheckDetail({ store, label, cell }: { store: string; label: string; cell: CellView }) {
  const [open, setOpen] = useState<{ id: string; section: string; mark: boolean } | null>(null)
  const caption = `${store} · ${label} · ${cell.day}`
  const hasLog = cell.log.length > 0
  const hasRecord = cell.tasks.length > 0
  return (
    <div className="ck-drawer">
      <div>
        <div className="ck-mono">
          {store} · {label}
        </div>
        <h3>{new Date(`${cell.day}T12:00:00Z`).toLocaleDateString("en-US", DAY_FMT)}</h3>
      </div>
      <div className="ck-st">
        <Glyph status={cell.status} flagged={cell.flags.length > 0} />
        {cell.label}
      </div>
      <dl className="ck-kv">
        {cell.submittedAt && cell.autoClosed && (<><dt>Closed</dt><dd>{cell.submittedAt} · closed itself</dd></>)}
        {cell.submittedAt && !cell.autoClosed && (<><dt>Submitted</dt><dd>{cell.submittedAt}{cell.by ? ` by ${cell.by}` : ""}</dd></>)}
        {cell.total > 0 && (<><dt>Tasks</dt><dd>{cell.done} of {cell.total} done</dd></>)}
        {!cell.submittedAt && (<><dt>Closes</dt><dd>{cell.dueLabel}</dd></>)}
        {cell.meta && !cell.submittedAt && (<><dt>Now</dt><dd>{cell.meta}</dd></>)}
      </dl>
      {cell.missed.length > 0 && (
        <div className="ck-missed" aria-label="Tasks nobody ticked">
          <b>
            {cell.missed.length === cell.total ? `Nothing was ticked · all ${cell.total} missed` : `Missed · ${cell.missed.length}`}
          </b>
          {cell.missed.length < cell.total && (
            <ul>
              {cell.missed.map((m) => (
                <li key={`${m.section}:${m.item}`}>
                  {m.item} <span className="ck-meta">· {m.section}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <BurstNote cell={cell} />
      <TickStrip cell={cell} />
      <PhotoReview cell={cell} caption={caption} />
      <RecordSections cell={cell} />
      {cell.people.length > 0 && (
        <div className="ck-people" aria-label="Who worked on it">
          {cell.people.map((p) => (
            <span key={p}>
              {p} · {taskCount(cell.log.filter((l) => l.by === p && (l.action === "done" || l.action === "note")).length)}
            </span>
          ))}
        </div>
      )}
      {hasLog ? (
        <details className="ck-logfold" open={!hasRecord}>
        <summary className="ck-mono">Every tick, untick and note · {cell.log.length}</summary>
        <div className="ck-log" aria-label="Every tick, with its time">
          {cell.log.map((l) => (
            <div key={l.id}>
              <time>{l.at}</time>
              <span className={l.action === "undone" ? "undone" : l.action === "submitted" || l.action === "closed" ? "sent" : ""}>
                {l.action === "undone" ? `Unticked: ${l.text}` : l.text}
                {l.note ? <span className="ck-tone-warn"> · {l.note}</span> : null}
                {l.by ? <span className="who"> · {l.by}</span> : null}
              </span>
              {l.photo ? (
                <button type="button" style={{ padding: 0, border: 0, background: "none", cursor: "zoom-in" }} onClick={() => setOpen({ id: l.id, section: l.text, mark: true })} aria-label={`Open ${l.text} photo`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, session-gated image route */}
                  <img src={markPhotoSrc(l.id)} alt="" loading="lazy" />
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
        </details>
      ) : (
        cell.photos.length > 0 && (
          <div className="ck-big">
            {cell.photos.map((p) => (
              <button key={p.id} type="button" onClick={() => setOpen({ id: p.id, section: p.section, mark: false })} aria-label={`Open ${p.section} photo`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- private, session-gated image route */}
                <img src={photoSrc(p.id)} alt="" loading="lazy" />
                <span className="ck-mono">{p.section}</span>
              </button>
            ))}
          </div>
        )
      )}
      {cell.flags.length > 0 && !hasLog && (
        <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 4 }}>
          {cell.flags.map((f) => (
            <li key={f.item} className="ck-meta">
              <b className="ck-tone-warn">Flagged</b> {f.item}: “{f.note}”
            </li>
          ))}
        </ul>
      )}
      {!hasLog && cell.live && <span className="ck-meta">Nobody has ticked anything yet.</span>}
      {open && (
        <Lightbox
          photo={{ id: open.id, section: open.section }}
          src={open.mark ? markPhotoSrc(open.id) : undefined}
          caption={caption}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

function taskCount(n: number): string {
  return `${n} task${n === 1 ? "" : "s"}`
}

/**
 * One check, full screen on a phone, with Back at the top. The page under it
 * stops scrolling while it is open, and the phone's back gesture closes it
 * instead of leaving the page.
 */
export function PhoneView({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    // A history entry of its own, so the system back closes the view.
    window.history.pushState({ ckView: true }, "")
    const onPop = () => onBack()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") window.history.back()
    }
    window.addEventListener("popstate", onPop)
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener("popstate", onPop)
      window.removeEventListener("keydown", onKey)
    }
    // Opened once per view; onBack changes identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="ckp-view" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ckp-view__bar">
        <button type="button" className="ckp-back" onClick={() => window.history.back()}>
          ‹ Back
        </button>
        <span className="ck-mono">{title}</span>
      </div>
      <div className="ckp-view__body">{children}</div>
    </div>
  )
}
