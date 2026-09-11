# Changelog

## 0.1.3

- Add: `setup --allow-network` / `--disallow-network`. Appends a custom
  `grok-cc-read-only-net` profile (`extends = "read-only"`,
  `restrict_network = false`) to `$GROK_HOME/sandbox.toml` if missing and
  selects it plugin-wide via `config.json` under the plugin data dir, so
  reviews and read-only tasks keep a read-only filesystem but may use the
  network. The `setup` report shows the active profile per mode and its
  source (`built-in|config|env`).
- Add: `GROK_COMPANION_SANDBOX_READ_ONLY` / `GROK_COMPANION_SANDBOX_WRITE`
  env overrides for the grok `--sandbox` profile name (take precedence over
  the config). Touched-file tracking still follows the logical access mode,
  not the profile name.
- Note: Grok CLI 1.0.25 refuses to start the built-in `read-only` / `strict`
  profiles when `/var/run/docker.sock` is a symlink (Docker Desktop); the
  same custom profile works around it.

## 0.1.2

- Fix: `getGrokAuthStatus` re-probes once when `grok models` reports a stale
  "not authenticated" snapshot while grok lazily refreshes an expired-but-
  renewable OIDC token in the same run. The refreshed token is written to disk
  before that process exits, so a single re-probe reports the true logged-in
  state. Spawn failures and timeouts (`result.error` set) are not retried.

## 0.1.1

- Fix: export the session data dir under the plugin-specific name
  `GROK_COMPANION_DATA` instead of the generic `CLAUDE_PLUGIN_DATA`, which
  collided last-writer-wins with sibling forks (the Codex plugin) that export
  the same name and hijacked each other's state directory.

## 0.1.0

- Initial version: fork of the Codex plugin for Claude Code (1.0.6) with the
  runtime ported from `codex app-server` to `grok` headless mode
  (`-p` + `--output-format streaming-json` + `--resume` + `--json-schema`).
- `/grok:review` uses a prompt-based structured review (Grok has no built-in
  reviewer); `/grok:transfer` uses `grok import`.
- Dropped the app-server broker; each turn runs a fresh one-shot `grok` process.
