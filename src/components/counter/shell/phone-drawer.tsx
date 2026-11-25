"use client"

import type { ReactNode } from "react"
import { Drawer, DrawerBackdrop, DrawerContent, DrawerTitle } from "@ui-sdk/react/drawer"

/**
 * The phone's bottom sheet as a ui-sdk Drawer: it slides up from the bottom,
 * follows a finger dragging it down, and closes when let go low enough, like
 * a system sheet. Escape, a tap on the shade and the back gesture close it
 * too, and focus goes back to the button that opened it.
 *
 * Loaded by `PhoneSheet` with next/dynamic, so the drawer is not in any phone
 * page's first load. `keepMounted` keeps the sheet's children (a half-typed
 * search, a picked month) between opens, as the old always-mounted sheet did.
 */
export default function PhoneDrawer({
  open,
  onClose,
  title,
  id,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  id: string
  children: ReactNode
}) {
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DrawerBackdrop className="pshade pshade--drawer" />
      <DrawerContent className="msheet msheet--drawer" id={id} keepMounted>
        <span className="msheet__grab" aria-hidden="true" />
        <DrawerTitle className="msheet__title">{title}</DrawerTitle>
        <div className="msheet__body">{children}</div>
      </DrawerContent>
    </Drawer>
  )
}
