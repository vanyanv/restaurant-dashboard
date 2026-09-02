"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { deleteAskThread, renameAskThread } from "@/lib/counter/actions/conversation"

/**
 * `.convhead` — who you are reading, and the two things you can do to it.
 *
 * ## Why this row exists at all
 *
 * Two gaps met in the same place. Opening a thread from the rail showed its
 * turns and NOT its name: the desk page's `<h2>` is the latest verdict, and a
 * restored thread has no live verdict, so the heading over someone's own
 * conversation read "Ask". And `PATCH`/`DELETE` on
 * `/api/chat/conversations/[id]` have existed since the editorial chat drawer
 * was built with nothing on this surface reaching them — an account
 * accumulated 47 model-titled threads it could open and nothing else.
 *
 * ## The row belongs to the thread, not to the rail
 *
 * A per-row control was the obvious place and is not available: `.cv` IS a
 * `<button>` and a button cannot contain one. It is also the wrong place —
 * "delete" is a decision about a conversation, and the reader is best placed
 * to make it while looking at what is in it. So the actions sit above the
 * thread they act on, on both surfaces, and the rail stays a list of doors.
 *
 * ## DELETE ASKS TWICE, IN PLACE
 *
 * The first press arms; the second deletes. Not `window.confirm` — it is
 * unstyleable, it reads as a browser failure on a phone, and it cannot say
 * what is about to be lost. Not a modal either, for one destructive verb on
 * one row. The armed state names the cost in its own words, because it is
 * real: deleting cascades to the messages and their tool calls, and those tool
 * calls are where a restored answer's figures live (see `filedFrom`). There is
 * no archive and no undo.
 *
 * Arming is dropped the moment anything else is touched, so a "Delete?" left
 * standing from a minute ago cannot be completed by a stray press.
 */
export function ThreadActions({
  id,
  title,
  onDeleted,
}: {
  id: string
  /** The thread's stored name, or null before the model has written one. */
  title: string | null
  /** The thread is gone; the surface decides where the reader now is. */
  onDeleted: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState("")
  const [arming, setArming] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  const openRename = () => {
    setArming(false)
    setSaid(null)
    // The stored name, or an empty box — NOT the word "Untitled", which is
    // what the rail prints for the absence of a name and not a name anyone
    // chose. Pre-filling it would make "Untitled" the thing you have to delete
    // before you can type.
    setDraft(title ?? "")
    setRenaming(true)
  }

  const save = (next: string) => {
    const trimmed = next.trim()
    if (!trimmed || trimmed === title) {
      setRenaming(false)
      return
    }
    startTransition(async () => {
      const result = await renameAskThread({ id, title: trimmed })
      if (!result.ok) {
        setSaid(result.error)
        return
      }
      setRenaming(false)
      setSaid(null)
      // The rail row, and this header, both read the row that just changed.
      router.refresh()
    })
  }

  const remove = () => {
    if (!arming) {
      setRenaming(false)
      setSaid(null)
      setArming(true)
      return
    }
    startTransition(async () => {
      const result = await deleteAskThread({ id })
      if (!result.ok) {
        setSaid(result.error)
        setArming(false)
        return
      }
      onDeleted()
      router.refresh()
    })
  }

  return (
    <div className="convhead">
      {renaming ? (
        <form
          className="convhead__f"
          onSubmit={(e) => {
            e.preventDefault()
            save(draft)
          }}
        >
          <input
            type="text"
            value={draft}
            autoFocus
            maxLength={80}
            aria-label="Name this conversation"
            onChange={(e) => setDraft(e.target.value)}
            // Escape leaves the name as it was. A rename abandoned half-typed
            // is not a rename, and the only other way out would be to retype
            // what was already there.
            onKeyDown={(e) => {
              if (e.key === "Escape") setRenaming(false)
            }}
          />
        </form>
      ) : (
        <b>{title ?? "Untitled"}</b>
      )}

      {/* The caption carries whatever the last action said — a refused rename,
          a thread that was already gone — rather than a state that silently
          does nothing. `.rk` is the sheet's own caption. */}
      {said ? <span className="rk">{said}</span> : null}

      <button type="button" onClick={renaming ? () => save(draft) : openRename} disabled={pending}>
        {renaming ? "Save" : "Rename"}
      </button>
      <button type="button" onClick={remove} disabled={pending}>
        {arming ? "Delete for good?" : "Delete"}
      </button>
      {arming ? (
        <button type="button" onClick={() => setArming(false)} disabled={pending}>
          Keep
        </button>
      ) : null}
    </div>
  )
}
