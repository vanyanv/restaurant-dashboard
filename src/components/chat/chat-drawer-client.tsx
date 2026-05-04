"use client"

import dynamic from "next/dynamic"

/** Defers the AI SDK + chat-thread bundle until the dashboard has hydrated.
 * The drawer is mounted once at the layout level, but it only matters after
 * a user opens it (⌘K). Loading it eagerly puts ai/@ai-sdk/react on the
 * critical path of every dashboard route. */
const ChatDrawerLazy = dynamic(
  () => import("./chat-drawer").then((m) => ({ default: m.ChatDrawer })),
  { ssr: false }
)

export function ChatDrawerClient() {
  return <ChatDrawerLazy />
}
