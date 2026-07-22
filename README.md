# Grok plugin for Claude Code

[日本語版 README はこちら](README.ja.md)

Call the [Grok CLI](https://x.ai) (xAI's agentic coding CLI) from Claude Code. This is a derivative of OpenAI's [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc), with the backend ported from `codex app-server` to `grok` headless mode.

## Requirements

- Node.js
- Grok CLI:

  ```bash
  curl -fsSL https://x.ai/cli/install.sh | bash
  ```

- Authentication: run `grok login` once (or set `XAI_API_KEY`)

## Installation

### From the marketplace (recommended)

Inside Claude Code, run:

```
/plugin marketplace add taichi0529/plugins-cc
/plugin install grok-cc@taichi0529
```

### Local development

Clone the repository and load it directly:

```bash
git clone https://github.com/taichi0529/plugins-cc.git
claude --plugin-dir /path/to/plugins-cc/plugins/grok-cc
```

The repository is a plugin marketplace: each plugin lives under `plugins/<name>/`, so point `--plugin-dir` at the plugin directory, not the repository root.

After installation, run `/grok-cc:setup` to verify that the Grok CLI is installed and authenticated.

## Features

| Feature | What it does |
|---|---|
| Slash commands | User-facing entry points (`/grok-cc:*`) that invoke the companion or the rescue subagent |
| `grok-companion` CLI | Job lifecycle engine behind every command (setup, review, task, status, cancel, …) |
| `grok-rescue` subagent | Thin forwarder that hands investigation/fix work to `task` |
| Internal skills | Prompting, runtime, and result-handling contracts used by the plugin (not user-invocable) |
| Stop-time review gate | Optional Stop hook that blocks session end until a fresh Grok review says `ALLOW` |
| Session lifecycle hooks | Export `GROK_COMPANION_SESSION_ID` and transcript path; clean up jobs on session end |

Review output is structured JSON (schema-validated), then rendered as Markdown. Write-capable tasks use the Grok sandbox profile `workspace`; reviews and read-only tasks use `read-only`. Job state is stored under `CLAUDE_PLUGIN_DATA` (falls back to `grok-companion/` in the system temp dir) and is filtered by Claude session when possible.

## Commands

All slash commands live under the `grok-cc` plugin namespace. Most of them shell out to `scripts/grok-companion.mjs` and return its stdout **verbatim** (no paraphrase, no auto-fixes from reviews).

### `/grok-cc:setup`

Check that Node and the Grok CLI are available and authenticated. Optionally toggle the stop-time review gate for this workspace.

| Flag | Description |
|---|---|
| `--enable-review-gate` | Turn on the Stop-hook review gate for this repo |
| `--disable-review-gate` | Turn it off |
| `--json` | Machine-readable report (companion-level; the slash command already uses JSON internally) |

Typical usage:

```
/grok-cc:setup
/grok-cc:setup --enable-review-gate
/grok-cc:setup --disable-review-gate
```

### `/grok-cc:rescue`

Delegate investigation, diagnosis, or an explicit fix to Grok via the `grok-cc:grok-rescue` subagent. The subagent makes **one** `task` call and returns that stdout as-is. By default the rescue path adds `--write` (write-capable) unless the user asks for read-only / research-only work.

| Flag / arg | Description |
|---|---|
| `[task text]` | What Grok should investigate, solve, or continue |
| `--wait` | Run the rescue subagent in the foreground (Claude-side; not passed to `task`) |
| `--background` | Run the rescue subagent in the background (Claude-side; not passed to `task`) |
| `--resume` | Continue the latest resumable Grok task thread for this Claude session (`task --resume-last`) |
| `--fresh` | Force a new thread (do not resume) |
| `--model <name\|fast>` | Select model; `fast` → `grok-composer-2.5-fast` |
| `--effort <level>` | Reasoning effort: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |

If neither `--resume` nor `--fresh` is set, the command may ask whether to continue a previous thread (via `task-resume-candidate`). If neither `--wait` nor `--background` is set, the default is foreground.

Typical usage:

```
/grok-cc:rescue find why the tests fail
/grok-cc:rescue --resume apply the top fix
/grok-cc:rescue --fresh --model fast --effort high implement the missing API
/grok-cc:rescue --background dig into the flaky integration test
```

### `/grok-cc:review`

Standard, review-only pass over local git changes. Uses the built-in review prompt + `schemas/review-output.schema.json`. **Does not accept custom focus text** (use adversarial-review for that). Does not support staged-only or unstaged-only scopes.

| Flag | Description |
|---|---|
| `--wait` | Run in the foreground (do not ask) |
| `--background` | Detach via Claude Code background Bash (do not ask) |
| `--base <ref>` | Review branch diff against this base ref |
| `--scope <auto\|working-tree\|branch>` | Target selection (`auto` is default: working tree if dirty, else branch vs default base) |

If neither `--wait` nor `--background` is given, the command estimates review size and asks once.

Typical usage:

```
/grok-cc:review
/grok-cc:review --wait
/grok-cc:review --scope working-tree
/grok-cc:review --base main --scope branch
```

### `/grok-cc:adversarial-review`

Challenge-oriented review of the same git targets: questions design choices, tradeoffs, and assumptions rather than only listing defects. Same target flags as `review`, plus optional free-text focus after the flags.

| Flag / arg | Description |
|---|---|
| `--wait` / `--background` | Same as `/grok-cc:review` |
| `--base <ref>` | Same as `/grok-cc:review` |
| `--scope <auto\|working-tree\|branch>` | Same as `/grok-cc:review` |
| `[focus ...]` | Extra adversarial focus instructions |

Typical usage:

```
/grok-cc:adversarial-review
/grok-cc:adversarial-review --wait focus on auth and session handling
/grok-cc:adversarial-review --base origin/main --scope branch
```

### `/grok-cc:status`

List or inspect Grok companion jobs for this repository (and the current Claude session when session filtering is active). Also surfaces review-gate status in the list view.

| Flag / arg | Description |
|---|---|
| `[job-id]` | Inspect a single job |
| `--wait` | With a job id, poll until the job leaves `queued`/`running` (default timeout 240s) |
| `--timeout-ms <ms>` | Wait deadline for `--wait` |
| `--all` | List all finished jobs for this Claude session instead of the default recent cap (8) |
| `--json` | JSON snapshot (companion-level) |

Typical usage:

```
/grok-cc:status
/grok-cc:status task-abc123
/grok-cc:status task-abc123 --wait --timeout-ms 120000
/grok-cc:status --all
```

### `/grok-cc:result`

Show the stored final output of a finished job (reviews, tasks, etc.).

| Flag / arg | Description |
|---|---|
| `[job-id]` | Job to show (required in practice when multiple jobs exist) |
| `--json` | Full structured payload (companion-level) |

Typical usage:

```
/grok-cc:result
/grok-cc:result review-xyz789
```

### `/grok-cc:cancel`

Cancel an active (`queued` / `running`) background job: attempts to stop the Grok process tree and marks the job `cancelled`.

| Flag / arg | Description |
|---|---|
| `[job-id]` | Job to cancel |
| `--json` | Machine-readable cancel report (companion-level) |

Typical usage:

```
/grok-cc:cancel
/grok-cc:cancel task-abc123
```

### `/grok-cc:transfer`

Import the current Claude Code session transcript into a resumable Grok thread (`grok import`). Prints the new Grok session id and a `grok --resume <session-id>` command.

| Flag | Description |
|---|---|
| `--source <claude-jsonl>` | Explicit transcript path instead of the session default |
| `--json` | Machine-readable result (companion-level) |

Typical usage:

```
/grok-cc:transfer
/grok-cc:transfer --source /path/to/session.jsonl
```

## Companion CLI

Every slash command ultimately runs (or is built around) `scripts/grok-companion.mjs`. You can call it directly for debugging or automation:

```bash
node plugins/grok-cc/scripts/grok-companion.mjs <subcommand> [options]
node plugins/grok-cc/scripts/grok-companion.mjs help
```

### Subcommands

| Subcommand | Role |
|---|---|
| `setup` | Availability/auth report; enable/disable stop review gate |
| `review` | Standard structured review of local git state |
| `adversarial-review` | Adversarial structured review (+ optional focus text) |
| `task` | One-shot Grok turn (read-only or write-capable); used by rescue and the stop gate |
| `transfer` | Claude session → Grok thread import |
| `status` | List jobs or wait on a job id |
| `result` | Print stored final output for a finished job |
| `cancel` | Cancel a running/queued job |
| `task-resume-candidate` | Internal: report whether this Claude session has a resumable task thread |
| `task-worker` | Internal: detached worker that executes a queued background `task` (`--job-id` required, plus `--cwd`) |

Shared options used by many subcommands:

| Option | Description |
|---|---|
| `--cwd <dir>` / `-C <dir>` | Working directory (workspace root is resolved from here) |
| `--json` | Emit JSON instead of Markdown/text rendering |

### `task` options (detail)

```bash
node plugins/grok-cc/scripts/grok-companion.mjs task \
  [--background] [--write] \
  [--resume-last|--resume|--fresh] \
  [--model <model|fast>] [-m <model|fast>] \
  [--effort <none|minimal|low|medium|high|xhigh|max>] \
  [--prompt-file <path>] \
  [prompt]
```

| Option | Description |
|---|---|
| `[prompt]` | Task text (or pipe stdin, or use `--prompt-file`) |
| `--prompt-file <path>` | Read prompt from a file |
| `--write` | Write-capable sandbox (`workspace`); default without this is `read-only` |
| `--background` | Queue the job and spawn a detached `task-worker` |
| `--resume` / `--resume-last` | Resume the latest finished task thread for this Claude session |
| `--fresh` | Explicitly do not resume (mutually exclusive with resume flags) |
| `--model` / `-m` | Model name or alias `fast` → `grok-composer-2.5-fast` |
| `--effort` | Reasoning effort passed as `--reasoning-effort` to the Grok CLI |

Without a prompt, a prompt file, piped stdin, or `--resume-last`/`--resume`, `task` errors.

### `review` / `adversarial-review` options (detail)

```bash
node plugins/grok-cc/scripts/grok-companion.mjs review [--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--json]
node plugins/grok-cc/scripts/grok-companion.mjs adversarial-review [...] [focus text]
```

Notes:

- Companion accepts `--wait` / `--background` as parseable flags; for slash-command background runs, Claude Code’s `Bash(..., run_in_background: true)` is what actually detaches the process.
- Standard `review` rejects non-empty focus text and points users at `adversarial-review`.
- Supported scopes: `auto`, `working-tree`, `branch` only (not staged/unstaged-only).

### `status` wait behavior

With a job id and `--wait`, the companion polls until the job is no longer `queued`/`running` (default timeout **240000** ms, default poll interval **2000** ms). `--timeout-ms` and `--poll-interval-ms` override those defaults. `--wait` without a job id is an error.

## Subagent and skills

### `grok-rescue` subagent (`agents/grok-rescue.md`)

Invoked as `subagent_type: "grok-cc:grok-rescue"` (from `/grok-cc:rescue` or proactively when Claude should hand off substantial work). It is a **forwarder only**:

1. Optionally tighten the user text with the `grok-prompting` skill  
2. Run a single `node …/grok-companion.mjs task …` Bash call  
3. Return that stdout unchanged  

It does not call `setup`, `review`, `status`, `result`, or `cancel`, and must not inspect the repo or re-implement the task in Claude.

### Skills (internal, `user-invocable: false`)

| Skill | Purpose |
|---|---|
| `grok-cli-runtime` | Contract for how `grok-rescue` builds the `task` command (flags, `--write` default, resume mapping) |
| `grok-prompting` | How to structure Grok prompts (XML blocks, recipes, antipatterns) |
| `grok-result-handling` | How Claude should present companion stdout (verbatim reviews; no auto-fix from findings) |

## Hooks

Configured in `hooks/hooks.json`:

| Hook | Script | Behavior |
|---|---|---|
| `SessionStart` | `session-lifecycle-hook.mjs` | Exports `GROK_COMPANION_SESSION_ID` (and related env) so jobs can be scoped to the Claude session |
| `SessionEnd` | `session-lifecycle-hook.mjs` | Removes session jobs from state and terminates any still-running process trees |
| `Stop` | `stop-review-gate-hook.mjs` | If the review gate is enabled, runs a stop-gate `task` over the previous Claude turn and can **block** stop unless the answer starts with `ALLOW:` |

Enable/disable the gate with `/grok-cc:setup --enable-review-gate` or `--disable-review-gate`. The gate uses a dedicated prompt (`prompts/stop-review-gate.md`) and a 15-minute timeout.

## Architecture

Paths below are relative to the plugin directory `plugins/grok-cc/`.

- `scripts/grok-companion.mjs` — the engine behind every command: job management (foreground / detached background via `task-worker`), reviews, and task delegation
- `scripts/lib/grok.mjs` — the Grok CLI layer. One turn = one `grok --cwd … --sandbox … --always-approve --output-format streaming-json` run (`-p` or `--resume`); threads continue via `--resume <session-id>`; structured output via `--json-schema`
- Reviews embed git diff context into the `prompts/review.md` / `prompts/adversarial-review.md` templates and receive JSON conforming to `schemas/review-output.schema.json`
- Write-capable tasks run with sandbox profile `workspace` (companion uses `workspace-write` internally, mapped to `workspace`); reviews and read-only tasks use `read-only`
- Job state is stored under `CLAUDE_PLUGIN_DATA` (falls back to `grok-companion/` in the tmpdir)
- There is no app-server/broker: each turn is a one-shot process; cancel terminates the process tree

## Models and effort

- With no model specified, the Grok CLI default is used (e.g. `grok-4.5`)
- `--model fast` is an alias for `grok-composer-2.5-fast`
- `--effort` accepts `none|minimal|low|medium|high|xhigh|max`

## License

Apache License 2.0. This plugin is a derivative work of the OpenAI Codex plugin for Claude Code (see NOTICE).
