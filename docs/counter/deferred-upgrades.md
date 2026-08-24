# Deferred Dependency Upgrades

Task 2 (2026-08-23) cleared all non-breaking security advisories, but the following packages have upgrades available that would introduce breaking changes.

| Package | From → To | Why deferred | Blocks |
|---------|-----------|--------------|--------|
| prisma | 7.9.1 → 6.12.0 | Would fix deepmerge-ts stack exhaustion advisory, but requires MAJOR VERSION DOWNGRADE (7→6), which violates modernization direction | None (Task 3–9 upgrades do not touch Prisma); awaits upstream deepmerge-ts fix or Prisma 8.0+ release |

## Known landmine: cosmiconfig's TypeScript loader under TypeScript 7 (not a deferred upgrade)

Task 8 (2026-08-24) upgraded `typescript` to `7.0.2`, the native Go-ported compiler. Its
package no longer ships the classic Compiler API (`typescript/lib/typescript.js`) — only
a `bin/tsc` CLI shim over a native binary. `shadcn@3.8.5` transitively pulls in
`cosmiconfig@9.0.2`, whose `dist/loaders.js` defines `loadTsSync`/`loadTsAsync` loaders
that `require('typescript')` and then call `.transpileModule`, `.findConfigFile`, and
`.sys.fileExists` — none of which exist on TS7's restructured package export surface.
That code path throws if it is ever reached.

**Why it's not reachable today:** shadcn's CLI constructs its cosmiconfig search with
`searchPlaces: ["components.json"]` (JSON only), so cosmiconfig's TS loader is never
invoked. shadcn is also not wired into any `npm` script in this repo — it's only ever
run ad hoc via `npx shadcn@latest ...`.

**What would make it reachable:** any change that gives cosmiconfig a `searchPlaces`
entry ending in `.ts` (e.g. a future shadcn config format, a different cosmiconfig
consumer added to the repo, or someone hand-rolling a `cosmiconfig(...)` call with a
`.ts`-inclusive search list) would hit `loadTsSync`/`loadTsAsync` and throw under TS7.

Flag for whoever next touches shadcn or adds a cosmiconfig-based tool: if you introduce
or change a `searchPlaces` list, check whether it includes `.ts`, and if so, verify it
actually works under TS7 before shipping — don't assume cosmiconfig's TS loader still
works just because `npx tsc` is clean.

**Re-verified under shadcn 4.19.0 (dependency-sweep closing task):** shadcn was upgraded
from 3.8.5 to 4.19.0. Re-grepped the shipped 4.19.0 bundle for every `cosmiconfig(...)`
construction site and found two — both still JSON-only, still dormant:

```js
cosmiconfig("components", { searchPlaces: ["components.json"] })
cosmiconfig("registries", { packageProp: "registries", searchPlaces: ["package.json"] })
```

The second (`registries`) is new in shadcn 4, backing the multi-registry feature — it
reads the `"registries"` key out of `package.json`, also JSON-only. shadcn 4.19.0's own
declared dependency is still `cosmiconfig: "^9.0.0"`, and the resolved lockfile version
is unchanged at `cosmiconfig@9.0.2`. No `.ts`-suffixed `searchPlaces` entry was
introduced. `npx shadcn@4 info` was run against this repo's real `components.json` (not
just `--version`) and completed with no error, exercising the exact config-load path the
landmine sits on. Verdict unchanged: **dormant**.

## Known state: `@types/node` is now ahead of the runtime it types (not a deferred upgrade)

`@types/node` was taken to `26.2.0` in the same dependency-sweep-closing pass that
brought shadcn to 4 and `@google/genai` to 2. Unlike the landmine above, this isn't a
codepath that throws — it's a quieter mismatch worth recording plainly:

- Local dev runtime is Node `v20.20.0`.
- The deployment target (Vercel) currently defaults new projects to Node 24.
- `@types/node@26.2.0` describes the Node 26 API surface.

So `tsc` is now typechecking against a Node major this project doesn't run on anywhere
(not locally, not in prod). `npx tsc --noEmit` and `npm run typecheck:scripts` were both
clean immediately after the bump (0 errors), so nothing forced adoption of a Node-26-only
API in this pass — but that's a snapshot, not a guarantee: future code could pass `tsc`
while quietly relying on an API that doesn't exist on Node 20 or 24 at runtime, and
nothing in this repo would catch it before deploy.

**Why this was allowed to happen:** this repo has no `engines` field in `package.json`
and no `.nvmrc`, so there is no committed source of truth for which Node major this
project targets. That absence is what let `@types/node` drift three majors ahead of the
runtime without anything flagging it.

**Correct follow-up (not done here, out of scope for a dependency-version bump):** pin
the intended Node major via `engines` in `package.json` and/or `.nvmrc`, matching
whichever of {20 local, 24 Vercel-default, or a deliberately chosen newer target} this
project actually intends to run on — then keep `@types/node` aligned with that pin going
forward.
