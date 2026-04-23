import { chromium } from "@playwright/test"
import { resolve } from "node:path"

const STATE_PATH = resolve(process.cwd(), "tmp-screenshots/_auth/state.json")

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    storageState: STATE_PATH,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
  })
  const page = await context.newPage()
  const url = process.argv[2] ?? "http://localhost:3000/dashboard/orders"
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 })
  const info = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    docScrollWidth: document.documentElement.scrollWidth,
    docClientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    dpr: window.devicePixelRatio,
    hasViewportMeta: !!document.querySelector('meta[name="viewport"]'),
    viewportMeta:
      document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null,
  }))

  // Find elements whose scrollWidth pushes body scroll past viewport.
  // We want elements that themselves exceed the viewport AND are NOT inside
  // an ancestor with overflow:auto/scroll/hidden (because those contain the overflow).
  const overflowers = await page.evaluate(`
    (() => {
      const vw = window.innerWidth;
      const describe = (el) => {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? '#' + el.id : '';
        const cls = el.className && typeof el.className === 'string'
          ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.')
          : '';
        return (tag + id + cls).slice(0, 140);
      };
      const isContained = (el) => {
        let n = el.parentElement;
        while (n && n !== document.documentElement) {
          const cs = getComputedStyle(n);
          const ox = cs.overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') {
            return true;
          }
          n = n.parentElement;
        }
        return false;
      };
      const list = [];
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        const r = el.getBoundingClientRect();
        if (r.right - 1 > vw && r.width > 50 && !isContained(el)) {
          list.push({ sel: describe(el), right: Math.round(r.right), width: Math.round(r.width) });
        }
      }
      const byKey = new Map();
      for (const o of list) {
        const prev = byKey.get(o.sel);
        if (!prev || o.right > prev.right) byKey.set(o.sel, o);
      }
      return Array.from(byKey.values()).sort((a, b) => b.right - a.right).slice(0, 15);
    })()
  `) as Array<{ sel: string; right: number; width: number }>

  const drpInfo = await page.evaluate(`
    (() => {
      const el = document.querySelector('.drp-shell');
      if (!el) return null;
      return {
        total: Math.round(el.getBoundingClientRect().width),
        kids: Array.from(el.children).map((c) => ({
          tag: c.tagName.toLowerCase(),
          cls: (c.className || '').slice(0, 80),
          display: getComputedStyle(c).display,
          width: Math.round(c.getBoundingClientRect().width),
          right: Math.round(c.getBoundingClientRect().right),
        })),
      };
    })()
  `)

  console.log(JSON.stringify({ info, overflowers, drpInfo }, null, 2))

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
