"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { PageHead, SubNav, useSurfaceHref } from "@/components/counter"
import { CHECKS_TABS } from "@/lib/counter/nav"
import type { CellStatus } from "@/lib/checks/status"
import type { CellView } from "@/lib/counter/adapters/checks"

/**
 * Pieces shared by the five Store checks tabs: the page head with its tabs,
 * the status glyph, the photo lightbox, a store picker and the outcome line
 * an action leaves behind.
 */

export function ChecksHead({ sub, children }: { sub: string; children?: ReactNode }) {
  const href = useSurfaceHref()
  return (
    <PageHead title="Store checks" sub={sub}>
      <SubNav items={CHECKS_TABS.map((t) => ({ ...t, href: href(t.href) }))} label="Store checks" />
      {children}
    </PageHead>
  )
}

const GLYPH: Record<CellStatus, { cls: string; mark: ReactNode; label: string }> = {
  on_time: { cls: "ck-gl--ok", mark: "✓", label: "On time" },
  late: { cls: "ck-gl--late", mark: <span>!</span>, label: "Late" },
  missed: { cls: "ck-gl--miss", mark: "✕", label: "Missed" },
  closed: { cls: "ck-gl--closed", mark: "–", label: "Store closed" },
  open: { cls: "ck-gl--open", mark: "◷", label: "Open" },
  upcoming: { cls: "ck-gl--up", mark: "·", label: "Not open yet" },
  off: { cls: "ck-gl--off", mark: "·", label: "Switched off" },
  before: { cls: "ck-gl--off", mark: "", label: "Before checks began" },
}

export function statusLabel(s: CellStatus): string {
  return GLYPH[s].label
}

export function Glyph({
  status,
  small,
  flagged,
  onClick,
  pressed,
  title,
}: {
  status: CellStatus
  small?: boolean
  flagged?: boolean
  onClick?: () => void
  pressed?: boolean
  title?: string
}) {
  const g = GLYPH[status]
  const cls = `ck-gl ${g.cls}${small ? " ck-gl--sm" : ""}${flagged ? " ck-gl--flag" : ""}`
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} aria-pressed={pressed} title={title ?? g.label} aria-label={title ?? g.label}>
        {g.mark}
      </button>
    )
  }
  return (
    <span className={cls} role="img" aria-label={title ?? g.label} title={title ?? g.label}>
      {g.mark}
    </span>
  )
}

export function Legend() {
  return (
    <div className="ck-legend">
      {(["on_time", "late", "missed", "closed"] as const).map((s) => (
        <span key={s}>
          <Glyph status={s} small />
          {GLYPH[s].label}
        </span>
      ))}
      <span>
        <Glyph status="on_time" small flagged title="On time, with an item flagged" />
        Red dot: crew flagged an item
      </span>
    </div>
  )
}

export type PhotoRef = { id: string; section: string }

export function photoSrc(id: string): string {
  return `/api/checks/photo/${encodeURIComponent(id)}`
}

/** A photo taken on a task of the shared form, before or after submit. */
export function markPhotoSrc(id: string): string {
  return `/api/checks/mark-photo/${encodeURIComponent(id)}`
}

/** Thumbnails that open one photo large. */
export function Thumbs({ photos, caption }: { photos: PhotoRef[]; caption: string }) {
  const [open, setOpen] = useState<PhotoRef | null>(null)
  if (photos.length === 0) return null
  return (
    <>
      <div className="ck-thumbs">
        {photos.map((p) => (
          <button key={p.id} type="button" className="ck-thumb" onClick={() => setOpen(p)} aria-label={`${p.section} photo`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- private, session-gated image route */}
            <img src={photoSrc(p.id)} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      {open && <Lightbox photo={open} caption={caption} onClose={() => setOpen(null)} />}
    </>
  )
}

export function Lightbox({ photo, caption, onClose, src }: { photo: PhotoRef; caption: string; onClose: () => void; src?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="ck-lightbox" role="dialog" aria-modal="true" aria-label={`${photo.section} photo`} onClick={onClose}>
      <figure onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element -- private, session-gated image route */}
        <img src={src ?? photoSrc(photo.id)} alt={`${photo.section} photo, ${caption}`} />
        <figcaption>
          <span>
            <b>{photo.section}</b> <span className="ck-meta">· {caption}</span>
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </figcaption>
      </figure>
    </div>
  )
}

/** Store chips that move the page to `?store=<id>`. */
export function StorePicker({
  stores,
  current,
  path,
  allLabel,
  extra,
}: {
  stores: Array<{ id: string; name: string }>
  current: string | null
  path: string
  allLabel?: string
  extra?: string
}) {
  const router = useRouter()
  const target = useSurfaceHref()(path)
  const go = (id: string | null) => {
    const q = new URLSearchParams(extra ?? "")
    if (id) q.set("store", id)
    else q.delete("store")
    const qs = q.toString()
    router.push(qs ? `${target}?${qs}` : target)
  }
  return (
    <div className="seg" role="group" aria-label="Store">
      {allLabel && (
        <button type="button" aria-pressed={current === null} onClick={() => go(null)}>
          {allLabel}
        </button>
      )}
      {stores.map((s) => (
        <button key={s.id} type="button" aria-pressed={current === s.id} onClick={() => go(s.id)}>
          {s.name}
        </button>
      ))}
    </div>
  )
}

export type Outcome = { ok: boolean; text: string } | null

export function OutcomeLine({ outcome }: { outcome: Outcome }) {
  if (!outcome) return null
  return (
    <span className={`ck-msg ${outcome.ok ? "ck-msg--ok" : "ck-msg--bad"}`} role="status">
      {outcome.text}
    </span>
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
        {cell.submittedAt && (<><dt>Submitted</dt><dd>{cell.submittedAt}{cell.by ? ` by ${cell.by}` : ""}</dd></>)}
        {cell.total > 0 && (<><dt>Tasks</dt><dd>{cell.done} of {cell.total} done</dd></>)}
        {!cell.submittedAt && (<><dt>Closes</dt><dd>{cell.dueLabel}</dd></>)}
        {cell.meta && !cell.submittedAt && (<><dt>Now</dt><dd>{cell.meta}</dd></>)}
      </dl>
      {cell.people.length > 0 && (
        <div className="ck-people" aria-label="Who worked on it">
          {cell.people.map((p) => (
            <span key={p}>
              {p} · {cell.log.filter((l) => l.by === p && (l.action === "done" || l.action === "note")).length} tasks
            </span>
          ))}
        </div>
      )}
      {hasLog ? (
        <div className="ck-log" aria-label="Every tick, with its time">
          {cell.log.map((l) => (
            <div key={l.id}>
              <time>{l.at}</time>
              <span className={l.action === "undone" ? "undone" : l.action === "submitted" ? "sent" : ""}>
                {l.action === "undone" ? `Unticked: ${l.text}` : l.text}
                {l.note ? <span className="ck-tone-warn"> · {l.note}</span> : null}
                <span className="who"> · {l.by}</span>
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
