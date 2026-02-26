import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getDashboardAnalytics, getOtterAnalytics } from "@/app/actions/store-actions"
import { getInvoiceSummary, getInvoiceStoreBreakdown } from "@/app/actions/invoice-actions"
import { DashboardContent } from "./components/dashboard-content"

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect("/login")
  }

  const [data, otterData, invoiceSummary, invoiceBreakdown] = await Promise.all([
    getDashboardAnalytics({ days: 1 }),
    getOtterAnalytics(undefined, { days: 1 }),
    getInvoiceSummary({ days: 30 }),
    getInvoiceStoreBreakdown({ days: 30 }),
  ])

  return (
    <DashboardContent
      initialData={data}
      initialOtterData={otterData}
      initialInvoiceSummary={invoiceSummary}
      initialInvoiceBreakdown={invoiceBreakdown}
      userRole={session.user.role}
    />
  )
}
