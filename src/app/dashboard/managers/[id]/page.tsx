import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { notFound } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { ManagerDetailContent } from "./components/manager-detail-content"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

export default async function ManagerDetailPage({ 
  params 
}: { 
  params: Promise<{ id: string }>
}) {
  const session = await getServerSession(authOptions)
  const { id } = await params
  
  if (!session || session.user.role !== "OWNER") {
    redirect("/login")
  }

  const manager = await prisma.user.findFirst({
    where: {
      id,
      role: "MANAGER"
    },
    include: {
      managedStores: {
        where: { isActive: true },
        include: {
          store: {
            select: {
              id: true,
              name: true,
              address: true,
              ownerId: true
            }
          }
        }
      },
      reports: {
        orderBy: { date: 'desc' },
        take: 10,
        include: {
          store: {
            select: {
              name: true
            }
          }
        }
      },
      _count: {
        select: {
          reports: true,
          managedStores: {
            where: { isActive: true }
          }
        }
      }
    }
  })

  if (!manager) {
    notFound()
  }

  // Verify the manager is associated with stores owned by the current user
  const hasAccess = manager.managedStores.some(assignment => 
    assignment.store.ownerId === session.user.id
  )

  if (!hasAccess && manager.managedStores.length > 0) {
    notFound()
  }

  // Get all stores owned by the current user for assignment
  const availableStores = await prisma.store.findMany({
    where: {
      ownerId: session.user.id,
      isActive: true
    },
    select: {
      id: true,
      name: true,
      address: true
    }
  })

  return (
    <div>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard/managers">Managers</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>{manager.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <ManagerDetailContent 
          manager={manager}
          availableStores={availableStores}
        />
      </div>
    </div>
  )
}