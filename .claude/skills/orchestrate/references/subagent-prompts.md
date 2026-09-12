# Subagent prompts

Every worker starts with an empty context. It has not read CLAUDE.md, the
spec, the plan, or the conversation. Everything it needs is in the prompt you
send, or in a file the prompt tells it to read first. These templates are the
minimum; add the repo-specific facts the task turns on.

Send prompts with the `Agent` tool. Default `subagent_type` is
`general-purpose` for anything that edits files; use `Explore` for anything
that must not — scouts and both reviewers. A reviewer that cannot write
cannot "fix it while I'm here", which is the point: its verdict stays a
verdict, and the fix stays a commit the implementer owns. Run workers in the background
unless your very next step depends on that one result.

---

## 1. Scout (read-only, before planning)

Use when you do not yet know the shape of the code the plan will touch.
Fan out several scouts in one turn, one per question.

```
You are scouting a codebase so that a plan can be written. Read-only: do not
edit anything.

Question: <one specific question — "which adapters under src/lib/counter/adapters
query a model without filtering by accountId, and what does the filter look
like in the ones that do?">

Report back, in under 300 words:
- The files and line ranges that answer the question.
- The existing pattern to copy (name the one file that models it best).
- Anything surprising that a plan author would otherwise get wrong.
Do not paste whole files. Cite `path:line` for every claim.
```

---

## 2. Implementer (one task from the plan)

```
You are implementing ONE task from a plan. Do exactly this task, nothing
beyond it.

First, read these in order:
1. `<repo>/CLAUDE.md` (project rules; obey every "never")
2. `<plan path>` — read only the header (Goal, Architecture, Global
   constraints) and then "### Task <N>" in full. Skip the other tasks.

Repo facts you need:
- Working directory: <path>. Branch: <branch>. Do NOT switch branches, do
  NOT push, do NOT run `git add .` — add the files the task names.
- The fast gate for this task: `<command>`. Run it before you commit. If it
  is red, fix it; if you cannot, stop and report — do not commit red.
- <the one or two repo-specific facts this task turns on>

Work test-first as the task's steps say: write the failing test, watch it
fail for the right reason, make it pass, run the gate, commit with the
message the task gives. Tick the checkboxes in the plan file as you complete
each step.

When done, report in this exact shape (under 200 words):
- Commit: <sha> <message>
- Files changed: <list>
- Gate: <command> → <pass/fail, and the failing line if fail>
- Deviations from the task: <none, or what and why>
- Anything the next task needs to know: <or "nothing">
```

Why this shape: the orchestrator reads dozens of these reports. A fixed shape
lets it scan for "Deviations" and "Gate: fail" without reading prose. The
"read only Task N" instruction keeps the worker's context small and stops it
from "helpfully" starting Task N+1 in the same commit.

---

## 3. Reviewer — spec compliance (`Explore`, after each implementer)

A second pair of eyes that did not write the code. Give it the task text and
the diff, not the implementer's report — the report is the implementer's
opinion of its own work.

```
You are reviewing a commit against the task that asked for it. You did not
write it. Be specific and be skeptical.

Read:
1. `<plan path>`, section "### Task <N>" only.
2. The diff: run `git show <sha>` in <repo path>.

Answer, in under 250 words:
1. Does the diff do what Task N asked — every step, no more? List anything
   asked for that is missing, and anything done that was not asked for.
2. Does it honour the plan's Global constraints? Name the constraint and
   the line that breaks it, or say "all honoured".
3. Does the test actually test the behaviour, or would it pass against a
   stub? Quote the assertion that convinces you either way.
4. Verdict: APPROVE or REQUEST CHANGES, with the one-line reason.
```

---

## 4. Reviewer — code quality (`Explore`, after spec compliance passes)

```
You are reviewing a commit for quality. Assume it does what was asked (a
separate review checked that). Look for what a careful senior reviewer flags:

Read the diff: `git show <sha>` in <repo path>. Read the surrounding code of
any function it changes.

Report, in under 250 words, only findings that matter — skip style nits the
formatter would catch:
- Correctness risks the tests do not cover (edge cases, null paths, races).
- Duplication of something the repo already has (name the existing function).
- A public signature that differs from what the plan's "Interfaces" froze.
- Anything a future reader will misunderstand without a comment that is
  not there.
Verdict: APPROVE or REQUEST CHANGES.
```

---

## 5. Fixer (when a review requests changes)

Send the SAME implementer worker a follow-up with `SendMessage` if it is
still alive (it has the context); otherwise spawn a fresh implementer with
the review's findings pasted in as the task and "amend nothing — make a new
commit on top" as a rule (rewriting a commit another worker's branch already
has under it is how parallel work gets lost).

---

## 6. Integrator (end of a phase)

```
Every task in Phase <N> of `<plan path>` has landed on branch <branch>.
Your job is to prove the phase as a whole is sound, not any one task.

1. Run the whole-project gate exactly as CLAUDE.md states it: `<gate>`.
2. If anything is red, find which task's commit introduced it
   (`git bisect` or `git log -p` on the failing file) and fix it in a new
   commit, naming the task in the message.
3. <repo-specific check the gate cannot see — e.g. "run `npm run fidelity`
   and list every page that diverges from its mock">
4. Report: gate output (last 20 lines), any fix commits, and anything that
   should change in the plan for the next phase.
```

---

## Sizing rules of thumb

- One task per worker. A worker given three tasks does the first well.
- Parallelism is bounded by disjoint files, not by how many agents you can
  spawn. Two workers editing one file produce a conflict you then resolve
  by hand with less context than either of them had.
- Prefer `isolation: "worktree"` for workers whose tasks share a file they
  must each change in different places; merge their branches yourself
  afterwards. Skip it when tasks are file-disjoint — a shared tree and
  scoped `git add` is simpler.
- A worker that has been silent past the point where its task should be
  done is not "thinking hard". Check its output file; if it has wandered,
  interrupt and re-dispatch with a tighter prompt.
