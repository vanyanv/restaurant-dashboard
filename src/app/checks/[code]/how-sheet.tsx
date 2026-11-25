"use client"

import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from "@ui-sdk/react/drawer"
import HowPhotos from "./how-photos"

/** The crew strings this sheet needs; the page's EN/ES table fits it as is. */
export type HowText = {
  howTitle: string
  howFor: (task: string) => string
  refPhoto: string
  photoOf: (k: number, n: number) => string
  prevPhoto: string
  nextPhoto: string
  howTick: string
  takePhoto: string
  close: string
}

/**
 * The how-to on a crew task, as a ui-sdk Drawer: a bottom sheet the crew can
 * drag down to close, with the owner's reference photos first, then the steps.
 *
 * Its own module so the page loads it with next/dynamic on the first tap of a
 * How button: the drawer and carousel are not in the checklist's first load.
 * The page keeps it mounted after that and drives `open`, so the sheet slides
 * out with its content still there.
 */
export default function HowSheet({
  t,
  open,
  onOpenChange,
  code,
  title,
  steps,
  photos,
  done,
  photoTask,
  onAct,
}: {
  t: HowText
  open: boolean
  onOpenChange: (open: boolean) => void
  code: string
  title: string
  steps: string[]
  photos: string[]
  done: boolean
  photoTask: boolean
  /** Not done yet: tick it, or open the camera on a photo task. */
  onAct: () => void
}) {
  return (
    <Drawer open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DrawerBackdrop className="ckb__howdim" />
      <DrawerContent className="ckb__howsheet" aria-label={t.howFor(title)}>
        <div className="ckb__grip" aria-hidden />
        <div className="ckb__howbody">
          <span className="ck-mono">{t.howTitle}</span>
          <DrawerTitle>{title}</DrawerTitle>
          {photos.length > 0 && (
            <HowPhotos
              code={code}
              photos={photos}
              label={t.refPhoto}
              photoOf={t.photoOf}
              prev={t.prevPhoto}
              next={t.nextPhoto}
            />
          )}
          {steps.length > 0 && (
            <ol className={`ckb__steps${steps.length === 1 ? " one" : ""}`}>
              {steps.map((s, k) => (
                <li key={k}>{s}</li>
              ))}
            </ol>
          )}
        </div>
        <div className="ckb__howacts">
          {!done && (
            <button type="button" className="ckc__btn" onClick={onAct}>
              {photoTask ? (
                <>
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M3 7h4l2-3h6l2 3h4v13H3z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>{" "}
                  {t.takePhoto}
                </>
              ) : (
                t.howTick
              )}
            </button>
          )}
          <DrawerClose className="ckc__btn ckc__btn--ghost">{t.close}</DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
