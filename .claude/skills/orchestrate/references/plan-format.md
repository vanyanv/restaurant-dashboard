# Plan format

The plan is the contract between the orchestrator and every worker. A worker
reads one task from it with no other context, so a task that leans on
something "we discussed" is a task that will be built wrong. Write the plan
to `docs/plans/YYYY-MM-DD-<slug>.md` (or the directory the repo already uses
for plans — `docs/superpowers/plans/` in repos that run superpowers; keep
whatever convention you find).

## Template

```markdown
# <Feature> Implementation Plan

> **For agentic workers:** execute task-by-task with the `orchestrate` skill.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One sentence. What is true when this plan is done that is not true now.

**Architecture:** One paragraph. How the pieces fit, what extends what, what
is deliberately NOT built. This is the paragraph that stops a worker from
inventing a second way to do something the repo already does.

**Tech stack:** The tools a worker will touch (framework, test runner, ORM,
the exact mock pattern the repo uses and one file that models it).

**Spec:** Path to the design doc, if one exists.

## Global constraints

- The whole-project gate, verbatim (copy it from CLAUDE.md; do not paraphrase).
- Tenancy / security boundaries a worker must respect.
- Conventions the gate cannot see (commit message style, "never run X").
- Anything a previous plan got wrong that this one must not repeat.

---

## Phase 1 — <name>          (phases group tasks that must land in order)

### Task 1: <imperative title> (<finding or spec ref, if any>)

**Files:**
- Modify: `path/to/file.ts:120-155` (`functionName`)
- Create: `path/to/new-file.ts`
- Test: `tests/path/to/file.test.ts`

**Interfaces:**
- Consumes: the types/functions this task reads, by name.
- Produces: the exact signature(s) this task adds. Other tasks depend on this
  line — a worker who changes the signature breaks a parallel worker.

<Two to five sentences of the WHY: what is wrong today, what the repo already
has that should be reused, the one non-obvious fact the worker would
otherwise have to rediscover (e.g. "LoginEvent has no relation to User, so the
filter is userId ∈ account users").>

- [ ] **Step 1: Write the failing test**

```ts
// the test, complete enough to paste
```

- [ ] **Step 2: Make it pass**

<The change, as code or as precise prose naming lines.>

- [ ] **Step 3: Gate and commit**

Run: `<the fast subset of the gate>`

```bash
git add <the exact files>
git commit -m "<type>(<scope>): <what changed, in the repo's voice>"
```

### Task 2: ...
```

## What makes a task dispatchable

A task is ready for a worker when all of these hold. If one does not, the plan
needs more work, not the worker.

- **Files are named with line ranges.** "The settings adapter" sends the
  worker searching; `src/lib/counter/adapters/settings.ts:115-155` does not.
- **Interfaces are frozen.** Every function another task calls has its
  signature written in the plan. Two parallel workers who each guess the
  shape of a shared type will produce a merge conflict in the type and a
  runtime bug in the caller.
- **The test comes first and is written out.** A worker given "add tests"
  writes tests that pass against whatever it built. A worker given the test
  builds what the test demands.
- **The commit is scoped.** `git add` names files, never `.`. A worker that
  runs `git add .` commits the other workers' half-finished files from the
  shared tree.
- **The task is one commit.** If it needs two, it is two tasks. Reviewers
  read one diff per task; a two-commit task hides the first diff.
- **It says why.** Workers are capable; given the reason they make good
  calls at the edges the plan did not foresee. Given only the instruction,
  they follow it off a cliff.

## Ordering

Group tasks into phases when order matters (security fixes before deletions
that would touch the same lines; linter tightening after the code it would
newly flag is gone). Inside a phase, tasks that touch disjoint files are
parallel candidates; say so explicitly — `Tasks 3–5 may run in parallel` —
so the orchestrator does not have to re-derive it.

Put a final "double- and triple-check" task at the end of any plan that
changes what a page renders or what a number says: a worker with fresh eyes
opens the result next to the spec and lists every divergence. The gate
cannot see a page that renders the wrong thing.
