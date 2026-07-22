# plugins-cc

[English README is here](README.md)

[Claude Code](https://claude.com/claude-code) 用のプラグインマーケットプレイス。各プラグインは `plugins/<name>/` 配下にあり、使い方はそれぞれのプラグインの README に記載している。

## プラグイン一覧

| プラグイン | 内容 | ドキュメント |
|---|---|---|
| `grok-cc` | [Grok CLI](https://x.ai)(xAI のエージェント型コーディング CLI)を Claude Code から呼び出す: タスク委譲・構造化コードレビュー・rescue サブエージェント・停止時レビューゲート(オプトイン)。OpenAI の [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc) の派生物。 | [README](plugins/grok-cc/README.md)([日本語](plugins/grok-cc/README.ja.md)) |
| `workflow-cc` | 個人ワークフローエンジン: PROGRESS.md 永続化フック(リポジトリごとのオプトイン)+ issue 駆動開発のための `implement-issue` / `run-epic` / `create-issue` skill。 | [README](plugins/workflow-cc/README.md) |

## インストール

Claude Code 内でマーケットプレイスを一度追加し、任意のプラグインをインストールする:

```
/plugin marketplace add taichi0529/plugins-cc
/plugin install grok-cc@taichi0529
/plugin install workflow-cc@taichi0529
```

必要なもの・インストール後のセットアップは各プラグインの README を参照。

### ローカル開発

リポジトリを clone してプラグインを直接読み込む:

```bash
git clone https://github.com/taichi0529/plugins-cc.git
claude --plugin-dir /path/to/plugins-cc/plugins/<name>
```

`--plugin-dir` にはリポジトリルートではなくプラグインディレクトリを指定すること。

## リポジトリ構成

- `.claude-plugin/marketplace.json` — マーケットプレイス定義(プラグイン一覧・バージョン・ソース)
- `plugins/<name>/` — プラグインごとのディレクトリ。それぞれが `.claude-plugin/plugin.json` と README を持つ

## ライセンス

Apache License 2.0([LICENSE](LICENSE) を参照)。`grok-cc` は OpenAI の Codex plugin for Claude Code の派生物([NOTICE](NOTICE) を参照)。単体配布に備え、プラグインディレクトリにも LICENSE / NOTICE のコピーを置いている。
