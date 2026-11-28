"use client"

import { PageHead, usePageChrome } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { DeveloperSections } from "@/lib/counter/adapters/developer"
import { DeveloperView } from "./developer-view"

/**
 * Developer portal, on the desk: the page title, then the four tabs
 * (`developer-view.tsx`, shared with the phone).
 */
export function CounterDeveloperClient({ sections }: { sections: SectionSources<DeveloperSections> }) {
  usePageChrome({ leaf: "Developer portal" })
  return (
    <>
      <PageHead title="Developer portal" sub="Developer only · not visible to the owner" />
      <DeveloperView sections={sections} monitoringHref="/dashboard/admin/monitoring/infrastructure" />
    </>
  )
}
