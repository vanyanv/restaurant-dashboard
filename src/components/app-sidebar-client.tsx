"use client"

import dynamic from "next/dynamic"
import type { ComponentProps } from "react"
import type { Sidebar } from "@/components/ui/sidebar"

const AppSidebar = dynamic(
  () => import("@/components/app-sidebar").then(m => ({ default: m.AppSidebar })),
  { ssr: false }
)

export function AppSidebarClient(props: ComponentProps<typeof Sidebar>) {
  return <AppSidebar {...props} />
}
