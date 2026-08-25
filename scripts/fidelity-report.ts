/**
 * Renders the committed fidelity reports.
 *
 * `npm run fidelity` writes one JSON per page per project into
 * .fidelity/ (gitignored). This turns those into
 * docs/counter/fidelity/<pageId>.md, which IS committed — that file is the
 * record of how far a page is from its design, and Phase C is measured
 * against it.
 *
 * Run it after a fidelity run:
 *   npm run fidelity -- --grep overview
 *   npm run fidelity:report
 */
import fs from "node:fs"
import path from "node:path"

interface Difference {
  kind: "missing" | "extra" | "style"
  order: number
  classes: string[]
  property?: string
  prototype?: string
  ours?: string
}

interface ThemeDefect {
  kind: "literal" | "contrast"
  order: number
  classes: string[]
  property: string
  value: string
  detail: string
}

interface Data {
  protoId: string
  name: string
  status: string
  route: string
  protoRoute: string
  project: string
  surface: string
  capturedAt: string
  gated?: boolean
  proto?: { count: number; tally: Record<string, number> }
  ours?: { count: number; tally: Record<string, number> }
  differences?: Difference[]
  differencesTruncated?: number
  dark?: { landmarks: number; tokens: number; defects: ThemeDefect[] }
}

const DATA_DIR = path.resolve(__dirname, "../.fidelity")
const OUT_DIR = path.resolve(__dirname, "../docs/counter/fidelity")

function where(d: Difference | ThemeDefect): string {
  return `\`#${d.order} .${d.classes.join(".")}\``
}

function section(d: Data): string[] {
  const out: string[] = []
  const proto = d.proto?.count ?? 0
  const ours = d.ours?.count ?? 0
  out.push(`## ${d.project} — ${d.surface}`)
  out.push("")
  out.push(
    `**The prototype renders ${proto} landmarks on this page. We render ${ours}.**`,
  )
  out.push("")

  const classes = [
    ...new Set([...Object.keys(d.proto?.tally ?? {}), ...Object.keys(d.ours?.tally ?? {})]),
  ].sort()
  if (classes.length) {
    out.push("| landmark | prototype | ours |")
    out.push("|---|---:|---:|")
    for (const c of classes) {
      out.push(`| \`.${c}\` | ${d.proto?.tally?.[c] ?? 0} | ${d.ours?.tally?.[c] ?? 0} |`)
    }
    out.push("")
  }

  const diffs = d.differences ?? []
  const missing = diffs.filter((x) => x.kind === "missing")
  const extra = diffs.filter((x) => x.kind === "extra")
  const style = diffs.filter((x) => x.kind === "style")

  const matched = proto - missing.length
  out.push(
    `Structure: ${missing.length} missing, ${extra.length} extra, ${matched} ` +
      `matched.` +
      (matched === 0
        ? ` Rendering was not compared: the two sides have no landmark in ` +
          `common, so there is nothing here to be right or wrong about. ` +
          `"0 rendering differences" would be a lie, and the gated rendering ` +
          `pass fails outright on this.`
        : ` Rendering (light): ${style.length} property differences on the ` +
          `${matched} landmarks present on both sides.`) +
      (d.differencesTruncated ? ` (${d.differencesTruncated} more not listed.)` : ""),
  )
  out.push("")

  if (missing.length) {
    out.push("### Missing — the prototype has these and we do not")
    out.push("")
    for (const m of missing) out.push(`- ${where(m)}`)
    out.push("")
  }
  if (extra.length) {
    out.push("### Extra — we render these and the prototype does not")
    out.push("")
    for (const m of extra) out.push(`- ${where(m)}`)
    out.push("")
  }
  if (style.length) {
    out.push("### Rendering differences")
    out.push("")
    out.push("| landmark | property | prototype | ours |")
    out.push("|---|---|---|---|")
    for (const s of style.slice(0, 200)) {
      out.push(
        `| ${where(s)} | \`${s.property}\` | \`${s.prototype ?? ""}\` | \`${s.ours ?? ""}\` |`,
      )
    }
    if (style.length > 200) out.push("")
    if (style.length > 200) out.push(`_${style.length - 200} more not listed._`)
    out.push("")
  }

  if (d.dark) {
    out.push("### Dark mode — asserted on its own terms, never against the prototype")
    out.push("")
    out.push(
      `${d.dark.landmarks} landmarks checked against ${d.dark.tokens} resolved ` +
        `\`--ct-*\` tokens. ${d.dark.defects.length} defects.`,
    )
    out.push("")
    for (const x of d.dark.defects) {
      out.push(`- **${x.kind}** ${where(x)} \`${x.property}\` — ${x.value}: ${x.detail}`)
    }
    out.push("")
  }

  return out
}

function main(): void {
  if (!fs.existsSync(DATA_DIR)) {
    console.error(
      `No fidelity data at ${DATA_DIR}. Run \`npm run fidelity\` first — the ` +
        `report is rendered from what the suite measured, never from anything ` +
        `written by hand.`,
    )
    process.exit(1)
  }
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"))
  if (!files.length) {
    console.error(`No fidelity data files in ${DATA_DIR}.`)
    process.exit(1)
  }

  const byPage = new Map<string, Data[]>()
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8")) as Data
    const list = byPage.get(d.protoId) ?? []
    list.push(d)
    byPage.set(d.protoId, list)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  for (const [protoId, datas] of byPage) {
    datas.sort((a, b) => a.project.localeCompare(b.project))
    const first = datas[0]
    const lines: string[] = []
    lines.push(`# Fidelity — ${first.name} (\`${protoId}\`)`)
    lines.push("")
    lines.push(
      `Route \`${first.route}\` · manifest status **${first.status}**` +
        (first.gated === false ? " · captured, not gated" : "") +
        ` · measured ${first.capturedAt.slice(0, 10)}`,
    )
    lines.push("")
    lines.push(
      "Generated by `npm run fidelity:report` from what `npm run fidelity` " +
        "measured. Do not edit by hand — re-run it.",
    )
    lines.push("")
    for (const d of datas) lines.push(...section(d))
    fs.writeFileSync(path.join(OUT_DIR, `${protoId}.md`), lines.join("\n"))
    console.log(`wrote docs/counter/fidelity/${protoId}.md (${datas.length} projects)`)
  }
}

main()
