"use client"

import * as React from "react"
import {
  Store,
  Users,
  BarChart3,
  Settings2,
  Plus,
  Building2,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavProjects } from "@/components/nav-projects"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"

// Restaurant management data
const data = {
  user: {
    name: "Restaurant Owner",
    email: "owner@chrisaneddys.com",
    avatar: "",
  },
  teams: [
    {
      name: "ChrisNEddys",
      logo: "/logo.png",
      plan: "Restaurant Chain",
    }
  ],
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: BarChart3,
      isActive: true,
      items: [
        {
          title: "Overview",
          url: "/dashboard",
        },
        {
          title: "Store Dashboard",
          url: "/dashboard/store",
        },
        {
          title: "Analytics",
          url: "/dashboard/analytics",
        },
      ],
    },
    {
      title: "Store Management",
      url: "/dashboard/stores",
      icon: Store,
      items: [
        {
          title: "All Stores",
          url: "/dashboard/stores",
        },
        {
          title: "Create Store",
          url: "/dashboard/stores/new",
        },
        {
          title: "Store Analytics",
          url: "/dashboard/stores/analytics",
        },
      ],
    },
    {
      title: "Manager Assignment",
      url: "/dashboard/assignments",
      icon: Users,
      items: [
        {
          title: "Assignment Center",
          url: "/dashboard/assignments",
        },
        {
          title: "All Managers",
          url: "/dashboard/managers",
        },
        {
          title: "Create Manager",
          url: "/dashboard/managers/new",
        },
      ],
    },
    {
      title: "Settings",
      url: "/dashboard/settings",
      icon: Settings2,
      items: [
        {
          title: "Account",
          url: "/dashboard/settings/account",
        },
        {
          title: "Notifications",
          url: "/dashboard/settings/notifications",
        },
        {
          title: "Preferences",
          url: "/dashboard/settings/preferences",
        },
      ],
    },
  ],
  projects: [
    {
      name: "Overview",
      url: "/dashboard",
      icon: Building2,
    },
    {
      name: "Create Store",
      url: "/dashboard/stores/new",
      icon: Plus,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavProjects projects={data.projects} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
