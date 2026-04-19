import type { ReactNode } from "react"
import { EditorialTopbar } from "@/app/dashboard/components/editorial-topbar"
import { ChapterRail } from "./components/chapter-rail"

export default function SettingsLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <EditorialTopbar section="§ 08" title="The Masthead">
        <ChapterRail />
      </EditorialTopbar>
      <div className="px-6 py-8 md:px-10 md:py-10">{children}</div>
    </div>
  )
}
