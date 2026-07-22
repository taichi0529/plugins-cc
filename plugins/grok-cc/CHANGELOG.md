# Changelog

## 0.1.0

- Initial version: fork of the Codex plugin for Claude Code (1.0.6) with the
  runtime ported from `codex app-server` to `grok` headless mode
  (`-p` + `--output-format streaming-json` + `--resume` + `--json-schema`).
- `/grok:review` uses a prompt-based structured review (Grok has no built-in
  reviewer); `/grok:transfer` uses `grok import`.
- Dropped the app-server broker; each turn runs a fresh one-shot `grok` process.
