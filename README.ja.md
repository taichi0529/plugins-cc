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
/plugin install grok-cc@grok-cc
```

### ローカル開発

リポジトリを clone して直接読み込む:

```bash
git clone https://github.com/taichi0529/grok-cc.git
claude --plugin-dir /path/to/grok-cc
```

インストール後、`/grok-cc:setup` で Grok CLI のインストール・認証状態を確認できる。

## コマンド

| コマンド | 内容 |
|---|---|
| `/grok-cc:setup` | Grok CLI の状態確認。`--enable-review-gate` で停止時レビューゲートを有効化 |
| `/grok-cc:rescue <task>` | 調査・修正タスクを Grok に委譲(`grok-rescue` サブエージェント経由) |
| `/grok-cc:review` | ローカル git 変更の標準レビュー(構造化 JSON 出力) |
| `/grok-cc:adversarial-review [focus]` | 設計・前提を攻撃する敵対的レビュー |
| `/grok-cc:status [job-id]` | このリポジトリのジョブ一覧・詳細 |
| `/grok-cc:result [job-id]` | 完了ジョブの最終出力 |
| `/grok-cc:cancel [job-id]` | 実行中ジョブのキャンセル |
| `/grok-cc:transfer` | 現在の Claude セッションを Grok セッションとしてインポート(`grok import`) |

## アーキテクチャ

- `scripts/grok-companion.mjs` — すべてのコマンドの実体。ジョブ管理(フォアグラウンド/バックグラウンド)、レビュー、タスク委譲を行う
- `scripts/lib/grok.mjs` — Grok CLI 接続層。`grok -p <prompt> --output-format streaming-json` を 1 ターンとして実行し、`--resume <session-id>` でスレッド継続、`--json-schema` で構造化出力を得る
- レビューは `prompts/review.md` / `prompts/adversarial-review.md` のテンプレートに git diff コンテキストを埋め込み、`schemas/review-output.schema.json` に適合する JSON を受け取る
- 書き込み系タスクは `--sandbox workspace`、レビュー・調査は `--sandbox read-only` で実行
- ジョブ状態は `CLAUDE_PLUGIN_DATA`(未設定時は tmpdir の `grok-companion/`)配下に保存

## モデルとエフォート

- モデル未指定時は Grok CLI のデフォルト(例: `grok-4.5`)
- `--model fast` は `grok-composer-2.5-fast` のエイリアス
- `--effort` は `none|minimal|low|medium|high|xhigh|max`

## ライセンス

Apache License 2.0。本プラグインは OpenAI Codex plugin for Claude Code の派生物です(NOTICE を参照)。
