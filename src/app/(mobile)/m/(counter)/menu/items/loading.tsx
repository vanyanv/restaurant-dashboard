"use client"

import { PageHead, Section, SubNav, useSurfaceHref } from "@/components/counter"
import { MENU_TABS } from "@/lib/counter/nav"
import { loading } from "@/lib/counter/section-data"

/** Menu items' loading boundary on a phone: the head and tabs stay put while the list loads. */
export default function MobileMenuItemsLoading() {
  const surface = useSurfaceHref()
  return (
    <>
      <PageHead title="Menu items" sub="Loading" />
      <SubNav items={MENU_TABS.map((t) => ({ ...t, href: surface(t.href) }))} label="Menu" />
      <Section bare title="Menu items" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
