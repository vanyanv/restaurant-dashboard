# The fidelity gate

`npm run tokens` checks colour literals, status branching and import
boundaries. It has no opinion about whether a page matches its design. That is
how an Overview with six bordered cards shipped against a design with sixteen
structural elements, and how it survived seven plans and a permanently green
gate. This directory is the record of the thing that can see the difference.

> **A page is not done until `npm run fidelity -- --grep <pageId>` is clean on
> both projects and both themes, its manifest entry says `"counter"`, and its
> report is committed.**
>
> Run it twice: once while building, and once more after the last fix, from a
> cold `npm run build && npm run start` rather than the dev server. Dev-mode
> rendering has hidden fidelity defects on this project before — the doubled
> shell and the dead `border-ct-*` utilities both looked fine until a
> production build.

## Running it

```bash
npm run dev                            # or build && start for the second run
npm run fidelity                       # every page, both projects
npm run fidelity -- --grep overview    # one page
npm run fidelity:report                # renders docs/counter/fidelity/<pageId>.md
npm run e2e:report                     # the HTML report, with both screenshots attached
```

`npm run fidelity` writes raw measurements to `.fidelity/` (gitignored).
`npm run fidelity:report` turns those into the `<pageId>.md` files here, which
**are** committed. Do not edit a report by hand — it is evidence, and the only
honest way to change it is to change the page and re-measure.

## What it does

Three passes per page, per device project (`fidelity` at 1440×900, and
`fidelity-mobile` on a Pixel 7 against the prototype's phone composition).
Ruling F-R2: three, not two.

1. **Structure.** The ordered sequence of structural landmarks must match the
   prototype's, failing by naming every missing and every extra element. This
   is the pass that catches a table where prototype note 33 specifies cards.
2. **Rendering, in light, against the prototype.** For every landmark present
   on both sides, eighteen computed properties must agree.
3. **Dark, on its own terms — never against the prototype.** The prototype's
   application tokens are declared light-only and dark mode is this project's
   own design. The ported stylesheet also inherited 35 colour literals from it,
   and `.qbtn[aria-pressed="true"]` paints `var(--ink)` — near-white in dark —
   behind a hardcoded light grey. A gate that compared dark against the
   prototype would call that invisible text a perfect match, because the
   prototype does exactly the same. So dark asserts two rules of its own:
   every colour a landmark renders resolves through a `--ct-*` token, and text
   keeps its contrast against the surface it actually sits on.

Two separate structure and rendering passes because they fail for different
reasons and want different fixes. "You did not build this element" and "you
built it and it looks wrong" collapse into one unreadable failure otherwise.

**Compared by structure, never by pixel.** The prototype's figures are invented
(142 guest reviews, "3 need you", a $4.12→$4.86 beef price) and ours come from a
real database, so an image diff is almost entirely noise. Text is compared for
*presence* only: an element that should carry text and carries none is a
defect; one carrying a different number is not.

## The manifest is the progress board

`e2e/fidelity/manifest.ts` lists all 53 prototype pages with a status.

- `"editorial"` — not rebuilt yet. **Skipped, not failed.**
- `"counter"` — claims to be built. Gated: all three passes must be clean.

A page flips to `"counter"` in the same commit that rebuilds it. That makes
`npm run fidelity` a live count of how much of the design is genuinely built,
and makes it impossible to call a page done without turning its own gate on.

A page may not flip to `"counter"` while any class it emits still resolves a
colour to a literal. Inherited literals are fixed by the task that first emits
their class — that task is the only one positioned to choose the right token
and see the result in both themes, and its own fidelity run is what proves it.

`report: true` is a third thing, and only Overview carries it: capture and
commit a report even while the page is still `"editorial"`. Overview is the
page that proved the problem and `overview.md` is the "before" this project is
measured against. It is captured, never gated — marking it `"counter"` to force
the gate would make `npm run fidelity` red from its first commit, and a
permanently red gate is exactly as ignorable as the permanently green one that
let the gap open.

Once a page passes, set its `baseline` counts. A later run that finds fewer
landmarks than the day it passed is a silent regression, and the structure pass
says so.

## The harness is itself under test

A comparison that finds nothing on **both** sides would report "no differences"
and pass forever — strictly worse than having no gate, because it would be
believed. A selector typo, a prototype navigation that silently no-opped, a
page that redirected to `/login`: all three produce two empty landmark lists.

So `compareLandmarks([], [])` **throws**, `findThemeDefects` throws on no
landmarks and on an empty token sweep, the rendering pass fails when it matched
nothing to compare, and `openPrototype` confirms three independent times that
the navigation it asked for actually happened before it hands back a locator.
`tests/e2e/landmarks.test.ts` unit-tests all of it against hand-written
fixtures, and every case in it was proved able to fail before it was allowed to
be green.

## Where things are

| | |
|---|---|
| `e2e/fidelity/manifest.ts` | the 53 pages and their status |
| `e2e/fidelity/prototype.ts` | driving the vendored prototype, and asserting it moved |
| `e2e/fidelity/landmarks.ts` | the comparison, as pure functions — no DOM |
| `e2e/fidelity/extract.ts` | the half that runs inside the page |
| `e2e/fidelity/fidelity.spec.ts` | the three passes |
| `tests/e2e/landmarks.test.ts` | the harness's own tests |
| `scripts/fidelity-report.ts` | `.fidelity/*.json` → `docs/counter/fidelity/*.md` |
