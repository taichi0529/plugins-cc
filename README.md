# plugins-cc

[日本語版 README はこちら](README.ja.md)

A [Claude Code](https://claude.com/claude-code) plugin marketplace. Each plugin lives under `plugins/<name>/` and documents its own usage in its README.

## Plugins

| Plugin | What it does | Docs |
|---|---|---|
| `grok-cc` | Call the [Grok CLI](https://x.ai) (xAI's agentic coding CLI) from Claude Code: task delegation, structured code review, rescue subagent, and an optional stop-time review gate. Derivative of OpenAI's [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc). | [README](plugins/grok-cc/README.md) ([日本語](plugins/grok-cc/README.ja.md)) |
| `workflow-cc` | Personal workflow engine: PROGRESS.md persistence hooks (opt-in per repository) plus `implement-issue` / `run-epic` / `create-issue` skills for issue-driven development. | [README](plugins/workflow-cc/README.md) |
| `obsidian-cc` | Records what you did in a session into an Obsidian daily note, then commits and pushes it (`daily-report` skill). Vault paths are configured once via `/obsidian-cc:setup`. | [README](plugins/obsidian-cc/README.md) |

## Installation

Inside Claude Code, add the marketplace once, then install any plugin from it:

```
/plugin marketplace add taichi0529/plugins-cc
/plugin install grok-cc@taichi0529
/plugin install workflow-cc@taichi0529
/plugin install obsidian-cc@taichi0529
```

See each plugin's README for its requirements and post-install setup.

### Local development

Clone the repository and load a plugin directly:

```bash
git clone https://github.com/taichi0529/plugins-cc.git
claude --plugin-dir /path/to/plugins-cc/plugins/<name>
```

Point `--plugin-dir` at the plugin directory, not the repository root.

### Secret scanning

Commits are scanned by [gitleaks](https://github.com/gitleaks/gitleaks) through a pre-commit hook. Git hooks are not part of a clone, so enable it once after cloning:

```bash
brew install pre-commit gitleaks
pre-commit install
```

On top of the default rules (API keys, tokens, private keys), `.gitleaks.toml` flags **local absolute paths** (`/Users/<name>/`, `/home/<name>/`) and **email addresses** — this repository is a public marketplace, so nothing that reveals a machine or an employer belongs in it. Use `/Users/you/`, `<name>`, and `example.com` in documentation; those are allowlisted. If the hook fires, fix the content rather than passing `--no-verify`.

## Repository layout

- `.claude-plugin/marketplace.json` — the marketplace definition (plugin list, versions, sources)
- `plugins/<name>/` — one directory per plugin, each with its own `.claude-plugin/plugin.json` and README

## License

Apache License 2.0 (see [LICENSE](LICENSE)). `grok-cc` is a derivative work of OpenAI's Codex plugin for Claude Code — see [NOTICE](NOTICE); the plugin directory also carries its own LICENSE/NOTICE copies for standalone distribution.
