# CLAUDE.md

このファイルは、このリポジトリで作業する Claude Code (claude.ai/code) 向けのガイド。

## リポジトリ概要

Claude Code プラグインのマーケットプレイス(モノレポ)。ルートの `.claude-plugin/marketplace.json` がプラグイン一覧(`plugins` 配列)を定義し、各プラグイン本体は `plugins/<name>/` 配下に置く。

現在のプラグイン:

| プラグイン | 概要 | 詳細ガイド |
|---|---|---|
| `grok-cc` | Grok CLI を Claude Code から使ってコードレビュー / タスク委譲を行う。Codex plugin のフォーク | `plugins/grok-cc/CLAUDE.md` |
| `workflow-cc` | PROGRESS.md 永続化フック + ループ実行ワークフロー skill(create-issue / implement-issue / run-epic) | `plugins/workflow-cc/CLAUDE.md` |
| `obsidian-cc` | セッションの作業内容を Obsidian のデイリーノートに日報として記録し commit / push する(daily-report skill + setup コマンド) | `plugins/obsidian-cc/CLAUDE.md` |

**個々のプラグインをいじるときは、必ずそのプラグインの `CLAUDE.md` を読むこと。** アーキテクチャ・検証方法・設計上の不変条件はそちらに書いてある。このルート文書はマーケットプレイス全体で共通する事項だけを扱う。

## リポジトリ構成

```
.claude-plugin/marketplace.json   # プラグインレジストリ(name / description / version / source)
plugins/<name>/
  .claude-plugin/plugin.json      # プラグイン単体のマニフェスト(name / version / ...)
  CLAUDE.md                       # そのプラグイン固有のガイド
  commands/  agents/  skills/  hooks/  scripts/ ...
```

- `marketplace.json` の各エントリの `source` は `./plugins/<name>` を指す
- プラグインは互いに独立。共有ライブラリや相互依存は無い

## 共通の規約

- **バージョンは 2 箇所を一致させる**: プラグインを更新したら `plugins/<name>/.claude-plugin/plugin.json` の `version` と、`marketplace.json` の該当エントリの `version` を**両方**同じ値に上げる。片方だけ上げると不整合になる
- **フックスクリプトの参照はプラグインルート基準**: `hooks/hooks.json` 内のコマンドは `"${CLAUDE_PLUGIN_ROOT}"/scripts/...` の形で参照する(リポジトリルートからの相対パスを直書きしない)
- **ビルド・テストランナーは無い**。検証はプラグインごと(shell スクリプトの `bash`/`jq`、Node スクリプトの `node --check`、companion を直接叩く等)。具体的な手順は各プラグインの `CLAUDE.md` を参照
- ライセンス: フォーク由来のプラグイン(grok-cc)は単体配布できるよう `plugins/<name>/` 配下に `LICENSE` / `NOTICE` のコピーを持つ

## インストール / ローカル開発

利用者は Claude Code 内で:

```
/plugin marketplace add taichi0529/plugins-cc
/plugin install <name>@taichi0529
```

ローカルで単一プラグインを開発・確認するときは、そのプラグインディレクトリを直接読み込む:

```bash
claude --plugin-dir /path/to/plugins-cc/plugins/<name>
```

フックやコマンドの変更は `/reload-plugins` かセッション再起動で反映される。
