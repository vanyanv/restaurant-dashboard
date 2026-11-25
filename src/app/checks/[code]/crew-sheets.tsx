"use client"

import { useState, type ReactNode } from "react"
import { Drawer, DrawerBackdrop, DrawerContent, DrawerTitle } from "@ui-sdk/react/drawer"
import type { CrewMarkState } from "@/lib/checks/crew"
import type { Tx } from "./crew-check-client"

/**
 * The crew page's small sheets (the ⋯ menu, the photo check, a done task, a
 * note) as ui-sdk Drawers, the same slide-up sheet as the how-to: crew can
 * drag one down to close it, and every pop-up on the page moves the same way.
 *
 * Its own module so the page loads it with next/dynamic: the drawer stays out
 * of the checklist's first load (the route sits near its bundle budget), and
 * the page fetches this chunk as soon as it is up, so a sheet still opens in
 * a back room with no signal.
 *
 * The page mounts a sheet while it has something to show and unmounts it in
 * `onClosed`, after the slide-out. A button that ends the sheet calls `close`,
 * optionally with what to do once it is gone; opening the camera is the one
 * thing done straight away, because the browser only opens the file picker
 * inside the tap itself.
 */
function CrewDrawer({
  label,
  title,
  onClosed,
  dismissible = true,
  children,
}: {
  label: string
  /** Shown as the sheet's heading when given. */
  title?: ReactNode
  onClosed: () => void
  /** False while a photo uploads: drag, Escape and a tap outside do nothing. */
  dismissible?: boolean
  children: (close: (then?: () => void) => void) => ReactNode
}) {
  const [open, setOpen] = useState(true)
  /** What to do once the sheet has slid away, set by the button that closed it. */
  const [after, setAfter] = useState<(() => void) | undefined>(undefined)
  const close = (then?: () => void) => {
    setAfter(() => then)
    setOpen(false)
  }
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => setOpen(next)}
      dismissible={dismissible}
      onOpenChangeComplete={(next) => {
        if (next) return
        after?.()
        onClosed()
      }}
    >
      <DrawerBackdrop className="ckb__howdim" />
      <DrawerContent className="ckb__howsheet" aria-label={label}>
        <div className="ckb__grip" aria-hidden />
        <div className="ckb__sheetbody">
          {title !== undefined && <DrawerTitle>{title}</DrawerTitle>}
          {children(close)}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function CameraIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 7h4l2-3h6l2 3h4v13H3z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

/** The ⋯ on a task not done yet: finish it with a note, or take its photo. */
export function TaskMenu({
  t,
  title,
  photo,
  onNote,
  onPhoto,
  onClosed,
}: {
  t: Tx
  title: string
  photo: boolean
  /** Runs once the menu has slid away, so the note sheet rises on its own. */
  onNote: () => void
  onPhoto: () => void
  onClosed: () => void
}) {
  return (
    <CrewDrawer label={title} title={title} onClosed={onClosed}>
      {(close) => (
        <>
          {photo && (
            <button
              type="button"
              className="ckc__btn"
              onClick={() => {
                onPhoto()
                close()
              }}
            >
              <CameraIcon /> {t.takePhoto}
            </button>
          )}
          <button type="button" className={`ckc__btn${photo ? " ckc__btn--light" : ""}`} onClick={() => close(onNote)}>
            {t.doneWithNote}
          </button>
          <p className="ckc__dim" style={{ margin: 0, fontSize: 13 }}>
            {t.flagHelp}
          </p>
          <button type="button" className="ckc__btn ckc__btn--ghost" onClick={() => close()}>
            {t.cancel}
          </button>
        </>
      )}
    </CrewDrawer>
  )
}

export function PhotoSheet({
  t,
  title,
  url,
  error,
  onUse,
  onRetake,
  onClosed,
}: {
  t: Tx
  title: string
  url: string
  error: string
  /** Sends the photo; true once it is saved or queued. */
  onUse: () => Promise<boolean>
  /** Opens the camera again for the same task. */
  onRetake: () => void
  onClosed: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <CrewDrawer label={t.photoTitle} onClosed={onClosed} dismissible={!busy}>
      {(close) => (
        <>
          <span className="ck-mono">{t.photoTitle}</span>
          <DrawerTitle>{title}</DrawerTitle>
          <img className="ckb__preview" src={url} alt="" />
          <div className="ckc__err" role="alert">
            {busy ? t.uploading : error}
          </div>
          <button
            type="button"
            className="ckc__btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const ok = await onUse()
              setBusy(false)
              if (ok) close()
            }}
          >
            {busy ? t.uploading : t.photoUse}
          </button>
          <button
            type="button"
            className="ckc__btn ckc__btn--ghost"
            disabled={busy}
            onClick={() => {
              onRetake()
              close()
            }}
          >
            {t.retake}
          </button>
        </>
      )}
    </CrewDrawer>
  )
}

export function DoneSheet({
  t,
  title,
  mark,
  mine,
  onUndo,
  onPhoto,
  onClosed,
}: {
  t: Tx
  title: string
  mark: CrewMarkState
  mine: boolean
  onUndo: () => void
  /** A photo task finished with a note: the photo can still be added. */
  onPhoto?: () => void
  onClosed: () => void
}) {
  return (
    <CrewDrawer label={t.doneSheetTitle} title={t.doneSheetTitle} onClosed={onClosed}>
      {(close) => (
        <>
          <b>{title}</b>
          <p className="ckc__dim" style={{ margin: 0, fontSize: 14 }}>
            {mine ? t.doneByYou(mark.at) : t.doneByAt(mark.by, mark.at)}
            {mark.hasPhoto ? ` ${t.withPhoto}` : ""}
          </p>
          {mark.note && (
            <p className="ckc__dim" style={{ margin: 0, fontSize: 13 }}>
              {t.needsAttention} · {mark.note}
            </p>
          )}
          <button type="button" className="ckc__btn" onClick={() => close()}>
            ✓ {t.keepDone}
          </button>
          {onPhoto && (
            <button
              type="button"
              className="ckc__btn ckc__btn--light"
              onClick={() => {
                onPhoto()
                close()
              }}
            >
              <CameraIcon /> {t.addPhoto}
            </button>
          )}
          <button
            type="button"
            className="ckc__btn ckc__btn--ghost"
            onClick={() => {
              onUndo()
              close()
            }}
          >
            {mine ? t.undoMine : t.undoTheirs(mark.by)}
          </button>
          <p className="ckc__dim" style={{ margin: 0, fontSize: 12.5 }}>
            {t.undoWarn}
          </p>
        </>
      )}
    </CrewDrawer>
  )
}

export function FlagSheet({
  t,
  current,
  onSave,
  onRemove,
  onClosed,
}: {
  t: Tx
  current: string
  onSave: (note: string) => void
  onRemove: () => void
  onClosed: () => void
}) {
  const [note, setNote] = useState(current)
  return (
    <CrewDrawer label={t.flagTitle} title={t.flagTitle} onClosed={onClosed}>
      {(close) => (
        <>
          <p className="ckc__dim" style={{ margin: 0, fontSize: 13 }}>
            {t.flagHelp}
          </p>
          <div className="ckc__chips">
            {t.flagChips.map((c) => (
              <button key={c} type="button" onClick={() => setNote(c)}>
                {c}
              </button>
            ))}
          </div>
          <textarea value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} aria-label={t.flagTitle} />
          <button
            type="button"
            className="ckc__btn"
            disabled={!note.trim()}
            onClick={() => {
              onSave(note.trim())
              close()
            }}
          >
            {t.saveFlag}
          </button>
          {current ? (
            <button
              type="button"
              className="ckc__btn ckc__btn--ghost"
              onClick={() => {
                onRemove()
                close()
              }}
            >
              {t.removeFlag}
            </button>
          ) : (
            <button type="button" className="ckc__btn ckc__btn--ghost" onClick={() => close()}>
              {t.cancel}
            </button>
          )}
        </>
      )}
    </CrewDrawer>
  )
}
