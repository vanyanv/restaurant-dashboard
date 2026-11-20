/**
 * Pages split into tabs (DESIGN.md "Page layout") draw every panel and hide
 * the closed ones. These read a page's panels the way the old tests read its
 * one "Every figure" fold.
 */

/** Every tab panel directly under `root`'s PageTabs, in tab order. */
export function tabPanels(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(":scope > .cu-pagetabs > .cu-pagetabs__panel")]
}

/** One panel by its tab key. */
export function tabPanel(root: ParentNode, key: string): HTMLElement {
  const p = root.querySelector<HTMLElement>(`:scope > .cu-pagetabs > .cu-pagetabs__panel[data-tab="${key}"]`)
  if (!p) throw new Error(`no tab panel "${key}"`)
  return p
}

/**
 * Everything past the Summary tab, read as one container: what used to sit in
 * the page's single fold, now spread over named tabs in the same order.
 */
export function pastSummary(root: ParentNode) {
  const panels = tabPanels(root).slice(1)
  return {
    children: panels.flatMap((p) => [...p.children]) as HTMLElement[],
    querySelectorAll: (sel: string) => panels.flatMap((p) => [...p.querySelectorAll<HTMLElement>(sel)]),
    querySelector: (sel: string) => panels.map((p) => p.querySelector<HTMLElement>(sel)).find(Boolean) ?? null,
  }
}
