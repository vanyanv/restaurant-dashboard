"use client"

import { PageHead, Section, SubNav, useSurfaceHref } from "@/components/counter"
import { MENU_TABS } from "@/lib/counter/nav"
import { loading } from "@/lib/counter/section-data"

/** New menu item's loading boundary on a phone: the head and tabs stay put while the lists load. */
export default function MobileNewMenuItemLoading() {
  const surface = useSurfaceHref()
  return (
    <>
      <PageHead title="New menu item" sub="Loading" />
      <SubNav items={MENU_TABS.map((t) => ({ ...t, href: surface(t.href) }))} label="Menu" />
      <Section bare title="New menu item" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
