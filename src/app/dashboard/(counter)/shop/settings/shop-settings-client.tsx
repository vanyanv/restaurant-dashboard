"use client"

import { useState } from "react"
import { Section, useCounterTransition, usePageChrome } from "@/components/counter"
import { saveShopSettings } from "@/lib/counter/actions/shop"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { SettingsData, SettingsSections } from "@/lib/counter/adapters/shop"
import { OutcomeLine, ShopHead, useShopAction } from "../shop-ui"

/**
 * Shop — Settings. The switches an owner reaches for: pause the shop, turn
 * pickup on or off, and what shipping costs. Terms, returns wording and
 * countries stay on the site's own settings page, linked at the bottom.
 */
export function ShopSettingsClient({ sections }: { sections: SectionSources<SettingsSections> }) {
  usePageChrome({ leaf: "Shop settings" })
  const { pending } = useCounterTransition()
  return (
    <>
      <ShopHead sub="Pause, pickup and shipping for chrisneddys.com" />
      <Section title="Settings" meta={(d) => d.storeName} data={sections.settings} pending={pending}>
        {(d) => <Form key={JSON.stringify(d)} s={d} />}
      </Section>
    </>
  )
}

const cents = (n: number | null) => (n === null ? "" : (n / 100).toFixed(2))
const toCents = (s: string) => Math.round(Number(s) * 100)
const MONEY = /^\d+(\.\d{1,2})?$/

function Form({ s }: { s: SettingsData }) {
  const [v, setV] = useState({
    shopPaused: s.shopPaused,
    pauseNote: s.pauseNote ?? "",
    pickupEnabled: s.pickupEnabled,
    pickupAddress: s.pickupAddress,
    shippingFlat: cents(s.shippingFlatCents),
    freeOver: cents(s.shippingFreeOverCents),
    shipsWithin: s.shipsWithin ?? "",
    supportEmail: s.supportEmail,
  })
  const { busy, outcome, run } = useShopAction()
  const bad =
    !MONEY.test(v.shippingFlat.trim())
      ? "Shipping is dollars and cents, like 6.00"
      : v.freeOver.trim() !== "" && !MONEY.test(v.freeOver.trim())
        ? "Free shipping over is dollars and cents, or empty"
        : v.pickupEnabled && !v.pickupAddress.trim()
          ? "Pickup needs an address"
          : null

  return (
    <form
      style={{ display: "grid", gap: 16, maxWidth: 620 }}
      onSubmit={(e) => {
        e.preventDefault()
        if (bad) return
        run(() =>
          saveShopSettings({
            shopPaused: v.shopPaused,
            pauseNote: v.pauseNote.trim() || null,
            pickupEnabled: v.pickupEnabled,
            pickupAddress: v.pickupAddress.trim(),
            shippingFlatCents: toCents(v.shippingFlat),
            shippingFreeOverCents: v.freeOver.trim() === "" ? null : toCents(v.freeOver),
            shipsWithin: v.shipsWithin.trim() || null,
            supportEmail: v.supportEmail.trim(),
          }),
        )
      }}
    >
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
        <legend className="ck-mono" style={{ marginBottom: 6 }}>
          Shop open
        </legend>
        <label className="sh-check">
          <input type="checkbox" checked={v.shopPaused} onChange={(e) => setV((x) => ({ ...x, shopPaused: e.target.checked }))} />
          Pause the shop. Customers can look, but checkout is closed.
        </label>
        {v.shopPaused && (
          <label className="ck-field">
            <span className="ck-mono">Line customers see while paused</span>
            <input className="ck-input" value={v.pauseNote} placeholder="Back Thursday" maxLength={200} onChange={(e) => setV((x) => ({ ...x, pauseNote: e.target.value }))} />
          </label>
        )}
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
        <legend className="ck-mono" style={{ marginBottom: 6 }}>
          Pickup
        </legend>
        <label className="sh-check">
          <input type="checkbox" checked={v.pickupEnabled} onChange={(e) => setV((x) => ({ ...x, pickupEnabled: e.target.checked }))} />
          Let customers pick up instead of shipping
        </label>
        <label className="ck-field">
          <span className="ck-mono">Pickup address</span>
          <input className="ck-input" value={v.pickupAddress} maxLength={200} onChange={(e) => setV((x) => ({ ...x, pickupAddress: e.target.value }))} />
        </label>
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
        <legend className="ck-mono" style={{ marginBottom: 6 }}>
          Shipping
        </legend>
        <div className="ck-row">
          <label className="ck-field" style={{ flex: 1 }}>
            <span className="ck-mono">Flat rate, $</span>
            <input className="ck-input" inputMode="decimal" value={v.shippingFlat} onChange={(e) => setV((x) => ({ ...x, shippingFlat: e.target.value }))} />
          </label>
          <label className="ck-field" style={{ flex: 1 }}>
            <span className="ck-mono">Free over, $ · empty for never</span>
            <input className="ck-input" inputMode="decimal" value={v.freeOver} onChange={(e) => setV((x) => ({ ...x, freeOver: e.target.value }))} />
          </label>
        </div>
        <label className="ck-field">
          <span className="ck-mono">Ships within</span>
          <input className="ck-input" value={v.shipsWithin} placeholder="3 business days" maxLength={60} onChange={(e) => setV((x) => ({ ...x, shipsWithin: e.target.value }))} />
        </label>
        <span className="ck-meta">Ships to {s.shipCountries.join(", ")}.</span>
      </fieldset>

      <label className="ck-field">
        <span className="ck-mono">Support email · on every order email</span>
        <input className="ck-input" type="email" value={v.supportEmail} onChange={(e) => setV((x) => ({ ...x, supportEmail: e.target.value }))} required />
      </label>

      <div className="ck-row">
        <button type="submit" className="btn btn--primary" disabled={busy || bad !== null}>
          {busy ? "Saving…" : "Save settings"}
        </button>
        <OutcomeLine outcome={bad ? { ok: false, text: bad } : outcome} />
      </div>
      {s.adminUrl && (
        <p className="ck-meta" style={{ margin: 0 }}>
          Terms, returns wording and countries are on{" "}
          <a href={s.adminUrl} target="_blank" rel="noreferrer">
            the site&apos;s settings page
          </a>
          .
        </p>
      )}
    </form>
  )
}
