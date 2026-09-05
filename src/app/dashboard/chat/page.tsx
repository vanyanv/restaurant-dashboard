import { redirect } from "next/navigation"

// A legacy path kept so old links and bookmarks resolve.
//
// `P.ask` gives its route as `/dashboard/chat`, but the rebuilt surface is
// `/dashboard/ask` and the sidebar has pointed there since. This page went on
// serving the pre-Counter chat to anyone with the old link — two Ask surfaces,
// one of them stale.
//
// The phone half is done too, as of 2026-09-04: `/m/chat` is a shim onto
// `/m/ask` and `src/proxy.ts` maps `/dashboard/chat` there. This comment used
// to say the mobile one had to stay because the phone's Counter Ask had no
// thread history — it grew one, and the comparison that comment asked for is
// the measurement in `/m/chat`'s own page file.
export default function ChatPage() {
  redirect("/dashboard/ask")
}
