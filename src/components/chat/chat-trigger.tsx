"use client"

import { useChatDrawer } from "./chat-drawer-context"

/** Floating header trigger that opens the chat drawer. Used in the
 * dashboard chrome alongside the ⌘K keyboard shortcut for owners who
 * prefer the mouse. Styled as a `.toolbar-btn` with a kbd chip suffix. */
export function ChatTrigger() {
  const { openDrawer } = useChatDrawer()
  return (
    <button
      type="button"
      onClick={openDrawer}
      className="toolbar-btn"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
      }}
      aria-label="Open chat"
    >
      <span>Ask</span>
      <span className="kbd-chip" aria-hidden>
        ⌘K
      </span>
    </button>
  )
}
