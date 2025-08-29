export interface ManagerDashboardStats {
  totalReports: number
  avgPrepCompletion: number
  expectedReports: number
  missedShifts: number
}

export interface StoreWithReports {
  id: string
  name: string
  address: string | null
  recentReports: any[]
  completionRate: number
  lastReportDate: string | null
  assignedAt?: Date
}

export interface ManagerDashboardData {
  stores: StoreWithReports[]
  weeklyStats: ManagerDashboardStats
  totalReports: number
}

export interface StoreAssignment {
  id: string
  createdAt: Date
  isActive: boolean
  storeId: string
  managerId: string
  store: {
    id: string
    name: string
    address: string | null
    ownerId: string
  }
}

export interface ManagerDetailProps {
  manager: any // Use any for flexibility with Prisma types
  availableStores: any[]
}