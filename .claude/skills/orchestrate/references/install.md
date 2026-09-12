# Making this skill available in every repo

A skill under a repo's `.claude/skills/` exists only in that repo. Three
paths make it global; use whichever surfaces you work on. All three can be
used at once — Claude Code merges them, project skills taking precedence
over user skills over plugin skills.

## A. claude.ai profile skill (web, desktop app, Cowork)

The `.skill` file this skill ships as (or the bare `SKILL.md` folder) can be
saved to your claude.ai profile. Skills saved there are synced into every
Claude Code on the web, desktop and Cowork session as
`~/.claude/skills/synced/…` — the same mechanism that delivers `docx`,
`xlsx` and `skill-creator` today.

- From a Claude conversation: when the `.skill` file card appears, click
  **Save skill**.
- From settings: Settings → Capabilities → Skills → upload the packaged
  `.skill` (a zip of the skill folder, produced by
  `python -m scripts.package_skill <folder>` from the skill-creator skill).

To update: package the new version and save it again under the same name.

## B. Your machine's Claude Code CLI (every repo on that machine)

```bash
# once, on each machine you use the CLI on
git clone <your skills repo> ~/src/claude-skills      # or copy the folder
mkdir -p ~/.claude/skills
ln -s ~/src/claude-skills/orchestrate ~/.claude/skills/orchestrate
```

`~/.claude/skills/<name>/SKILL.md` is loaded in every project. A symlink into
a git checkout means `git pull` updates it everywhere.

## C. A personal plugin marketplace (CLI + shareable with a team)

Keep the skills in one git repo shaped as a marketplace, install it once,
and every project on that machine (and any teammate who adds the
marketplace) gets it. Docs: https://code.claude.com/docs/en/plugin-marketplaces

```
claude-skills/                              # e.g. github.com/<you>/claude-skills
├── .claude-plugin/
│   └── marketplace.json
└── plugins/
    └── chris-tools/
        ├── .claude-plugin/
        │   └── plugin.json
        └── skills/
            └── orchestrate/
                ├── SKILL.md
                └── references/…
```

`.claude-plugin/marketplace.json`:

```json
{
  "name": "chris-plugins",
  "owner": { "name": "Chris" },
  "plugins": [
    {
      "name": "chris-tools",
      "source": "./plugins/chris-tools",
      "description": "Personal skills: orchestrate, …"
    }
  ]
}
```

`plugins/chris-tools/.claude-plugin/plugin.json`:

```json
{ "name": "chris-tools", "description": "Personal skills", "version": "1.0.0" }
```

Then, once per machine, inside any Claude Code session:

```
/plugin marketplace add <you>/claude-skills
/plugin install chris-tools@chris-plugins
```

That writes the marketplace to `extraKnownMarketplaces` and the plugin to
`enabledPlugins` in `~/.claude/settings.json`, so it applies to every
project. The skill is then invoked as `/chris-tools:orchestrate` (or
auto-triggers by description). Adding a second skill is a new folder under
`skills/` and a `git push`; `/plugin update chris-tools` pulls it.

## Which one, in practice

- You mostly use Claude Code on the web / desktop / Cowork → **A** covers
  it, and it needs no git repo.
- You also run the CLI locally → **A** plus **B** (a symlink) or **C**.
- You want teammates to have the same skills → **C**.
