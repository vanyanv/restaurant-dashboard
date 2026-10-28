"use client"

import { PageHead, Section, SubNav } from "@/components/counter"
import { MENU_TABS } from "@/lib/counter/nav"
import { loading } from "@/lib/counter/section-data"

/** New menu item's loading boundary: the head and tabs stay put while the lists load. */
export default function NewMenuItemLoading() {
  return (
    <>
      <PageHead title="New menu item" sub="Loading" />
      <SubNav items={MENU_TABS} label="Menu" />
      <Section bare title="New menu item" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
