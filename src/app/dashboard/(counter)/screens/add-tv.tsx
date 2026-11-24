"use client"

import { useState, type FormEvent } from "react"
import { ModalDialog } from "@/components/counter/modal-dialog"
import { Button, ButtonRow, useAct } from "@/components/counter/ui"
import type { ScreensData } from "@/lib/counter/adapters/screens"
import { claimScreen } from "@/lib/counter/actions/screens"

const SPOTS = ["Left", "Middle", "Right"]

/**
 * Add the TV showing a code. Scanning the TV's square opens Screens with the
 * code already in (`?pair=`), so the only question left is where it hangs.
 */
export function AddTv({ data, code: given, storeId: first, onClose, onAdded }: {
  data: ScreensData
  code: string
  storeId: string | null
  onClose: () => void
  onAdded: (id: string) => void
}) {
  const taken = (store: string, spot: string) => data.screens.some((s) => s.storeId === store && s.name.toLowerCase() === spot.toLowerCase())
  const freeSpot = (store: string) => SPOTS.find((s) => !taken(store, s)) ?? ""
  const [code, setCode] = useState(given)
  const [storeId, setStoreId] = useState(first ?? (data.stores.length === 1 ? data.stores[0].id : ""))
  const [spot, setSpot] = useState(() => (storeId ? freeSpot(storeId) : ""))
  const [other, setOther] = useState(false)
  const { act, stateOf, error } = useAct()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    let id: string | undefined
    act(
      "add",
      async () => {
        const r = await claimScreen({ code, storeId, name: spot })
        if (r.ok) id = r.id
        return r
      },
      { onDone: () => (id ? onAdded(id) : onClose()) },
    )
  }

  return (
    <ModalDialog
      className="sc-dlg"
      aria-labelledby="sc-add-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form className="sc-dlg__in" onSubmit={submit}>
        <div className="sc-dlg__h">
          <h1 id="sc-add-title">Add a TV</h1>
          <button type="button" className="sc-icon" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <label className="sc-field">
          <span>Code on the TV</span>
          <input
            className="sc-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="482 913"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={9}
            required
          />
          <span className="sc-sub">Or point your phone&apos;s camera at the square on the TV.</span>
        </label>
        <div className="sc-field">
          <span id="sc-add-store">Store</span>
          <div className="sc-when" role="group" aria-labelledby="sc-add-store">
            {data.stores.map((s) => (
              <button key={s.id} type="button" className="sc-chip" aria-pressed={storeId === s.id} onClick={() => { setStoreId(s.id); setSpot(freeSpot(s.id)); setOther(false) }}>
                {s.name}
              </button>
            ))}
          </div>
        </div>
        {storeId ? (
          <div className="sc-field">
            <span id="sc-add-spot">Where it hangs</span>
            <div className="sc-spots" role="group" aria-labelledby="sc-add-spot">
              {SPOTS.map((s) => (
                <button key={s} type="button" className="sc-spot" disabled={taken(storeId, s)} aria-pressed={!other && spot === s} onClick={() => { setSpot(s); setOther(false) }}>
                  {s}
                  {taken(storeId, s) ? <span className="sc-sub">taken</span> : null}
                </button>
              ))}
              <button type="button" className="sc-spot" aria-pressed={other} onClick={() => { setOther(true); setSpot("") }}>Somewhere else</button>
            </div>
            {other ? <input aria-label="Name this TV" placeholder="Drive-thru" value={spot} onChange={(e) => setSpot(e.target.value)} maxLength={60} required /> : null}
          </div>
        ) : null}
        {error ? <p className="sc-err" role="alert">{error === "network" ? "Couldn't reach the server. Try again." : error}</p> : null}
        <ButtonRow>
          <Button type="submit" variant="primary" state={stateOf("add")} doneLabel="Added" disabled={!storeId || !spot.trim()}>Add this TV</Button>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
        </ButtonRow>
      </form>
    </ModalDialog>
  )
}
