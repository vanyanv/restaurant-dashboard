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
 * The crew page a store's QR poster or texted link opens. Public: no account, no store
 * picker. The code in the URL names exactly one store, and only that store's
 * PINs work here. Everything after the PIN is checked again on submit.
 */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const store = await findStoreByCode(code)
  if (!store) {
    return (
      <main className="ct-root ckc ckb">
        <div className="ckc__col">
          <header className="ckb__band">
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
            <img src="/checks-logo.png" alt="Chris N Eddy's" />
          </header>
          <div style={{ display: "grid", gap: 10, textAlign: "center", marginTop: 24 }}>
            <h1>This link isn&apos;t in use</h1>
            <p className="ckc__dim">Ask your manager for the store&apos;s current link or poster.</p>
            <p className="ckc__dim">Este enlace ya no funciona. Pide a tu gerente el enlace o el cartel nuevo.</p>
          </div>
        </div>
      </main>
    )
  }
  const view = await loadCrewView(store, new Date())
  return <CrewCheckClient code={code} initial={view} />
}
