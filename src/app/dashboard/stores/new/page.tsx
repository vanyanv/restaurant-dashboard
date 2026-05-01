import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { CreateStoreForm } from "./create-store-form"
import { Store, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { EditorialTopbar } from "../../components/editorial-topbar"

export default async function NewStorePage() {
  const session = await getServerSession(authOptions)
  
  if (!session) {
    redirect("/login")
  }

  if (!hasOwnerAccess(session.user.role)) {
    redirect("/dashboard/stores")
  }

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar section="§ 05" title="New Store">
        <Button asChild variant="outline" size="icon" className="toolbar-btn h-9 w-9 p-0">
          <Link href="/dashboard/stores" aria-label="Back to stores">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
      </EditorialTopbar>

      <div className="flex flex-1 flex-col gap-5 p-4 sm:p-6">
        <header className="max-w-2xl">
          <div className="font-label">Location file</div>
          <h1 className="font-display mt-2 text-[34px] italic leading-none text-[var(--ink)]">
            Create new store
          </h1>
          <p className="mt-3 max-w-[62ch] text-sm leading-6 text-[var(--ink-muted)]">
            Add the operating details for a new restaurant location.
          </p>
        </header>

        <div className="max-w-2xl">
          <section className="inv-panel">
            <div className="inv-panel__head">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center border border-[var(--hairline-bold)] bg-[var(--accent-bg)] text-[var(--accent-dark)]">
                  <Store className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="inv-panel__dept">§ store information</div>
                  <h2 className="inv-panel__title">Location details</h2>
                </div>
              </div>
            </div>

            <CreateStoreForm />
          </section>
        </div>
      </div>
    </div>
  )
}
