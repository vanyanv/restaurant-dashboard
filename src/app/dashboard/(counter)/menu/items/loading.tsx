"use client"

import { PageHead, Section, SubNav } from "@/components/counter"
import { MENU_TABS } from "@/lib/counter/nav"
import { loading } from "@/lib/counter/section-data"

/** Menu items' loading boundary: the head and tabs stay put while the list loads. */
export default function MenuItemsLoading() {
  return (
    <>
      <PageHead title="Menu items" sub="Loading" />
      <SubNav items={MENU_TABS} label="Menu" />
      <Section bare title="Menu items" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
