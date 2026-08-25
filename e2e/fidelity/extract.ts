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
import type { Landmark, ThemedLandmark } from "./landmarks"

export interface ExtractArgs {
  rootSelector: string
  landmarkClasses: readonly string[]
  checkedProperties: readonly string[]
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

    const rect = el.getBoundingClientRect()
    out.push({
      order: order++,
      classes,
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
      box: { w: Math.round(rect.width), h: Math.round(rect.height) },
      style,
    })
  }
  return out
}

export interface ThemedExtract {
  landmarks: ThemedLandmark[]
  /** Every --ct-* colour token, resolved in the theme currently rendered. */
  tokenValues: string[]
  /** Names of the tokens that resolved, for the failure message. */
  tokenNames: string[]
}

/**
 * The dark-mode sweep: what each landmark paints, and what the --ct-* tokens
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
  const root = document.querySelector(args.rootSelector) as HTMLElement | null
  if (!root) return { landmarks: [], tokenValues: [], tokenNames: [] }

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
  const raster = (value: string): { r: number; g: number; b: number; a: number } | null => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = "#000000"
    ctx.fillStyle = value
    if (ctx.fillStyle === "#000000" && value.replace(/\s/g, "").toLowerCase() !== "#000000") {
      // fillStyle rejected the value and kept the previous one
      if (value.indexOf("rgba(0, 0, 0, 0)") < 0 && value !== "transparent") return null
    }
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }
  }
  const over = (
    fg: { r: number; g: number; b: number; a: number },
    bg: { r: number; g: number; b: number },
  ) => ({
    r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
    g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
    b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
  })

  // -- the landmark sweep --------------------------------------------------
  const landmarks: ThemedLandmark[] = []
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
    const painted: Array<{ property: string; value: string }> = []
    const push = (property: string, value: string) => {
      const v = (value || "").trim()
      if (!v || v === "transparent" || v.indexOf("rgba(0, 0, 0, 0)") === 0) return
      painted.push({ property, value: v })
    }
    push("color", cs.color)
    push("background-color", cs.backgroundColor)
    const sides = ["top", "right", "bottom", "left"]
    for (let s = 0; s < sides.length; s++) {
      if (cs.getPropertyValue("border-" + sides[s] + "-width").trim() === "0px") continue
      push("border-" + sides[s] + "-color", cs.getPropertyValue("border-" + sides[s] + "-color"))
    }

    const colours: ThemedLandmark["colours"] = []
    for (let c = 0; c < painted.length; c++) {
      const px = raster(painted[c].value)
      if (!px) continue
      colours.push({
        property: painted[c].property,
        value: painted[c].value,
        rgb: { r: px.r, g: px.g, b: px.b },
      })
    }

    let ownText = ""
    for (let n = 0; n < el.childNodes.length; n++) {
      const node = el.childNodes[n]
      if (node.nodeType === 3) ownText += node.nodeValue || ""
    }

    // The surface behind this element's own text: the nearest painted
    // background, composited down the ancestor chain so a wash over a card
    // over the page reads as what the eye actually sees.
    let surface: { r: number; g: number; b: number } | null = null
    let node: HTMLElement | null = el
    const layers: Array<{ r: number; g: number; b: number; a: number }> = []
    while (node) {
      const bg = getComputedStyle(node).backgroundColor
      const px = raster(bg)
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

    landmarks.push({
      order: order++,
      classes,
      colours,
      ownText: ownText.replace(/\s+/g, " ").trim(),
      fontSizePx: parseFloat(cs.fontSize) || 0,
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
      surface,
    })
  }

  return { landmarks, tokenValues, tokenNames }
}
