# Grok plugin for Claude Code

[English README is here](README.md)

[Grok CLI](https://x.ai)(xAI のエージェント型コーディング CLI)を Claude Code から呼び出すプラグイン。OpenAI の [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc) の派生物で、バックエンドを `codex app-server` から `grok` headless モードに置き換えたもの。

## 必要なもの

- Node.js
- Grok CLI:

  ```bash
  curl -fsSL https://x.ai/cli/install.sh | bash
  ```

- 認証: 一度 `grok login` を実行(または `XAI_API_KEY` を設定)

## インストール

### マーケットプレイス経由(推奨)

Claude Code 内で以下を実行:

```
/plugin marketplace add taichi0529/grok-cc
/plugin install grok-cc@taichi0529
```

### ローカル開発

リポジトリを clone して直接読み込む:

```bash
git clone https://github.com/taichi0529/grok-cc.git
claude --plugin-dir /path/to/grok-cc
```

インストール後、`/grok-cc:setup` で Grok CLI のインストール・認証状態を確認できる。

## 機能

| 機能 | 内容 |
|---|---|
| スラッシュコマンド | ユーザー向けの入口(`/grok-cc:*`)。companion または rescue サブエージェントを呼び出す |
| `grok-companion` CLI | すべてのコマンドの背後にあるジョブライフサイクルエンジン(setup、review、task、status、cancel、…) |
| `grok-rescue` サブエージェント | 調査・修正タスクを `task` に引き渡す転送専用の薄いラッパー |
| 内部スキル | プラグインが使うプロンプト設計・ランタイム・結果処理の規約(ユーザーからは呼び出し不可) |
| 停止時レビューゲート | 有効化すると、Grok の新規レビューが `ALLOW` を返すまでセッション終了をブロックする Stop フック(オプトイン) |
| セッションライフサイクルフック | `GROK_COMPANION_SESSION_ID` とトランスクリプトパスを export し、セッション終了時にジョブを掃除 |

レビュー出力はスキーマ検証済みの構造化 JSON で、Markdown にレンダリングされる。書き込み可能なタスクは Grok のサンドボックスプロファイル `workspace`、レビューと読み取り専用タスクは `read-only` で実行される。ジョブ状態は `CLAUDE_PLUGIN_DATA` 配下(未設定時はシステム一時ディレクトリの `grok-companion/`)に保存され、可能な場合は Claude セッション単位でフィルタされる。

## コマンド

すべてのスラッシュコマンドは `grok-cc` プラグイン名前空間に属する。ほとんどのコマンドは `scripts/grok-companion.mjs` を実行し、その stdout を**一切加工せず**返す(言い換えなし、レビュー結果からの自動修正なし)。

### `/grok-cc:setup`

Node と Grok CLI が利用可能で認証済みかを確認する。このワークスペースの停止時レビューゲートの切り替えもここで行う。

| フラグ | 説明 |
|---|---|
| `--enable-review-gate` | このリポジトリの Stop フックレビューゲートを有効化 |
| `--disable-review-gate` | 無効化 |
| `--json` | 機械可読レポート(companion レベル。スラッシュコマンドは内部的に JSON を使用) |

使用例:

```
/grok-cc:setup
/grok-cc:setup --enable-review-gate
/grok-cc:setup --disable-review-gate
```

### `/grok-cc:rescue`

調査・診断・明示的な修正を `grok-cc:grok-rescue` サブエージェント経由で Grok に委譲する。サブエージェントは `task` を**一度だけ**呼び出し、その stdout をそのまま返す。ユーザーが読み取り専用・調査のみを求めない限り、rescue 経路はデフォルトで `--write`(書き込み可能)を付与する。

| フラグ / 引数 | 説明 |
|---|---|
| `[task text]` | Grok に調査・解決・継続させたい内容 |
| `--wait` | rescue サブエージェントをフォアグラウンドで実行(Claude 側の制御。`task` には渡されない) |
| `--background` | rescue サブエージェントをバックグラウンドで実行(Claude 側の制御。`task` には渡されない) |
| `--resume` | この Claude セッションの直近の再開可能な Grok タスクスレッドを継続(`task --resume-last`) |
| `--fresh` | 新規スレッドを強制(再開しない) |
| `--model <name\|fast>` | モデル選択。`fast` → `grok-composer-2.5-fast` |
| `--effort <level>` | 推論エフォート: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |

`--resume` も `--fresh` も指定されていない場合、コマンドは(`task-resume-candidate` を介して)前のスレッドを継続するか一度だけ確認することがある。`--wait` も `--background` も指定されていない場合のデフォルトはフォアグラウンド。

使用例:

```
/grok-cc:rescue find why the tests fail
/grok-cc:rescue --resume apply the top fix
/grok-cc:rescue --fresh --model fast --effort high implement the missing API
/grok-cc:rescue --background dig into the flaky integration test
```

### `/grok-cc:review`

ローカル git 変更に対するレビュー専用の標準パス。組み込みのレビュープロンプト + `schemas/review-output.schema.json` を使用する。**カスタムの focus テキストは受け付けない**(それには adversarial-review を使う)。staged のみ・unstaged のみのスコープは非対応。

| フラグ | 説明 |
|---|---|
| `--wait` | フォアグラウンドで実行(確認しない) |
| `--background` | Claude Code のバックグラウンド Bash で切り離す(確認しない) |
| `--base <ref>` | この base ref に対するブランチ差分をレビュー |
| `--scope <auto\|working-tree\|branch>` | 対象選択(デフォルトは `auto`: 作業ツリーが dirty ならそれ、そうでなければデフォルト base とのブランチ差分) |

`--wait` も `--background` も指定がない場合、コマンドはレビューサイズを見積もって一度だけ確認する。

使用例:

```
/grok-cc:review
/grok-cc:review --wait
/grok-cc:review --scope working-tree
/grok-cc:review --base main --scope branch
```

### `/grok-cc:adversarial-review`

同じ git 対象に対するチャレンジ志向のレビュー。欠陥の列挙だけでなく、設計判断・トレードオフ・前提を問い直す。対象指定のフラグは `review` と同じで、フラグの後に自由記述の focus を追加できる。

| フラグ / 引数 | 説明 |
|---|---|
| `--wait` / `--background` | `/grok-cc:review` と同じ |
| `--base <ref>` | `/grok-cc:review` と同じ |
| `--scope <auto\|working-tree\|branch>` | `/grok-cc:review` と同じ |
| `[focus ...]` | 追加の敵対的レビュー指示 |

使用例:

```
/grok-cc:adversarial-review
/grok-cc:adversarial-review --wait focus on auth and session handling
/grok-cc:adversarial-review --base origin/main --scope branch
```

### `/grok-cc:status`

このリポジトリ(セッションフィルタが有効な場合は現在の Claude セッション)の Grok companion ジョブを一覧・詳細表示する。一覧ビューにはレビューゲートの状態も表示される。

| フラグ / 引数 | 説明 |
|---|---|
| `[job-id]` | 単一ジョブの詳細表示 |
| `--wait` | ジョブ ID とともに指定すると、ジョブが `queued`/`running` を抜けるまでポーリング(デフォルトタイムアウト 240 秒) |
| `--timeout-ms <ms>` | `--wait` の締め切り |
| `--all` | デフォルトの表示上限(8 件)ではなく、この Claude セッションの完了ジョブをすべて表示 |
| `--json` | JSON スナップショット(companion レベル) |

使用例:

```
/grok-cc:status
/grok-cc:status task-abc123
/grok-cc:status task-abc123 --wait --timeout-ms 120000
/grok-cc:status --all
```

### `/grok-cc:result`

完了ジョブ(レビュー、タスクなど)の保存済み最終出力を表示する。

| フラグ / 引数 | 説明 |
|---|---|
| `[job-id]` | 表示するジョブ(複数ジョブがある場合は実質必須) |
| `--json` | 完全な構造化ペイロード(companion レベル) |

使用例:

```
/grok-cc:result
/grok-cc:result review-xyz789
```

### `/grok-cc:cancel`

アクティブな(`queued` / `running`)バックグラウンドジョブをキャンセルする。Grok のプロセスツリーの停止を試み、ジョブを `cancelled` にマークする。

| フラグ / 引数 | 説明 |
|---|---|
| `[job-id]` | キャンセルするジョブ |
| `--json` | 機械可読のキャンセルレポート(companion レベル) |

使用例:

```
/grok-cc:cancel
/grok-cc:cancel task-abc123
```

### `/grok-cc:transfer`

現在の Claude Code セッションのトランスクリプトを、再開可能な Grok スレッドとしてインポートする(`grok import`)。新しい Grok セッション ID と `grok --resume <session-id>` コマンドを表示する。

| フラグ | 説明 |
|---|---|
| `--source <claude-jsonl>` | セッションデフォルトの代わりに明示的なトランスクリプトパスを指定 |
| `--json` | 機械可読の結果(companion レベル) |

使用例:

```
/grok-cc:transfer
/grok-cc:transfer --source /path/to/session.jsonl
```

## Companion CLI

すべてのスラッシュコマンドは最終的に `scripts/grok-companion.mjs` を実行する(またはそれを中心に構成されている)。デバッグや自動化のために直接呼び出すこともできる:

```bash
node scripts/grok-companion.mjs <subcommand> [options]
node scripts/grok-companion.mjs help
```

### サブコマンド

| サブコマンド | 役割 |
|---|---|
| `setup` | 利用可否・認証レポート。stop review gate の有効化/無効化 |
| `review` | ローカル git 状態の標準的な構造化レビュー |
| `adversarial-review` | 敵対的な構造化レビュー(+ 任意の focus テキスト) |
| `task` | one-shot の Grok ターン(読み取り専用または書き込み可能)。rescue と stop gate が使用 |
| `transfer` | Claude セッション → Grok スレッドのインポート |
| `status` | ジョブ一覧、またはジョブ ID の完了待ち |
| `result` | 完了ジョブの保存済み最終出力を表示 |
| `cancel` | 実行中・キュー中のジョブをキャンセル |
| `task-resume-candidate` | 内部用: この Claude セッションに再開可能なタスクスレッドがあるか報告 |
| `task-worker` | 内部用: キューされたバックグラウンド `task` を実行する detached ワーカー(`--job-id` 必須、`--cwd` も指定) |

多くのサブコマンドで共通のオプション:

| オプション | 説明 |
|---|---|
| `--cwd <dir>` / `-C <dir>` | 作業ディレクトリ(ここからワークスペースルートを解決) |
| `--json` | Markdown/テキストの代わりに JSON を出力 |

### `task` オプション(詳細)

```bash
node scripts/grok-companion.mjs task \
  [--background] [--write] \
  [--resume-last|--resume|--fresh] \
  [--model <model|fast>] [-m <model|fast>] \
  [--effort <none|minimal|low|medium|high|xhigh|max>] \
  [--prompt-file <path>] \
  [prompt]
```

| オプション | 説明 |
|---|---|
| `[prompt]` | タスクテキスト(stdin のパイプ、または `--prompt-file` でも可) |
| `--prompt-file <path>` | プロンプトをファイルから読み込む |
| `--write` | 書き込み可能サンドボックス(`workspace`)。指定なしのデフォルトは `read-only` |
| `--background` | ジョブをキューに入れ、detached な `task-worker` を起動 |
| `--resume` / `--resume-last` | この Claude セッションの直近の完了タスクスレッドを再開 |
| `--fresh` | 明示的に再開しない(resume 系フラグと排他) |
| `--model` / `-m` | モデル名またはエイリアス `fast` → `grok-composer-2.5-fast` |
| `--effort` | Grok CLI に `--reasoning-effort` として渡される推論エフォート |

プロンプト・プロンプトファイル・stdin パイプ・`--resume-last`/`--resume` のいずれもない場合、`task` はエラーになる。

### `review` / `adversarial-review` オプション(詳細)

```bash
node scripts/grok-companion.mjs review [--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--json]
node scripts/grok-companion.mjs adversarial-review [...] [focus text]
```

補足:

- companion は `--wait` / `--background` をフラグとして受理するが、スラッシュコマンドのバックグラウンド実行を実際に切り離すのは Claude Code の `Bash(..., run_in_background: true)` である。
- 標準の `review` は空でない focus テキストを拒否し、`adversarial-review` へ誘導する。
- 対応スコープは `auto`、`working-tree`、`branch` のみ(staged のみ/unstaged のみは非対応)。

### `status` の待機動作

ジョブ ID と `--wait` を指定すると、companion はジョブが `queued`/`running` でなくなるまでポーリングする(デフォルトタイムアウト **240000** ms、デフォルトポーリング間隔 **2000** ms)。`--timeout-ms` と `--poll-interval-ms` でこれらを上書きできる。ジョブ ID なしの `--wait` はエラー。

## サブエージェントとスキル

### `grok-rescue` サブエージェント(`agents/grok-rescue.md`)

`subagent_type: "grok-cc:grok-rescue"` として呼び出される(`/grok-cc:rescue` から、または Claude がまとまった作業を引き渡すべきときに自発的に)。これは**転送専用**:

1. 必要に応じて `grok-prompting` スキルでユーザーテキストを引き締める
2. `node …/grok-companion.mjs task …` の Bash 呼び出しを一度だけ実行する
3. その stdout を変更せずに返す

`setup`、`review`、`status`、`result`、`cancel` は呼び出さず、リポジトリの調査や Claude 側でのタスクの再実装もしてはならない。

### スキル(内部用、`user-invocable: false`)

| スキル | 目的 |
|---|---|
| `grok-cli-runtime` | `grok-rescue` が `task` コマンドを組み立てる際の規約(フラグ、`--write` デフォルト、resume のマッピング) |
| `grok-prompting` | Grok プロンプトの構造化方法(XML ブロック、レシピ、アンチパターン) |
| `grok-result-handling` | companion の stdout の提示方法(レビューは verbatim。findings からの自動修正禁止) |

## フック

`hooks/hooks.json` で設定:

| フック | スクリプト | 動作 |
|---|---|---|
| `SessionStart` | `session-lifecycle-hook.mjs` | ジョブを Claude セッションに紐付けられるよう `GROK_COMPANION_SESSION_ID`(と関連 env)を export |
| `SessionEnd` | `session-lifecycle-hook.mjs` | セッションのジョブを状態から削除し、まだ実行中のプロセスツリーを終了 |
| `Stop` | `stop-review-gate-hook.mjs` | レビューゲートが有効な場合、直前の Claude ターンに対して stop-gate `task` を実行し、回答が `ALLOW:` で始まらない限り停止を**ブロック**できる |

ゲートの有効化/無効化は `/grok-cc:setup --enable-review-gate` / `--disable-review-gate` で行う。ゲートは専用プロンプト(`prompts/stop-review-gate.md`)と 15 分のタイムアウトを使う。

## アーキテクチャ

- `scripts/grok-companion.mjs` — すべてのコマンドの実体。ジョブ管理(フォアグラウンド / `task-worker` による detached バックグラウンド)、レビュー、タスク委譲を行う
- `scripts/lib/grok.mjs` — Grok CLI 接続層。1 ターン = `grok --cwd … --sandbox … --always-approve --output-format streaming-json` の一発実行(`-p` または `--resume`)。スレッド継続は `--resume <session-id>`、構造化出力は `--json-schema`
- レビューは `prompts/review.md` / `prompts/adversarial-review.md` のテンプレートに git diff コンテキストを埋め込み、`schemas/review-output.schema.json` に適合する JSON を受け取る
- 書き込み可能なタスクはサンドボックスプロファイル `workspace`(companion 内部では `workspace-write` を `workspace` にマッピング)、レビューと読み取り専用タスクは `read-only`
- ジョブ状態は `CLAUDE_PLUGIN_DATA`(未設定時は tmpdir の `grok-companion/`)配下に保存
- app-server/broker は存在しない。各ターンは one-shot プロセスで、キャンセルはプロセスツリーの終了

## モデルとエフォート

- モデル未指定時は Grok CLI のデフォルト(例: `grok-4.5`)
- `--model fast` は `grok-composer-2.5-fast` のエイリアス
- `--effort` は `none|minimal|low|medium|high|xhigh|max`

## ライセンス

Apache License 2.0。本プラグインは OpenAI Codex plugin for Claude Code の派生物です(NOTICE を参照)。
