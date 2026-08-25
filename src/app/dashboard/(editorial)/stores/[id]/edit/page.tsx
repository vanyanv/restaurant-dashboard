import { redirect } from "next/navigation"

export default async function StoreEditRedirect(props: {
  params: Promise<{ id: string }>
}) {
  const { id } = await props.params
  redirect(`/dashboard/stores?focus=${encodeURIComponent(id)}&edit=1`)
}
