import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { CreateStoreForm } from "./create-store-form"
import { Store, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { EditorialTopbar } from "../../components/editorial-topbar"

export default async function NewStorePage() {
  const session = await getServerSession(authOptions)
  
  if (!session) {
    redirect("/login")
  }

  if (session.user.role !== "OWNER") {
    redirect("/dashboard/stores")
  }

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar section="§ 05" title="New Store">
        <Link href="/dashboard/stores">
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
      </EditorialTopbar>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Create New Store</h2>
          <p className="text-muted-foreground">
            Add a new restaurant location to your chain
          </p>
        </div>

        <div className="max-w-2xl">
          <div className="rounded-xl border bg-card text-card-foreground shadow">
            <div className="flex items-center gap-2 p-6 pb-4">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <Store className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Store Information</h2>
                <p className="text-sm text-muted-foreground">
                  Enter the details for your new store location
                </p>
              </div>
            </div>
            <Separator />
            <div className="p-6">
              <CreateStoreForm />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}