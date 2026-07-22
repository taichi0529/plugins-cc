# workflow-cc

個人ワークフロー plugin。複数 issue 一括 + ループ実行ワークフローの汎用エンジン層。

## 構成

- **PROGRESS.md 永続化フック 3 本** (Phase 1・実装済み)
  - `SessionStart` — 「現在地」+ ログ直近 3 件をコンテキスト注入
  - `PostToolUse` (Bash) — `git commit` / `gh pr create` 検知で更新を強制 (主役)。ログ 10 件超の機械トリムも担当
  - `Stop` — バックストップ (HEAD が PROGRESS.md より新しければ block)
- **skills**
  - `implement-issue` (Phase 2) — Issue を内部ループ (最大 10 試行・自己診断式) で end-to-end 実装。リポジトリ非依存 (repo slug / ベースブランチ / ゲートを自動導出、`.claude/workflow.json` で明示指定可)。マルチレビュアー対応 (`review=codex,grok`)
  - `run-epic` (Phase 3) — EPIC の OPEN な Sub-issues を直列オーケストレーション。worktree 不成立環境 (ツールチェーンが docker のみ等) は main checkout 直列に自動フォールバック
  - `create-issue` (Phase 4) — PBI 形式の Issue 起票 (feature/bug/refactor/chore/epic/task テンプレ同梱)。DoD はリポジトリ側データ (`workflow.json` の `dodFiles` → `.claude/dod/*.md` → 無ければ省略)

## opt-in の仕組み (D10)

フックは **リポジトリルートに `PROGRESS.md` が存在する時だけ** 動く。無ければ即 exit 0。

有効化したいリポジトリで:

```bash
touch PROGRESS.md
echo "PROGRESS.md" >> .gitignore   # 必ず gitignore する (D2)
```

## インストール

Claude Code 内で:

```
/plugin marketplace add taichi0529/plugins-cc
/plugin install workflow-cc@taichi0529
```

ローカル開発時はリポジトリを clone して直接読み込む:

```bash
claude --plugin-dir /path/to/plugins-cc/plugins/workflow-cc
```

フックの変更は `/reload-plugins` かセッション再起動で反映される。

## PROGRESS.md テンプレート

```markdown
# PROGRESS (machine-local / gitignored)

## 現在地 (毎回上書き)
- 作業中: #<issue> <タイトル> / branch <name> / <状態>
- 未完: #A, #B
- 次の一手: <1 行>

## ログ (追記・新しい順・直近 10 件でトリム)
### YYYY-MM-DD #<issue> → <PR/結果>
- plan差分: <無ければ「なし」>
- 失敗: <試して駄目だったアプローチと理由>
- ハマり: <再発しそうな落とし穴>
```

書いてよいのは **git / issue に無い情報だけ** (D12): plan との乖離・失敗アプローチと理由・ハマりどころ・次の一手。

## 依存

- `jq` (無い環境ではフックは何もせず exit 0 する = fail-open)
- `git`

## 設計資料

確定済み設計判断 (D1〜D12)・テスト計画は引き継ぎ資料 `docs/handoff.md` を参照。
