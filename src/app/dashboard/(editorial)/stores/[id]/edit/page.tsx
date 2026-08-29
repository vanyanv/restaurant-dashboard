import { redirect } from "next/navigation"

// A legacy path kept so old links and bookmarks resolve.
//
// `P.storefile` is one page — "operating inputs only you can tell us" — and
// the editorial build split reading from writing across two routes. The store
// file now carries the form, so this has nothing of its own to do.
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/dashboard/stores/${id}`)
}
