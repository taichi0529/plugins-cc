# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## リポジトリ概要

Claude Code 用の Grok プラグイン。OpenAI の Codex plugin for Claude Code (Apache 2.0) のフォークで、バックエンドを `codex app-server`(JSON-RPC)から `grok` CLI の headless モードに移植したもの。派生元の帰属表示は NOTICE にある。`grok.md` は移植前の Grok CLI 調査メモ。

リポジトリはマルチプラグイン構成のマーケットプレイス。ルートの `.claude-plugin/marketplace.json` がプラグイン一覧(`plugins` 配列)を定義し、各プラグイン本体は `plugins/<name>/` 配下に置く。grok-cc プラグインの実体は `plugins/grok-cc/`(以下アーキテクチャ節のパスはすべてこのディレクトリからの相対)。LICENSE / NOTICE はプラグイン単体配布に含まれるよう `plugins/grok-cc/` にもコピーがある。

ビルド・テストランナーはない。検証は以下で行う:

```bash
# 構文チェック
for f in plugins/grok-cc/scripts/*.mjs plugins/grok-cc/scripts/lib/*.mjs; do node --check "$f"; done

# companion を直接叩く(プラグインを通さない動作確認)
node plugins/grok-cc/scripts/grok-companion.mjs setup --json
node plugins/grok-cc/scripts/grok-companion.mjs task "prompt"           # read-only 1ターン
node plugins/grok-cc/scripts/grok-companion.mjs review --json           # 構造化レビュー
node plugins/grok-cc/scripts/grok-companion.mjs status --json
```

## アーキテクチャ

- `commands/*.md` → すべて `scripts/grok-companion.mjs <subcommand>` を呼ぶ薄いラッパー。出力は verbatim でユーザーに返す規約
- `agents/grok-rescue.md` → `/grok-cc:rescue` から Agent tool 経由で起動される転送専用サブエージェント。`task` サブコマンドを 1 回だけ呼ぶ
- `scripts/grok-companion.mjs` → ジョブのライフサイクル管理(queued/running/completed、フォアグラウンド/`task-worker` による detached バックグラウンド)
- `scripts/lib/grok.mjs` → Grok CLI 接続層。**ここだけが grok プロセスを起動する**。1 ターン = `grok --cwd <dir> --sandbox <profile> --always-approve --output-format streaming-json [-p|--resume] ...` の一発実行。streaming-json のイベントは `{type: thought|text|error|end}`、`end` に `sessionId`(= threadId)と `structuredOutput` が載る
- `scripts/lib/state.mjs` → ジョブ状態の永続化。`CLAUDE_PLUGIN_DATA` 配下(なければ tmpdir/grok-companion)。ジョブは Claude セッション ID(`GROK_COMPANION_SESSION_ID`、SessionStart フックが export)でフィルタされる
- `hooks/hooks.json` → SessionStart/SessionEnd(env 設定とジョブ掃除)、Stop(オプトインの stop-review-gate。`setup --enable-review-gate` で有効化され、直前ターンの編集を Grok がレビューして BLOCK できる)
- レビュー系は `prompts/*.md` テンプレート + `schemas/review-output.schema.json`(`--json-schema` で強制)で構造化 JSON を受け取り、`lib/render.mjs` が Markdown に整形する

## 移植時の設計判断(codex 版との差分)

- app-server / broker 層は存在しない。grok はターンごとの one-shot プロセス。`getSessionRuntimeStatus` は常に direct を返す
- ターンの interrupt RPC はない。キャンセル = プロセスツリーの terminate
- `/grok-cc:review` も敵対レビューと同じくプロンプトベース(codex の built-in reviewer 相当は grok にない)。focus テキスト拒否の仕様は codex 版と合わせて維持
- `--resume-last` は companion が記録した threadId(= grok sessionId)のみから解決する。`findLatestTaskThread` は常に null(無関係なセッションを誤って resume しないため)
- 書き込みタスクの touchedFiles は git status の前後差分で算出
- モデルエイリアス: `fast` → `grok-composer-2.5-fast`。effort は `none..xhigh` に加えて `max` を受け付ける

## 注意

- `grok models` を認証プローブとして使っている(ネットワークに出る、タイムアウト 30s)
- macOS では grok の sandbox はファイルシステム制限のみ実効。ネットワーク遮断は効かない(詳細は grok.md)
- commands/skills の文言は「companion の stdout を一切加工せず返す」「レビュー結果から勝手に修正を始めない」という規約が核。変更時はこの不変条件を壊さないこと
