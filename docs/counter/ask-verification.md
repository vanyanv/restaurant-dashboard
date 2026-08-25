# Ask verification: `AskSurface` seen in a real browser

Task 3 of Plan 6. jsdom proves the handler runs — it cannot prove the
surface is *mounted* on a real page, which is exactly what note 46 says was
missing the first time: "two surfaces promised ⌘K and nothing opened...
Fourteen rules of dead CSS behind an advertised shortcut." This file is the
missing evidence: a real Chromium session, signed in with the
`.env.test.local` credentials, driving a throwaway route
(`src/app/counter-ask-harness/page.tsx`) that rendered `AppShell` at
`pathname="/dashboard/pnl"` with a `Topbar` titled "P&L", `params` read live
from the harness's own URL (`store` / `range`), `storeName="Hollywood"`
when `store=hollywood`, and one `Section` ("Prime cost", `askAbout`, ready
data). The harness was deleted immediately after this session — `git
status` shows no trace of it in this commit.

Method: `npm run dev` on `http://localhost:3000`, driven with the
Playwright MCP browser (real Chromium), signed in through `/login` with the
`E2E_USER_EMAIL` / `E2E_USER_PASSWORD` credentials from `.env.test.local`.
Screenshots were written to the repo root as scratch files and deleted
before this commit, matching the harness-is-throwaway policy other Counter
verification docs already follow.

## 1. Does ⌘K actually open it? (note 46)

Pressed `Meta+k` on `http://localhost:3000/counter-ask-harness?store=hollywood&range=d7`.
A `role="dialog"` `aria-label="Ask a question"` appeared, with a focused
`textbox` inside it — confirmed via an accessibility snapshot, which showed
`textbox "Ask a question" [active]`. `Control+k` was pressed next (fresh
navigation first, so no residual state) and opened the identical dialog.
Neither modifier alone (`k` with no `metaKey`/`ctrlKey`) opened anything —
consistent with the unit test, but this is the first proof it also holds on
a real page with real event listeners, not a jsdom stand-in.

This is note 46's whole point: the unit tests for a designed-but-unmounted
palette would all have passed. The thing that was missing is exactly what
this section proves — the surface answering a real keypress on a real page.

## 2. Does Escape close it and restore focus?

Clicked the "Ask about this" button first (so a real element other than
`<body>` held focus), then pressed `Meta+k` to reopen a *second* surface
instance from a keyboard shortcut while a specific element had focus,
then `Escape`. `document.activeElement` was evaluated directly:
`{ dialogPresent: false, activeTag: "BUTTON", activeText: "Ask about this" }`
— the dialog was gone and focus had returned to the exact button that held
it before the surface opened, not to `<body>`.

(An earlier check, pressing `Meta+k` with nothing yet focused, closed
correctly too but "restored" to `<body>` — the same place focus already
was. That's not a failure of the restore logic, just an uninformative case;
the button check above is the one that actually exercises it.)

## 3. Does a `Section`'s "Ask about this" open it pre-filled? (note 55)

This is the one to verify end to end rather than trust the delegation
test, because note 55 is fifty buttons that were wired to nothing. Clicked
the real `<button data-ask-about="Prime cost">Ask about this</button>`
rendered by `Section` for the "Prime cost" section. The accessibility
snapshot immediately after:

```
- dialog "Ask a question":
  - paragraph: Answering about P&L · Hollywood · Last 7 days
  - textbox "Ask a question" [active]:
    - /placeholder: Ask about this page…
    - text: Prime cost
```

The dialog opened, the textbox held focus, and its value was `Prime cost` —
the section's own title, carried by `data-ask-about` and picked up by the
surface's delegated `document` click listener with no prop on `Section` at
any point in the chain. `Section` is unmodified from Plan 2; nothing in
this plan touched it.

## 4. Is the context sentence right, and does it move with the URL? (note 43)

With `?store=hollywood&range=d7`, opening the surface showed:

> Answering about P&L · Hollywood · Last 7 days

Re-navigated to the same route with `?store=hollywood&range=d30` (a fresh
load, not a client-side param mutation, so this also proves the sentence is
read fresh on each mount rather than cached) and reopened:

> Answering about P&L · Hollywood · Last 30 days

Only the range clause changed, matching exactly the one query param that
changed. `page` came from `pathname="/dashboard/pnl"` against `NAV_GROUPS`
(never a prop the harness set directly), `store` from the `storeName` the
harness resolved for `store=hollywood`, and `range` from `PRESETS` against
`range=d30` — the same three inputs a real page already has, which is
`describeAskContext`'s entire point: derived, not passed, so it cannot
disagree with the page underneath it.

## 5. Both themes, console errors

Light theme (`localStorage.counter-theme = "light"`, which is also what
Counter's `system` pin currently resolves to — see `theme-provider.tsx`):
**0 console errors** with the surface open (2 benign warnings present in
every session regardless of theme or route: a `link rel=preload` resource
hint on a CSS chunk, and next-auth's `NEXTAUTH_URL` advisory — neither
related to this plan).

Dark theme (`localStorage.counter-theme = "dark"`, reload): **0 console
errors**, same 2 unrelated warnings.

Correctness of the theme swap itself was checked past the pixel level,
because a first screenshot pass (`page.screenshot({ scale: "css" })`) came
back visually near-identical between the two themes — a real enough finding
in this session that it's worth recording. `getComputedStyle` was queried
directly instead of trusting the PNG:

| | light | dark |
|---|---|---|
| dialog panel (`--ct-surface`) | `oklch(0.984 0.004 66)` | `oklch(0.22 0.006 66)` |
| shell background (`--ct-paper`) | `oklch(0.962 0.006 60)` | `oklch(0.19 0.007 60)` |
| backdrop ink (`--ct-ink` at 40%) | `oklab(0.24 … / 0.4)` | `oklab(0.93 … / 0.4)` |

Canvas-sampled RGB of the shell background under dark theme came back
`[22, 19, 17]` — genuinely near-black, not the mid-grey the `scale: "css"`
screenshot showed. Re-taking the screenshot with `scale: "device"` produced
the expected visual difference between the two themes (dark: near-black
rail and dialog with the red accent still legible; light: cream rail and
white dialog). The tokens and the DOM are correct; `scale: "css"`
screenshots of `light-dark()`/`oklch()` backgrounds under this headless
Chromium build are not reliable evidence on their own — later Counter
verification sessions should default to `scale: "device"` for this reason,
noted here so the next one doesn't re-diagnose the same false alarm.

The full-viewport backdrop dimming the *entire* page — rail included, not
just the main content — while the dialog is open is expected: `AskSurface`
renders `fixed inset-0`, deliberately covering everything, the same as any
other global command palette.

## Summary

| Check | Result |
|---|---|
| ⌘K opens the surface on a real page | Pass |
| Ctrl+K opens the surface on a real page | Pass |
| Bare `k` does not open it | Pass (matches unit test) |
| Escape closes it and restores focus to a real prior element | Pass |
| A `Section`'s "Ask about this" opens it pre-filled, via delegation | Pass |
| Context sentence matches the page/store/range in the URL | Pass |
| Context sentence changes when the range changes | Pass |
| Light theme, console errors | 0 |
| Dark theme, console errors | 0 |
