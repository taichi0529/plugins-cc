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
/plugin marketplace add taichi0529/grok-plugin
/plugin install grok@grok-plugin
```

### Local development

Clone the repository and load it directly:

```bash
git clone https://github.com/taichi0529/grok-plugin.git
claude --plugin-dir /path/to/grok-plugin
```

After installation, run `/grok:setup` to verify that the Grok CLI is installed and authenticated.

## Commands

| Command | Description |
|---|---|
| `/grok:setup` | Check Grok CLI status. `--enable-review-gate` enables the stop-time review gate |
| `/grok:rescue <task>` | Delegate an investigation or fix task to Grok (via the `grok-rescue` subagent) |
| `/grok:review` | Standard review of local git changes (structured JSON output) |
| `/grok:adversarial-review [focus]` | Adversarial review that attacks design choices and assumptions |
| `/grok:status [job-id]` | List or inspect jobs for this repository |
| `/grok:result [job-id]` | Show the final output of a finished job |
| `/grok:cancel [job-id]` | Cancel a running job |
| `/grok:transfer` | Import the current Claude session into Grok (`grok import`) |

## Architecture

- `scripts/grok-companion.mjs` — the engine behind every command: job management (foreground / background), reviews, and task delegation
- `scripts/lib/grok.mjs` — the Grok CLI layer. One turn = one `grok -p <prompt> --output-format streaming-json` run; threads continue via `--resume <session-id>`, structured output via `--json-schema`
- Reviews embed git diff context into the `prompts/review.md` / `prompts/adversarial-review.md` templates and receive JSON conforming to `schemas/review-output.schema.json`
- Write-capable tasks run with `--sandbox workspace`; reviews and investigations with `--sandbox read-only`
- Job state is stored under `CLAUDE_PLUGIN_DATA` (falls back to `grok-companion/` in the tmpdir)

## Models and effort

- With no model specified, the Grok CLI default is used (e.g. `grok-4.5`)
- `--model fast` is an alias for `grok-composer-2.5-fast`
- `--effort` accepts `none|minimal|low|medium|high|xhigh|max`

## License

Apache License 2.0. This plugin is a derivative work of the OpenAI Codex plugin for Claude Code (see NOTICE).
