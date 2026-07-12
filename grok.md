# grok CLI 調査メモ

調査日: 2026-07-12
バイナリ: `/Users/taichi/.local/bin/grok`
バージョン: `grok 0.2.93 (f00f96316d4b)`

## 概要

`grok` は xAI 製のエージェント型コーディング CLI。Claude Code / Codex と同系統の設計で、TUI(対話モード)と headless モード(`grok agent ...`)の両方を持つ。

特徴的なのは Claude Code との互換性で、`grok inspect` を実行すると `~/.claude/settings.json` の permissions・skills・hooks・MCP サーバー設定・agents 定義まで読み込んで一覧表示する。`grok inspect` の出力に "Harness Compatibility" として `cursor` / `claude` が表示され、既存の Claude Code 環境にそのまま相乗りできる互換レイヤーを持っている。

## 基本コマンド

```bash
grok --version                 # バージョン確認
grok --help                    # トップレベルヘルプ
grok inspect                   # このディレクトリで検出される設定一覧(--json でJSON出力可)
grok models                    # 利用可能モデル一覧
grok agent --help              # headless系サブコマンド(stdio / headless / serve / leader)
grok -p "<prompt>"             # シングルターンで実行し結果をstdoutに出力して終了
grok --continue / -c           # このディレクトリの直近セッションを継続
grok --resume / -r <id>        # セッション再開
grok -w [name]                 # 新しいgit worktreeを作ってセッション開始
```

設定ファイル:
- ユーザー設定: `~/.grok/config.toml`
- プロジェクト固有の指示: `.grok/` 配下(このプロジェクトでは未使用、`~/.claude/Claude.md` を1件読み込んでいた)

## 動作確認

```bash
grok --version
grok --help
grok inspect
grok agent --help
grok agent headless --help
```

いずれも正常終了。`grok inspect` では以下が検出された:
- Permissions: `/Users/taichi/.claude/settings.json` から108件ロード
- Skills: 54件(user定義 + plugin経由。code-review, magi, aws-core系など)
- Agents: 5件(general-purpose, explore, plan, isolated-implementer, codex:codex-rescue)
- MCP Servers: 2件(aws-mcp, aws-pricing-mcp-server)
- Hooks: 5件

## サンドボックス機能(`--sandbox <PROFILE>`)

OSカーネルの機能でエージェントプロセスおよび子プロセス(bashコマンド等)のファイルシステム/ネットワークアクセスを制限する仕組み。**デフォルトは `off`(無制限)**。

- macOS: Seatbelt
- Linux: Landlock(カーネル5.13以上)

### ビルトインプロファイル(README記載)

| プロファイル | FS読み取り | FS書き込み | 子プロセスのネットワーク | 用途 |
|---|---|---|---|---|
| `off`(デフォルト) | 無制限 | 無制限 | 無制限 | サンドボックスなし |
| `workspace` | どこでも | CWD + `/tmp` + `~/.grok/` | 許可 | 通常の開発作業 |
| `read-only` | どこでも | `~/.grok/` のみ | 遮断 | 調査・コードレビュー |
| `strict` | CWD + システムパス | CWD + `/tmp` + `~/.grok/` | 遮断 | 信頼できないコードの実行 |

機微なパス(`~/.ssh/`, `~/.aws/`, `~/.gnupg/`, `~/.grok/auth/`)はプロファイルによらず常に書き込み禁止。

### カスタムプロファイル

`~/.grok/sandbox.toml`(グローバル)または `.grok/sandbox.toml`(プロジェクト単位)に定義:

```toml
[profiles.devbox]
extends = "workspace"
restrict_network = true
read_only = ["/data"]
read_write = ["/tmp/scratch"]
deny = ["/data/shared-secrets"]
```

```bash
grok --sandbox devbox
```

未定義のプロファイル名を指定するとエラーで起動を拒否する(unsandboxedで動かすことはしない、というフェイルセーフ設計):

```
error: could not apply the 'invalid-value' sandbox profile; refusing to start rather than run unsandboxed.
```

サンドボックス適用イベントは `~/.grok/sandbox-events.jsonl` に記録される。

### 実機検証結果(macOS, Seatbelt)

以下、実際に `grok --sandbox <profile> --always-approve -p "..."` でbashコマンドを実行させて確認。

| 検証内容 | プロファイル | 期待 | 実測 |
|---|---|---|---|
| `$HOME` 直下への書き込み | `workspace` | ブロック(CWD+/tmp+~/.grok以外は不可) | ブロック(`touch: Operation not permitted`) |
| `/tmp` への書き込み | `workspace` | 許可 | 許可 |
| プロジェクトCWDへの書き込み | `read-only` | ブロック | ブロック(`touch: Operation not permitted`) |
| `/tmp` への書き込み | `read-only` | README表記では不可(`~/.grok/`のみ) | **実際は許可**(後述) |
| 子プロセスからのネットワークアクセス(`curl https://www.google.com`) | `strict`(`restrict_network: true`) | 遮断 | **遮断されず、HTTP 200 で成功** |

### ドキュメントと実挙動の差異(要注意)

1. **`read-only` の書き込み許可範囲がREADMEの表と食い違う**
   `sandbox-events.jsonl` のログを見ると、`read-only` プロファイルでも `read_write_paths` に `/tmp`, `/var/tmp`, `/private/tmp` 等が含まれていた。README表では「`~/.grok/` のみ」となっているが、実装上は全プロファイル共通で `/tmp` 系への書き込みが許可されている。CWDへの書き込みがブロックされる、という核心的な制限は機能している。

2. **`strict` プロファイルでもmacOSでは子プロセスのネットワーク遮断が効かない**
   README の "Current Limitations" にも明記されている既知の制約:
   > Network restrictions are partial: Profiles with `restrict_network` block network in **child processes** (bash commands, scripts) via seccomp, but built-in tools that make HTTP requests in-process are not affected.

   seccomp は Linux のみの機構であり、macOS(Seatbelt)環境では `restrict_network: true` が設定されていても子プロセス(bashから叩く`curl`等)のネットワークは実際には遮断されない。実測でも `strict` プロファイル下で `curl` が普通に成功することを確認した。

   → **macOS環境で「ネットワーク遮断込みの隔離」を期待して `--sandbox strict` を使うのは危険。実際に遮断されるのはファイルシステムのみと考えるべき。**

## 結論

- `grok` コマンドは正常にインストール・動作している。
- Claude Code の設定(permissions/skills/hooks/MCP)をそのまま検出・利用できる互換性がある。
- サンドボックスのファイルシステム制限(CWD外への書き込みブロックなど)は実際に機能している。
- サンドボックスのネットワーク制限は、少なくとも本機(macOS/Seatbelt)では実効性がない。信頼できないコードを実行する際にネットワーク遮断を前提にしないこと。
