import { redirect } from "next/navigation"

// A legacy path kept so old links and bookmarks resolve.
//
// `P.ask` gives its route as `/dashboard/chat`, but the rebuilt surface is
// `/dashboard/ask` and the sidebar has pointed there since. This page went on
// serving the pre-Counter chat to anyone with the old link — two Ask surfaces,
// one of them stale.
//
// `src/proxy.ts` still maps `/dashboard/chat` to `/m/chat` for phones, which is
// deliberate: the phone's Counter ask has no thread history and `/m/chat` does,
// so retiring the mobile one needs its own comparison rather than a redirect
// tacked onto this.
export default function ChatPage() {
  redirect("/dashboard/ask")
}
