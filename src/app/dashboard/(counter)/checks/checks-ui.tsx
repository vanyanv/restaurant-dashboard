"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { PageHead, SubNav, useSurfaceHref } from "@/components/counter"
import { CHECKS_TABS } from "@/lib/counter/nav"
import type { CellStatus } from "@/lib/checks/status"

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

export function Lightbox({ photo, caption, onClose }: { photo: PhotoRef; caption: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="ck-lightbox" role="dialog" aria-modal="true" aria-label={`${photo.section} photo`} onClick={onClose}>
      <figure onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element -- private, session-gated image route */}
        <img src={photoSrc(photo.id)} alt={`${photo.section} photo, ${caption}`} />
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
