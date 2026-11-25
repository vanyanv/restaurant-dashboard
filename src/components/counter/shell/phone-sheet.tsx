"use client"

import { useEffect, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"

const loadDrawer = () => import("./phone-drawer")
const PhoneDrawer = dynamic(loadDrawer, { ssr: false })

/**
 * The phone's bottom sheet (`.pshade` + `.msheet`): the store picker, the date
 * range picker and Ask's thread list.
 *
 * It is a ui-sdk Drawer (`phone-drawer.tsx`) so it can be dragged down to
 * close, like a system sheet; the grab bar on top used to be only a picture
 * of one. The drawer renders in the browser's top layer, so it sits above the
 * tab bar and the page behind is inert without any z-index of ours.
 *
 * The drawer's code is not in the page's first load: nothing renders until
 * the sheet first opens, and the chunk is fetched a moment after the page
 * draws so the first tap does not wait on the network. Once opened it stays
 * mounted (hidden while closed), so its children keep their state.
 */
export function PhoneSheet({
  open,
  onClose,
  title,
  id,
  children,
}: {
  open: boolean
  onClose: () => void
  /** The sheet's heading, and its accessible name. */
  title: string
  /** So the trigger can `aria-controls` it. */
  id: string
  children: ReactNode
}) {
  const [used, setUsed] = useState(open)
  if (open && !used) setUsed(true)
  useEffect(() => {
    const t = window.setTimeout(() => void loadDrawer(), 1500)
    return () => window.clearTimeout(t)
  }, [])
  if (!used) return null
  return (
    <PhoneDrawer open={open} onClose={onClose} title={title} id={id}>
      {children}
    </PhoneDrawer>
  )
}
