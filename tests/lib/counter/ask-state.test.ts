// The bundle boundary around the Ask surface, asserted.
//
// Everything here guards ONE regression, and it is invisible without a test:
// re-joining the pure Ask state to the hook that calls the model costs no type
// error, no lint failure and no broken behaviour. It shows up only as ~40 KB
// of AI SDK on the initial JavaScript of all 42 Counter routes, for a palette
// that is not on screen until someone presses ⌘K.
//
// The chain being protected, from the leaf up:
//
//   lib/counter/ask-state.ts        pure — no SDK, safe to import anywhere
//   lib/counter/use-ask.ts          the hook — imports @ai-sdk/react and ai
//   components/counter/ask/ask-mount.tsx    the only importer of the hook
//   components/counter/shell/app-shell.tsx  loads ask-mount via next/dynamic
//
// Break any link and the SDK is back in every route.

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const SRC = join(process.cwd(), "src")
const ASK_STATE = join(SRC, "lib/counter/ask-state.ts")
const USE_ASK = join(SRC, "lib/counter/use-ask.ts")
const ASK_DIR = join(SRC, "components/counter/ask")
const APP_SHELL = join(SRC, "components/counter/shell/app-shell.tsx")

const SDK = /from\s+"(@ai-sdk\/[^"]+|ai)"/

describe("the Ask bundle boundary", () => {
  it("keeps ask-state.ts free of the AI SDK", () => {
    const src = readFileSync(ASK_STATE, "utf8")
    expect(src).not.toMatch(SDK)
    // Nor by the back door: importing the hook would pull the SDK transitively.
    expect(src).not.toMatch(/from\s+"\.\/use-ask"/)
  })

  it("keeps the SDK in use-ask.ts, which is where it belongs", () => {
    // Not an accident to be tidied away — this is the single entry point, and
    // the test above is only meaningful if the SDK is genuinely still here.
    expect(readFileSync(USE_ASK, "utf8")).toMatch(SDK)
  })

  it("lets only ask-mount.tsx import the hook", () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          walk(p)
          continue
        }
        if (!p.endsWith(".ts") && !p.endsWith(".tsx")) continue
        if (p === USE_ASK) continue
        const src = readFileSync(p, "utf8")
        if (/from\s+"@\/lib\/counter\/use-ask"/.test(src)) offenders.push(p)
      }
    }
    walk(SRC)

    // The two Ask PAGES are allowed: they are the surface whose whole purpose
    // is asking the model, they are two routes rather than forty-two, and
    // their own bundles are where the SDK belongs.
    const allowed = [
      join(ASK_DIR, "ask-mount.tsx"),
      join(SRC, "app/dashboard/(counter)/ask/counter-ask-client.tsx"),
      join(SRC, "app/(mobile)/m/(counter)/ask/counter-phone-ask-client.tsx"),
    ]
    expect(offenders.filter((f) => !allowed.includes(f))).toEqual([])
  })

  it("loads ask-mount lazily from the shell, not with a bare import", () => {
    const src = readFileSync(APP_SHELL, "utf8")
    // A static `import { AskMount } from …` would undo the whole split: the
    // shell is re-exported from the barrel that ~100 files import.
    expect(src).not.toMatch(/^import .*ask-mount/m)
    expect(src).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\("@\/components\/counter\/ask\/ask-mount"\)/)
  })

  it("keeps the ask entry point free of the SDK, so a page may import it", () => {
    // AskBar, AskSheet, AskAnswerBody and AskComposer are presentational and
    // are rendered by four page clients. They read an AskState; they must not
    // drag in the thing that produces one.
    for (const f of readdirSync(ASK_DIR).filter((f) => f.endsWith(".tsx"))) {
      if (f === "ask-mount.tsx") continue
      expect(readFileSync(join(ASK_DIR, f), "utf8")).not.toMatch(SDK)
    }
  })
})
