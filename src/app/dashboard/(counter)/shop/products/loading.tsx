"use client"

import { Section } from "@/components/counter"
import { ShopHead } from "../shop-ui"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function Loading() {
  return (
    <>
      <ShopHead sub="Loading" />
      <Section bare title="Products" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
