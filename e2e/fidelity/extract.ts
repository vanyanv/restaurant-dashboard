/**
 * The half of the fidelity check that needs a DOM.
 *
 * Everything here is handed to `page.evaluate`, so each exported function must
 * be SELF-CONTAINED: it may not call anything defined outside its own body,
 * and it may not close over a module-level binding. Only `import type` is
 * allowed in this file. Break that and the failure is a bare
 * "X is not defined" from inside the page, which reads like a broken app
 * rather than a broken harness.
 *
 * The same code runs against the prototype and against us, so any
 * normalisation it applies is applied to both sides. It can therefore hide a
 * difference, but it can never invent one.
 *
 * Playwright's transform is the supported one. Running these through
 * tsx/esbuild instead (a scratch script, say) compiles them with `keepNames`,
 * which wraps every named function binding in `__name(...)` — a helper that
 * does not exist inside the page, so the evaluate dies with a bare
 * "__name is not defined". Nothing is wrong with the extractor when that
 * happens; run it through the Playwright projects.
 */
import type { Landmark, ThemedNode } from "./landmarks"

export interface ExtractArgs {
  rootSelector: string
  landmarkClasses: readonly string[]
  checkedProperties: readonly string[]
  comparedAttributes: readonly string[]
}

/** Depth-first landmark sweep, with the three normalisations CHECKED_PROPERTIES documents. */
export function extractLandmarksInPage(args: ExtractArgs): Landmark[] {
  const root = document.querySelector(args.rootSelector)
  if (!root) return []
  const out: Landmark[] = []
  let order = 0
  const elements = root.querySelectorAll("*")
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i] as HTMLElement
    const classes: string[] = []
    for (let k = 0; k < args.landmarkClasses.length; k++) {
      const c = args.landmarkClasses[k]
      if (el.classList.contains(c)) classes.push(c)
    }
    if (classes.length === 0) continue

    const cs = getComputedStyle(el)
    const style: Record<string, string> = {}
    for (let k = 0; k < args.checkedProperties.length; k++) {
      const prop = args.checkedProperties[k]
      let v = cs.getPropertyValue(prop).trim()

      if (prop === "font-family") {
        // next/font emits hashed families and the prototype emits its own
        // stack; the ROLE is what Counter rules on.
        const low = v.toLowerCase()
        if (low.indexOf("bricolage") >= 0) v = "display"
        else if (low.indexOf("jetbrains") >= 0 || low.indexOf("mono") >= 0) v = "mono"
        else if (low.indexOf("dm sans") >= 0) v = "sans"
      } else if (prop === "grid-template-columns") {
        // Chromium returns the USED value in px, which changes with the
        // viewport. The number of tracks is the design decision.
        if (v && v !== "none") {
          const stripped = v.replace(/\[[^\]]*\]/g, " ").trim()
          const parts = stripped.length ? stripped.split(/\s+/) : []
          v = parts.length + " tracks"
        }
      } else if (prop === "border-left-color") {
        // A zero-width border still reports a colour, and that colour is just
        // the inherited `color`, which `color` already checks.
        if (cs.getPropertyValue("border-left-width").trim() === "0px") v = "n/a"
      }
      style[prop] = v
    }

    // `data-n` is the strip's cell count, and the prototype's strip cells carry
    // no class of their own — without this, a strip of four passes clean
    // against a design that specifies six.
    const attrs: Record<string, string> = {}
    for (let k = 0; k < args.comparedAttributes.length; k++) {
      const name = args.comparedAttributes[k]
      const v = el.getAttribute(name)
      if (v !== null) attrs[name] = v
    }

    const rect = el.getBoundingClientRect()
    out.push({
      order: order++,
      classes,
      attrs,
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
      box: { w: Math.round(rect.width), h: Math.round(rect.height) },
      style,
    })
  }
  return out
}

export interface ThemedExtract {
  /**
   * Every element under the root that paints a colour of its own or carries
   * text, attributed to the landmark it sits inside. NOT only the landmarks —
   * see the "FIX ROUND 1" note in landmarks.ts. `.qbtn .n`, the element this
   * whole pass was written for, carries no landmark class.
   */
  nodes: ThemedNode[]
  /**
   * How many landmarks the root actually contains. The pass asserts on this
   * separately: the node sweep finds hundreds of elements on any page at all,
   * so it can no longer stand in for "this page rendered something Counter".
   */
  landmarkCount: number
  /** How many elements were swept, and how many of them painted a colour. */
  elementCount: number
  paintingCount: number
  /** Every --ct-* colour token, resolved in the theme currently rendered. */
  tokenValues: string[]
  /** Names of the tokens that resolved, for the failure message. */
  tokenNames: string[]
}

/**
 * The dark-mode sweep: what each element paints, and what the --ct-* tokens
 * resolve to right now. Comparing the two is `findThemeDefects`'s job.
 *
 * Custom properties cannot be read back resolved — `getPropertyValue("--ct-ink")`
 * returns the literal token stream `light-dark(oklch(…), oklch(…))`. So each
 * token is PROBED: an element inside the themed subtree is given
 * `color: var(--ct-ink)` and its computed `color` is read back. That is the
 * value the theme actually paints.
 */
export function extractThemedInPage(args: {
  rootSelector: string
  landmarkClasses: readonly string[]
}): ThemedExtract {
  const empty: ThemedExtract = {
    nodes: [],
    landmarkCount: 0,
    elementCount: 0,
    paintingCount: 0,
    tokenValues: [],
    tokenNames: [],
  }
  const root = document.querySelector(args.rootSelector) as HTMLElement | null
  if (!root) return empty

  // -- the token sweep -----------------------------------------------------
  const names: string[] = []
  const seenName: Record<string, boolean> = {}
  for (let s = 0; s < document.styleSheets.length; s++) {
    let rules: CSSRuleList | null = null
    try {
      rules = document.styleSheets[s].cssRules
    } catch {
      continue // a cross-origin sheet; nothing of ours lives there
    }
    const stack: CSSRule[] = []
    for (let r = 0; r < rules.length; r++) stack.push(rules[r])
    while (stack.length) {
      const rule = stack.pop() as CSSRule & { style?: CSSStyleDeclaration; cssRules?: CSSRuleList }
      if (rule.cssRules) {
        for (let r = 0; r < rule.cssRules.length; r++) stack.push(rule.cssRules[r])
      }
      if (!rule.style) continue
      for (let p = 0; p < rule.style.length; p++) {
        const name = rule.style[p]
        if (name.indexOf("--ct-") !== 0) continue
        if (seenName[name]) continue
        seenName[name] = true
        names.push(name)
      }
    }
  }

  const probe = document.createElement("span")
  probe.setAttribute("aria-hidden", "true")
  probe.style.position = "absolute"
  probe.style.left = "-9999px"
  root.appendChild(probe)
  const tokenValues: string[] = []
  const tokenNames: string[] = []
  const seenValue: Record<string, boolean> = {}
  for (let i = 0; i < names.length; i++) {
    probe.style.color = ""
    probe.style.color = "var(" + names[i] + ")"
    const v = getComputedStyle(probe).color.trim()
    // A token that holds a length or a font stack does not paint, and its
    // probe falls back to the inherited colour. Recording it anyway is
    // harmless: it can only add a value the theme genuinely renders.
    if (!v) continue
    tokenNames.push(names[i])
    if (seenValue[v]) continue
    seenValue[v] = true
    tokenValues.push(v)
  }
  probe.remove()

  // -- rasterising, so contrast maths works on oklch() ---------------------
  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D
  const rasterCache: Record<string, { r: number; g: number; b: number; a: number } | null> = {}
  const raster = (value: string): { r: number; g: number; b: number; a: number } | null => {
    // The sweep is now the whole page rather than 53 elements, and the same
    // handful of token values recur on nearly every one of them.
    if (Object.prototype.hasOwnProperty.call(rasterCache, value)) return rasterCache[value]
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = "#000000"
    ctx.fillStyle = value
    if (ctx.fillStyle === "#000000" && value.replace(/\s/g, "").toLowerCase() !== "#000000") {
      if (value.indexOf("rgba(0, 0, 0, 0)") < 0 && value !== "transparent") {
        rasterCache[value] = null
        return null
      }
    }
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    const out = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }
    rasterCache[value] = out
    return out
  }
  const over = (
    fg: { r: number; g: number; b: number; a: number },
    bg: { r: number; g: number; b: number },
  ) => ({
    r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
    g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
    b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
  })

  // -- pass one: number the landmarks, in the same depth-first order the
  //    structural sweep uses, so a defect's `order` names the same element in
  //    both reports.
  const elements = root.querySelectorAll("*")
  const landmarkOrder = new Map<Element, number>()
  const landmarkClassesOf = new Map<Element, string[]>()
  let order = 0
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    const classes: string[] = []
    for (let k = 0; k < args.landmarkClasses.length; k++) {
      const c = args.landmarkClasses[k]
      if (el.classList.contains(c)) classes.push(c)
    }
    if (classes.length === 0) continue
    landmarkOrder.set(el, order++)
    landmarkClassesOf.set(el, classes)
  }

  // -- pass two: every element that decides a colour or carries text --------
  const nodes: ThemedNode[] = []
  let paintingCount = 0
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i] as HTMLElement
    const cs = getComputedStyle(el)
    const isLandmark = landmarkOrder.has(el)

    // The nearest landmark ancestor, and this element's path down from it.
    let host: Element | null = null
    const steps: string[] = []
    let walk: Element | null = el
    while (walk && walk !== root) {
      if (landmarkOrder.has(walk)) {
        host = walk
        break
      }
      // A short, readable descriptor: the element's first class, else its tag.
      const cls = walk.classList.length ? "." + walk.classList[0] : walk.tagName.toLowerCase()
      if (steps.length < 4) steps.unshift(cls)
      walk = walk.parentElement
    }

    const parent = el.parentElement
    const inheritedColour = parent ? getComputedStyle(parent).color.trim() : ""

    const painted: Array<{ property: string; value: string }> = []
    const ownColour = cs.color.trim()
    // A landmark's own colour is always checked. A descendant's is checked
    // only when it DIFFERS from what it inherited — otherwise one literal on
    // a container is reported once per descendant and buries the element that
    // actually chose it.
    if (
      ownColour &&
      ownColour !== "transparent" &&
      ownColour.indexOf("rgba(0, 0, 0, 0)") !== 0 &&
      (isLandmark || ownColour !== inheritedColour)
    ) {
      painted.push({ property: "color", value: ownColour })
    }
    const bg = cs.backgroundColor.trim()
    if (bg && bg !== "transparent" && bg.indexOf("rgba(0, 0, 0, 0)") !== 0) {
      painted.push({ property: "background-color", value: bg })
    }
    // Borders are never inherited, so a painted one is always this element's
    // own decision.
    const sides = ["top", "right", "bottom", "left"]
    for (let s = 0; s < sides.length; s++) {
      if (cs.getPropertyValue("border-" + sides[s] + "-width").trim() === "0px") continue
      const bc = cs.getPropertyValue("border-" + sides[s] + "-color").trim()
      if (!bc || bc === "transparent" || bc.indexOf("rgba(0, 0, 0, 0)") === 0) continue
      painted.push({ property: "border-" + sides[s] + "-color", value: bc })
    }
    if (painted.length) paintingCount++

    let ownText = ""
    for (let n = 0; n < el.childNodes.length; n++) {
      const node = el.childNodes[n]
      if (node.nodeType === 3) ownText += node.nodeValue || ""
    }
    ownText = ownText.replace(/\s+/g, " ").trim()

    // Nothing painted and nothing said: not a node.
    if (painted.length === 0 && !ownText) continue

    const colours: ThemedNode["colours"] = []
    for (let c = 0; c < painted.length; c++) {
      const px = raster(painted[c].value)
      if (!px) continue
      colours.push({
        property: painted[c].property,
        value: painted[c].value,
        rgb: { r: px.r, g: px.g, b: px.b },
      })
    }

    // Contrast needs the element's own colour even when it inherited it —
    // inherited ink on a wrong background is still invisible text.
    let textColour = colours.filter((c) => c.property === "color")[0]
    if (!textColour && ownText) {
      const px = raster(ownColour)
      if (px) textColour = { property: "color", value: ownColour, rgb: { r: px.r, g: px.g, b: px.b } }
    }

    // The surface behind this element's own text: the nearest painted
    // background, composited down the ancestor chain so a wash over a card
    // over the page reads as what the eye actually sees.
    let surface: { r: number; g: number; b: number } | null = null
    let node: HTMLElement | null = el
    const layers: Array<{ r: number; g: number; b: number; a: number }> = []
    while (node) {
      const px = raster(getComputedStyle(node).backgroundColor)
      if (px && px.a > 0) {
        layers.push(px)
        if (px.a >= 0.999) break
      }
      node = node.parentElement
    }
    if (layers.length) {
      let acc = { r: 255, g: 255, b: 255 }
      for (let k = layers.length - 1; k >= 0; k--) acc = over(layers[k], acc)
      surface = acc
    }

    nodes.push({
      order: host ? (landmarkOrder.get(host) as number) : -1,
      classes: host ? (landmarkClassesOf.get(host) as string[]) : [],
      within: steps.join(" "),
      colours: textColour && colours.indexOf(textColour) < 0 ? [textColour].concat(colours) : colours,
      ownText,
      fontSizePx: parseFloat(cs.fontSize) || 0,
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
      surface,
    })
  }

  return {
    nodes,
    landmarkCount: landmarkOrder.size,
    elementCount: elements.length,
    paintingCount,
    tokenValues,
    tokenNames,
  }
}
