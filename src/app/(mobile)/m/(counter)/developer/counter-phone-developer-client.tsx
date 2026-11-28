"use client"

import { DeveloperView } from "@/app/dashboard/(counter)/admin/developer/developer-view"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { DeveloperSections } from "@/lib/counter/adapters/developer"

/**
 * Developer portal, on a phone: the same four tabs in the same order as the
 * desk. The shared view lays itself out from its own width, so here the map
 * is stacked cards and each key is a card.
 */
export function CounterPhoneDeveloperClient({ sections }: { sections: SectionSources<DeveloperSections> }) {
  return (
    <>
      <div>
        <h2 className="mtitle">Developer portal</h2>
        <p className="msub">Developer only</p>
      </div>
      <DeveloperView sections={sections} monitoringHref="/m/monitoring/infrastructure" />
    </>
  )
}
