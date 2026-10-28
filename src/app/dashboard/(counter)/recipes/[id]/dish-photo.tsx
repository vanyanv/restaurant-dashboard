"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { MenuPhoto } from "@/components/counter"
import { menuPhotoFor, photoFrame, type MenuWay } from "@/lib/counter/menu-photos"

/**
 * The dish's photo from chrisneddys.com above its recipe, so the owner sees
 * the plate they are editing. A dish shot both ways (Chris's Way and Eddy's
 * Way) gets a switch between the two shots; the recipe below is the same
 * either way, the Ways being add-ons on the POS.
 *
 * `justCreated` (and `warn`, when a step after the create failed) is the
 * New menu item screen's hand-off: a recipe that was
 * made a moment ago says what to do next instead of opening on an empty page
 * with no instructions.
 */
export function DishPhoto({
  name,
  justCreated,
  warn,
}: {
  name: string
  justCreated: boolean
  warn: string | null
}) {
  const [way, setWay] = useState<MenuWay>("chris")
  // The hand-off is shown once: it is held here and dropped from the URL, so
  // a reload or a later visit does not say "Created" again.
  const [handoff] = useState(() => (justCreated ? { warn } : null))
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => {
    if (!justCreated) return
    const qs = new URLSearchParams(window.location.search)
    qs.delete("new")
    qs.delete("warn")
    const rest = qs.toString()
    router.replace(rest ? `${pathname}?${rest}` : pathname, { scroll: false })
  }, [justCreated, pathname, router])
  const shots = menuPhotoFor(name)
  const frame = photoFrame(name, way)
  if (!frame && !handoff) return null

  return (
    <div className="mi-hero">
      {frame ? <MenuPhoto frame={frame} alt={`${name}${shots?.eddy ? `, ${way === "chris" ? "Chris's" : "Eddy's"} Way` : ""}`} size="full" /> : null}
      <div className="mi-hero__side">
        {shots?.eddy ? (
          <div className="mi-chips" role="group" aria-label="Which Way">
            <button type="button" className="mi-chip" aria-pressed={way === "chris"} onClick={() => setWay("chris")}>
              Chris&apos;s Way
            </button>
            <button type="button" className="mi-chip" aria-pressed={way === "eddy"} onClick={() => setWay("eddy")}>
              Eddy&apos;s Way
            </button>
          </div>
        ) : null}
        {handoff?.warn ? (
          <p className="ct-note ct-note--bad ct-note--bare" role="status">
            {handoff.warn}
          </p>
        ) : handoff ? (
          <p className="ct-note ct-note--good ct-note--bare" role="status">
            Created, and the same at every store. Check its lines under &ldquo;The recipe&rdquo;, add anything missing
            from &ldquo;Add an ingredient&rdquo;, then Save.
          </p>
        ) : (
          <p className="ck-meta" style={{ margin: 0 }}>
            Photo from chrisneddys.com
          </p>
        )}
      </div>
    </div>
  )
}
