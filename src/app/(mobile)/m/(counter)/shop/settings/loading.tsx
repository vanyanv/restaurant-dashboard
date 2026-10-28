"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"
import { ShopHead } from "@/app/dashboard/(counter)/shop/shop-ui"

/** Shop's loading boundary: the tabs stay put while the panel loads. */
export default function Loading() {
  return (
    <>
      <ShopHead sub="Loading" />
      <Section title="Settings" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
