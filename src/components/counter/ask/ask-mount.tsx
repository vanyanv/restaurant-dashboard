"use client"

import { type ComponentProps } from "react"
import { AskSurface } from "./ask-surface"
import { useAsk } from "@/lib/counter/use-ask"

/**
 * The ⌘K palette and its model wiring, in one component so `AppShell` can
 * load both on demand instead of importing them.
 *
 * ## Why this file exists
 *
 * `AppShell` used to call `useAsk()` itself and render `<AskSurface>` inline.
 * Both reach `@ai-sdk/react` and `ai` — `use-ask.ts` imports `useChat` and
 * `DefaultChatTransport` — and `AppShell` is re-exported from the main Counter
 * barrel, which ~100 files import. So the AI SDK was in the initial JavaScript
 * of all 42 rebuilt routes, for a palette that is not on screen until someone
 * presses ⌘K.
 *
 * Splitting the Ask exports out of the barrel was not enough on its own,
 * because `AppShell` pulled them back in by importing `AskSurface` directly.
 * A hook cannot be lazily imported, which is why `useAsk` had to move here
 * with it rather than staying behind: this component is the only thing that
 * reads its result.
 *
 * ## What the reader notices
 *
 * Nothing, unless they press ⌘K in the first moment after a page hydrates.
 * The chunk starts loading as soon as this mounts (that is `next/dynamic`'s
 * default — there is no `loading` gate to wait on), so the palette is ready
 * long before a reader reaches for it, and the shell paints without it. The
 * same pattern the chat drawer already uses in
 * `src/components/chat/chat-drawer-client.tsx`.
 */
export type AskMountProps = Omit<
  ComponentProps<typeof AskSurface>,
  "onSubmit" | "askState" | "onAskBack"
>

export function AskMount(props: AskMountProps) {
  // Lives here rather than in `AppShell` so the SDK it pulls in is inside this
  // chunk. Its output has never been read by anything but `AskSurface`.
  const { state: askState, ask, reset: resetAsk } = useAsk()

  return (
    <AskSurface {...props} onSubmit={ask} askState={askState} onAskBack={resetAsk} />
  )
}
