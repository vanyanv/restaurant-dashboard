import type { Metadata, Viewport } from "next"
import { findStoreByCode, loadCrewView } from "@/lib/checks/crew"
import { CrewCheckClient } from "./crew-check-client"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Store checks · Chris N Eddy's",
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

/**
 * The crew page a store's QR poster opens. Public: no account, no store
 * picker. The code in the URL names exactly one store, and only that store's
 * PINs work here. Everything after the PIN is checked again on submit.
 */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const store = await findStoreByCode(code)
  if (!store) {
    return (
      <main className="ct-root ckc">
        <div className="ckc__col" style={{ justifyContent: "center", textAlign: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img className="ckc__logo" style={{ height: 40, margin: "0 auto" }} src="/checks-logo.png" alt="Chris N Eddy's" />
          <h1>This QR code isn&apos;t in use</h1>
          <p className="ckc__dim">Ask your manager for the store&apos;s current poster.</p>
          <p className="ckc__dim">Este código QR ya no funciona. Pide a tu gerente el cartel nuevo.</p>
        </div>
      </main>
    )
  }
  const view = await loadCrewView(store, new Date())
  return <CrewCheckClient code={code} initial={view} />
}
