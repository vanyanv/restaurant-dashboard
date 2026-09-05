# The Ask page — design

**Status:** APPROVED 2026-09-05 (the owner: "let's build out the mock exactly").
**Reference:** `docs/counter/ask-page-mock.html` — a live HTML mock built in
Counter's own tokens and the prototype's Ask CSS. It is the thing this work is
measured against, the way `counter-prototype.html` is for every other page.
`docs/counter/ask-motion-mock.html` holds the motion studies the page's
transitions come from. Both were reviewed in a browser, light and dark.

This is the surface half of `2026-08-27-ask-system-design.md`'s Ask, and of the
Sept-4 architecture proposal ("Rebuilding Ask"). It builds nothing the router,
the answer cache or the presentation payloads need; it builds the page those
land in.

## What the page is

A three-part surface, desk and phone:

1. **The conversations rail** (206px, the prototype's width) — header with
   "New", a search that reads titles and turn text (`?cq=`), rows grouped by
   day (`groupThreadsByDay`), the open thread marked, a ⋯ menu on each row
   (Rename · Fork from the end · Delete), inline rename, an in-place two-step
   delete ("Delete for good?" · Delete / Keep), a footer with the thread count
   and a two-step "Delete all". `/` from anywhere on the page focuses the
   search.
2. **The thread column** — the conversation head (title, origin · store ·
   window, Rename / Delete; "Threads" on the phone), the turns, a day
   separator where a thread crossed midnight, a "New answer" pill when the
   reader has scrolled up while a turn runs, and under every answer a turn
   footer: sources read · cost · seconds · 👍 👎 (👎 asks one of four reasons)
   · Fork from here · Copy.
3. **The docked composer** — a scope row naming the store and window the next
   question is asked under, a textarea that grows to five lines, Enter sends
   and Shift-Enter breaks, `/` opens the five shortcuts from `composer.ts`,
   the send button becomes **Stop** while a turn runs (Esc stops too), and a
   hints row on the desk.

**A stopped turn is kept.** Stopping marks the turn "Stopped after N s · M of K
sources read · the question is kept" with a Continue button that asks the
same question again as a follow-up. The question is never thrown away (F-R10).

**The empty state** is "Ask about {store}." with six department starters and
"Pick up where you left off" — the four most recent threads.

**Phone:** the rail is a bottom sheet (`PhoneSheet`) opened from "Threads" in
the head; same search, groups and ⋯ actions. The composer docks above the
tabs and carries the mic.

## Decisions

- **D1 — Rail actions reuse the thread-actions contract.** Rename and delete
  from the rail call the same `renameAskThread` / `deleteAskThread` the head
  calls, with the same 80-character rule and the same arming step.
- **D2 — Cost and seconds are real or absent.** The footer prints
  `AiUsageEvent.estimatedCostUsd` and `durationMs` for the turn — carried on
  the message as metadata for a live turn, joined from `ChatTurn` for a
  restored one. A turn with no usage row prints no cost; it never estimates.
- **D3 — A thumb writes `ChatTurn.feedback`.** `up`, or `down:<reason>` where
  reason ∈ number · scope · refused · slow. The column has existed since the
  table did and has been null on every row.
- **D4 — Fork is the existing `forkConversation`.** "Fork from here" branches
  through that turn's assistant message; "Fork from the end" through the last.
  The fork opens as the current thread.
- **D5 — Delete all is two-step, like delete.** It calls the existing
  `deleteAllConversations`.
- **D6 — Scope chips are statements, not controls.** The composer's scope row
  names the store and window; the `DateControl` in the page head and the
  store switcher in the rail remain the only places scope is changed. (The
  mock draws them as buttons; the page does not add a third control for one
  fact.)
- **D7 — Nothing dead ships.** Anything whose backend does not exist yet is
  left out of the page rather than rendered as a button that does nothing:
  *Save as a question* and the scheduled-question rail group (Phase 3),
  *prior-question recall* (Phase 3), the *photo attach* button (sub-project
  4), swipe-to-delete on the phone sheet (⋯ does the same). The mic ships only
  if its transcription route ships in the same change.

## Not gated by fidelity, verified by hand

`e2e/fidelity/manifest.ts` explains why `ask` is reported and not gated: the
prototype renders an answer and a bare route cannot. So this work is verified
against the mock in a real browser — desk at 1440 and phone at 390, light and
dark — with screenshots kept under `docs/counter/measurements/`, and by the
standing gate (`npm run tokens && npx tsc --noEmit --incremental false &&
npm run build`).
