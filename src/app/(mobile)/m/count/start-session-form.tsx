"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { startStockCount } from "@/app/actions/mobile-stock-count-actions"

type Store = { id: string; name: string }

type Props = {
  stores: Store[]
  defaultStoreId: string
}

export function StartSessionForm({ stores, defaultStoreId }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [storeId, setStoreId] = useState(defaultStoreId)
  const [error, setError] = useState<string | null>(null)

  function start() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await startStockCount({ storeId })
        router.push(`/m/count?session=${result.sessionId}`)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start session")
      }
    })
  }

  return (
    <div className="m-count-start dock-in dock-in-2">
      <label className="m-count-start__label">
        STORE
        <select
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          disabled={pending}
          className="m-count-start__select"
        >
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="toolbar-btn toolbar-btn--accent m-count-start__cta"
        onClick={start}
        disabled={pending || !storeId}
      >
        {pending ? "Opening session…" : "Start new count"}
      </button>
      {error ? <div className="m-count-card__error">{error}</div> : null}
    </div>
  )
}
