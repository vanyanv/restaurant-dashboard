---
name: orchestrate
description: "Run multi-step engineering work as an orchestrator: scope it, scout the code with read-only subagents, write a task-by-task plan with frozen interfaces, dispatch each task to a fresh implementer subagent, review every commit with an independent reviewer, integrate, and run the repo's whole-project gate. Use this whenever the user asks to plan and build a feature, implement a spec or plan file, break work into tasks, use subagents or agents in parallel, run an audit or fix-up across many files, refactor something large, or hands over any task that will touch more than three files or has parts that could run side by side — even if they never say 'orchestrate', 'plan', or 'subagent'. Also use it when a plan already exists (docs/plans/*.md, docs/superpowers/plans/*.md) and the user says to execute, run, or implement it. Do not use it for a one-file fix, a question, or a change you can finish and verify in a few minutes yourself."
---

# Orchestrate

You are the orchestrator. You do not write the code; you decide what gets
built, in what order, by whom, and you are the only one who sees the whole.
Workers are capable but start with an empty context, and each one is at its
best on a single, sharply bounded task. Your job is to make every task that
sharp, keep your own context small enough to stay sharp yourself, and never
take a worker's word for its own work.

> The `references/` paths below are relative to this SKILL.md's own directory
> (the skill folder), not to the repo you are working in. Read them from there.

Argument received: `$ARGUMENTS` (a task description, or a path to a plan or
spec). If it is empty, ask the user what to build before doing anything else.

## First decide whether to orchestrate at all

Orchestration costs a plan, several agents and their round trips. It pays
for itself when the work has parts that can proceed side by side, or is too
large to hold in one context, or needs a reviewer who did not write it. It
does not pay for a one-file change. If you can finish and verify the task
yourself in a few minutes, do that and say so. Over-orchestrating a small
task is a common failure and the user notices it as slowness.

If you have no `Agent` tool in this session (you are yourself a subagent, or
the harness does not offer one), you cannot dispatch. Do the work directly,
still in the plan's shape, and say in your report that it was done
single-handed and why.

## The loop

### 1. Scope

Restate the goal in one sentence: what is true when this is done that is
not true now. Read the repo's `CLAUDE.md` (and `DESIGN.md` or equivalents
it points to) yourself, in full — workers will each read it too, but you
are the one who must know which rules the gate cannot enforce. Copy the
whole-project gate verbatim; you will paste it into every prompt.

If a plan already exists, read its header and skim its task titles, then
skip to step 4. Do not rewrite a plan the user approved.

### 2. Scout (parallel, read-only)

For every question the plan depends on — where a pattern lives, which files
touch a model, what a signature is — dispatch an `Explore` scout in the same
turn, one question each, using the scout template in
[`references/subagent-prompts.md`](references/subagent-prompts.md). Scouts
are cheap and cannot write. They keep whole files out of your context: you
want `path:line` answers, not file dumps. While they run, draft the plan
header.

### 3. Plan

Write the plan to a file using the shape in
[`references/plan-format.md`](references/plan-format.md), in the directory
the repo already uses for plans if it has one. The parts that matter most,
because each one is where parallel work silently breaks:

- **Interfaces frozen in the plan.** Any type or function two tasks share
  gets its exact signature written down. Two workers who each guess the
  shape produce a conflict in the type and a bug in the caller.
- **Files named with line ranges**, from the scouts' answers.
- **The failing test written into the task.** A worker told "add tests"
  writes tests that pass against what it built. When several tasks share a
  fixture or mock pattern, write it once in the plan header and have each
  task reference it — a plan that repeats 150 lines of fixtures four times
  is four times as much for a worker to hold, not four times as clear.
- **One commit per task, `git add` naming files.** Workers share one tree;
  `git add .` commits another worker's half-done files.
- **Phases where order matters, and an explicit "may run in parallel" list
  where it does not.** Parallelism is bounded by disjoint files, not by how
  many agents you could spawn.

Show the user the plan header and task list before dispatching, unless they
told you to proceed without checking in. A wrong plan executed by ten agents
is ten times as much to undo.

### 4. Dispatch

For each task, send one implementer (`general-purpose`) the implementer
template. Every prompt carries: the CLAUDE.md path, the plan path and the
task number, the branch, the fast gate for that task, and the one or two
repo facts the task turns on. Tell it to read only its own task — the rest
of the plan is noise in its context and an invitation to start Task N+1.

Run every task in a parallel group in one turn, in the background. Run
tasks that share a file sequentially, or give each a worktree
(`isolation: "worktree"`) and merge afterwards. Do not poll: you are woken
when each finishes. Work on something else in the meantime — the next
phase's prompts, or reading the first finished diff.

Keep a short ledger in your own notes: task, agent, status, commit. The
ledger is what you report from; it is also what saves you when the
conversation is summarised mid-run.

### 5. Review — never take the implementer's word

When an implementer reports, read its report for "Gate: fail" and
"Deviations", then dispatch a **spec-compliance reviewer** with the task
text and the commit sha — not the implementer's report. The report is the
implementer's opinion of its own work; the diff is the fact. When that
passes, a **code-quality reviewer**. Both templates are in
`references/subagent-prompts.md`.

REQUEST CHANGES goes back to the implementer via `SendMessage` if it is
still alive (it has the context) or to a fresh fixer with the findings as
its task. A fix is a new commit on top, never an amend — a rewritten commit
under another worker's branch is how parallel work gets lost. Two rounds of
REQUEST CHANGES on one task means the task was under-specified: fix the
plan, then re-dispatch, rather than sending a third round.

### 6. Integrate

At the end of each phase, dispatch an integrator: it runs the whole-project
gate exactly as CLAUDE.md states it, bisects any red to the task that caused
it, and runs the checks the gate cannot see (a visual fidelity suite, a
drift check, a manual smoke). Only after it reports green does the next
phase start — a phase built on a red base debugs two phases at once.

### 7. Report

When the plan is done, or you stop, tell the user in this shape:

```
Done / Stopped at Task N of M.
Goal: <the one sentence from the plan>
Landed: <task → commit sha, one line each>
Gate: <command> → <green, or the failing line>
Not done: <tasks and why — blocker, needs a decision, out of scope>
Decisions I made that you may want to revisit: <or "none">
```

The user did not watch the agents. This message must stand on its own.

## Things that go wrong, and the rule each one taught

- **A worker "helpfully" did the next task too.** Its prompt said "read the
  plan", not "read Task N only". Scope the reading.
- **Two workers edited the same file; the merge lost one change.** The plan
  did not list files per task, so the parallel group was guessed. Files
  with line ranges, and parallel groups derived from them.
- **Everything was green and the page was wrong.** The gate cannot see what
  a page renders or whether a number is right. End every plan that changes
  output with a fresh-eyes check against the spec or the mock.
- **The orchestrator's context filled with file contents and it lost the
  ledger.** Scouts return `path:line`, not files; implementers return a
  fixed 200-word report; you read diffs only when a review is disputed.
- **The implementer said "all tests pass" and had skipped the failing one.**
  The reviewer gets the diff, not the report. Skipping, disabling or
  quarantining a test is never a fix; if a worker did it, that is a REQUEST
  CHANGES with the test named.
- **The user came back to fifteen agent transcripts and no summary.** The
  report shape above, every time, even when stopping early.

## References

- [`references/plan-format.md`](references/plan-format.md) — the plan
  template and the test for a dispatchable task.
- [`references/subagent-prompts.md`](references/subagent-prompts.md) —
  scout, implementer, two reviewers, fixer, integrator prompts and sizing
  rules. Read it before the first dispatch of a session.
- [`references/primitives.md`](references/primitives.md) — which harness
  primitive to reach for (Agent, worktrees, custom agents, Workflow/ultracode,
  agent teams) and when.
- [`references/install.md`](references/install.md) — how to make this skill
  available in every repo, not just the one it was written in.
