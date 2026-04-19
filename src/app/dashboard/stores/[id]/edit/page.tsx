import { getServerSession } from "next-auth"
import { redirect, notFound } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getStoreById } from "@/app/actions/store-actions"
import { EditStoreForm } from "./edit-store-form"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { EditorialTopbar } from "../../../components/editorial-topbar"

export default async function EditStorePage(props: {
  params: Promise<{ id: string }>
}) {
  const params = await props.params
  const { id } = params
  const session = await getServerSession(authOptions)
  
  if (!session) {
    redirect("/login")
  }

  if (session.user.role !== "OWNER") {
    redirect(`/dashboard/stores/${id}`)
  }

  const store = await getStoreById(id)

  if (!store) {
    notFound()
  }

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 05"
        title={`Edit · ${store.name}`}
      >
        <Link href={`/dashboard/stores/${store.id}`}>
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
      </EditorialTopbar>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <p className="text-muted-foreground">
          Update the details for {store.name}
        </p>

        <EditStoreForm store={store} />
      </div>
    </div>
  )
}