import type { ReactNode } from "react"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"

interface EditorialTopbarProps {
  section: string
  title: string
  stamps?: ReactNode
  children?: ReactNode
}

export function EditorialTopbar({
  section,
  title,
  stamps,
  children,
}: EditorialTopbarProps) {
  return (
    <header className="editorial-topbar">
      <div className="editorial-topbar-rule" aria-hidden="true" />
      <div className="editorial-topbar-inner">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-1 h-4" />
        <span className="editorial-section-label">{section}</span>
        <span className="font-display text-[18px] italic leading-none tracking-[-0.02em]">
          {title}
        </span>
        {stamps ? (
          <span className="ml-3 hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] lg:flex">
            <span className="inline-block h-[3px] w-[3px] rotate-45 bg-[var(--ink-faint)]" />
            {stamps}
          </span>
        ) : null}
        {children ? (
          <div className="ml-auto flex items-center gap-2">{children}</div>
        ) : null}
      </div>
    </header>
  )
}
