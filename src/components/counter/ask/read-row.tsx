"use client"

import { useState } from "react"
import { labelFor } from "@/components/chat/tool-labels"
import type { ToolRead } from "@/lib/counter/ask-state"
import type { AskTurnMeta } from "@/lib/counter/ask-meta"
import { threadClock } from "@/lib/counter/thread-groups"

/**
 * THE READ ROW, AND THE DRAWER UNDER IT — an answer names what it read, and
 * the reader can check it in place.
 *
 * The field settled on three depths of provenance: a chip for the skimmer, a
 * preview for the curious, the full list for the auditor. The Ask page had
 * the first (tool names in `.srcs`) and hid the third behind a dotted
 * "Read 4 sources" toggle in the footer, which opened an absolutely
 * positioned panel over the thumbs. This puts all three where the reader's
 * eye already is:
 *
 *   Read  [✓ Otter sales · as of 06:12] [✓ Invoices · as of 06:12] [✓ Harri · ● as of 04:40]
 *   › How I got here
 *
 * The check means what it says: every source is one of the curated loaders
 * in `src/lib/chat/tools/`, never free-form SQL, so a chip can say *verified*
 * and mean it. The clock is the source's own sync stamp (`TOOL_AS_OF`); the
 * amber dot marks a stamp older than the newest one on the row — the source
 * that will move at the next sync. "How I got here" opens the exact calls
 * with the parameters they ran with, which is the half that makes a row
 * checkable — an answer about the right week and one about the wrong week
 * name the same tool.
 *
 * Classes are the prototype's: `.srcs`/`.src` from the sheet, `.drill`,
 * `.ldrawer`, `.lpanel` from its cause-attribution block (counter-components
 * .css:1096–1110), which no Ask component had emitted until now.
 */

/** The row's newest stamp; a source older than it by this much gets the dot. */
const STALE_BEHIND_MS = 30 * 60_000

function clockOf(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? threadClock(d) : null
}

export function ReadRow({ read }: { read: ToolRead[] }) {
  if (read.length === 0) return null
  const newest = Math.max(
    ...read.map((r) => (r.asOf ? new Date(r.asOf).getTime() : 0)),
  )
  return (
    <div className="srcs" role="list" aria-label="Sources this answer read">
      <span className="src rk">Read</span>
      {read.map((r) => {
        const clock = clockOf(r.asOf)
        const at = r.asOf ? new Date(r.asOf).getTime() : null
        const behind = at !== null && newest - at > STALE_BEHIND_MS
        return (
          <span
            className="src v"
            role="listitem"
            key={r.tool}
            title="Answered from a curated loader, not free-form SQL"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 8.5l3 3 7-7" />
            </svg>
            <b>{labelFor(r.tool).short}</b>
            {clock ? (
              behind ? (
                <span className="stale" title="Older than the rest of this answer — it moves at the next sync">
                  <i />
                  as of {clock}
                </span>
              ) : (
                <span>as of {clock}</span>
              )
            ) : null}
          </span>
        )
      })}
    </div>
  )
}

export function HowIGotHere({ read, meta }: { read: ToolRead[]; meta: AskTurnMeta | null }) {
  const [open, setOpen] = useState(false)
  if (read.length === 0) return null
  return (
    <div className="drill">
      <button
        type="button"
        className="drill__t"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="car">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 3l5 5-5 5" />
          </svg>
        </span>
        How I got here
      </button>
      <div className={`ldrawer${open ? " is-open" : ""}`}>
        <div>
          <div className="lpanel">
            {read.map((r) => {
              const label = labelFor(r.tool)
              const clock = clockOf(r.asOf)
              return (
                <p key={r.tool}>
                  <code>{r.tool}</code>
                  {r.params ? <> ({r.params})</> : null} — {label.done}
                  {clock ? <>, synced {clock}</> : <>, no sync stamp</>}.
                </p>
              )
            })}
            <p>
              <b>Verified</b> means every figure above came from one of these calls, none from
              the model.
              {meta?.cached
                ? " This turn replayed an answer the same calls produced earlier; nothing was re-read."
                : null}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * An answer served from the answer cache says so where the answer starts,
 * not in 9px mono at the foot. The tag names the run it replayed and offers
 * the one thing a reader might want instead: the model, fresh.
 */
export function CacheTag({ meta, onFresh }: { meta: AskTurnMeta | null; onFresh?: () => void }) {
  if (!meta?.cached) return null
  const clock = clockOf(meta.cachedAt)
  return (
    <div className="cachetag">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 1.5L3.5 9h4l-.5 5.5L12.5 7h-4z" />
      </svg>
      {clock ? `From the ${clock} run · no model` : "Answered earlier · no model"}
      {onFresh ? (
        <button type="button" onClick={onFresh}>
          Re-ask fresh
        </button>
      ) : null}
    </div>
  )
}
