import { notFound } from "next/navigation"

// Next.js's synthetic /_not-found route bypasses route-group-nested
// not-found.js files for URLs that match no route at all — it only invokes
// the nearest not-found.tsx when a *matched* segment explicitly calls
// notFound() (see createNotFoundLoaderTree in app-render.tsx). This
// catch-all makes every otherwise-unmatched /m/* URL a matched route, so
// calling notFound() here routes to `../not-found.tsx` and the mobile
// shell (tab bar) stays visible instead of falling back to the root
// (desktop) 404. Static/dynamic segments always win over a catch-all, so
// this never shadows a real page.
export default function MobileCatchAll(): never {
  notFound()
}
