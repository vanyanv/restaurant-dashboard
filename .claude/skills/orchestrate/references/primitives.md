# Orchestration primitives in Claude Code

Which mechanism to reach for. The default for this skill is the first row;
the others are for when it is not enough. Docs: https://code.claude.com/docs/en/sub-agents
and https://code.claude.com/docs/en/workflows.

| Need | Use | Notes |
|---|---|---|
| Delegate one bounded task, get a report back | `Agent` tool | `subagent_type: general-purpose` to edit, `Explore` to read only. `run_in_background: true` for anything you are not blocked on. Results come back inline to your context, so ask for short fixed-shape reports. |
| Continue a worker with the context it already has | `SendMessage` to the agent's name/id | Cheaper than a fresh agent for a review round-trip. A fresh `Agent` call starts from nothing. |
| Two workers must change the same file | `Agent` with `isolation: "worktree"` | Each gets its own git worktree; you merge the branches. Skip it when tasks are file-disjoint — a shared tree and scoped `git add` is simpler. |
| A reusable role with fixed tools/model | Custom subagent in `.claude/agents/<name>.md` or `~/.claude/agents/<name>.md` | Frontmatter: `name`, `description`, `tools`, `model`, `permissionMode`, `maxTurns`, `skills`. Then `subagent_type: <name>`. Worth it once you have sent the same reviewer prompt ten times. |
| Dozens of agents, deterministic fan-out, results kept out of your context | `Workflow` tool (script with `agent()`, `parallel()`, `pipeline()`, `phase()`) | Only when the user opted in (`ultracode`, "use a workflow", or a skill that says so). Load the `workflow-authoring` skill first. Results stay in script variables; only the summary returns. |
| Agents that talk to each other and share a task list | Agent teams (experimental, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) | Highest token cost. For investigation and debate, not for executing a plan. |
| A skill that should itself run in a fresh context | `context: fork` + `agent:` in SKILL.md frontmatter | Not this skill: the orchestrator needs the conversation and the ability to spawn agents. |

## Rules of thumb

- Spawn every independent agent in the same turn, one `Agent` call each.
  Sequential spawning of independent work is the most common way to lose
  the time parallelism was supposed to buy.
- You are woken when a background agent finishes. Never `sleep`-poll and
  never predict a pending result.
- An agent's final report is not shown to the user. Whatever matters in it,
  you relay.
- Keep a ledger (task → agent → status → sha) in your own notes. The
  `TaskCreate`/`TaskUpdate` tools are a fine place for it when available.
- One task per agent. A worker given three tasks does the first one well.
