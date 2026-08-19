/**
 * Scroll rules for the message thread.
 *
 * The behaviour this replaces forced `scrollTop = scrollHeight` on every
 * change to `messages`, so scrolling up to re-read an earlier answer while a
 * new one streamed yanked the reader back down on the next token. Auto-scroll
 * is now conditional on the reader already being parked at the bottom.
 */

/** How far from the bottom still counts as "parked there". Wide enough to
 * survive a stray trackpad nudge, narrow enough that a deliberate scroll-up
 * of even one line releases the lock. */
export const STICK_THRESHOLD_PX = 100

export interface ScrollView {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

/** Whether the viewport is at (or within a hair of) the end of the thread. */
export function isNearBottom(view: ScrollView): boolean {
  const distance = view.scrollHeight - view.scrollTop - view.clientHeight
  return distance <= STICK_THRESHOLD_PX
}

export interface AutoScrollState {
  /** Was the reader at the bottom as of the last scroll event? */
  stuck: boolean
  isStreaming: boolean
  /** First render of a thread — always land at the newest turn. */
  firstPaint?: boolean
}

/** Whether new content should pull the viewport along with it. */
export function shouldAutoScroll(state: AutoScrollState): boolean {
  if (state.firstPaint) return true
  return state.stuck
}
