/**
 * Copy and download, for the developer page.
 *
 * Nothing here keeps what it is handed: no storage, no log, no global. The
 * text goes to the clipboard or into a file the browser saves, and that is
 * all.
 */

/**
 * Puts text on the clipboard. True when it got there.
 *
 * False (never a throw) when the browser refuses: no permission, an insecure
 * page, or a browser that wants the copy to happen in the very same turn as
 * the tap. The caller then shows the text selected so it can be copied by
 * hand.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Selects an element's text, so the keyboard's own copy takes it. */
export function selectText(el: Element | null): void {
  if (!el) return
  const selection = window.getSelection?.()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(el)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Saves text as a file. The address made for it is taken back straight after. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.rel = "noopener"
  document.body.append(a)
  a.click()
  a.remove()
  // After the click has been handed to the browser, not before.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
