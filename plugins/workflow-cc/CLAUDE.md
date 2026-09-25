# CLAUDE.md — workflow-cc

このファイルは `plugins/workflow-cc/`(workflow-cc プラグイン本体)で作業するときのガイド。リポジトリ全体のマーケットプレイス構成はルートの `CLAUDE.md` を参照。以下パスはすべてこのプラグインディレクトリからの相対。

## プラグイン概要

個人ワークフロー plugin。2 つのレイヤーからなる:

1. **PROGRESS.md 永続化フック 3 本** — セッションをまたいで「作業の現在地」を機械可読な `PROGRESS.md` に保つ。git / issue に載らない情報(plan との乖離・失敗したアプローチ・ハマりどころ・次の一手)だけを残す
2. **ワークフロー skill 群** — `create-issue`(起票)/ `implement-issue`(単一 Issue の end-to-end 実装)/ `run-epic`(EPIC 配下の Sub-issues 直列実装)。すべてリポジトリ非依存

ビルド・テストランナーはない。フックは shell + `jq`、skill は Markdown 手順書、agent 定義 (`agents/*.md`) は frontmatter でモデル / effort を固定するための薄いラッパ。確定済み設計判断(D1〜D22)とテスト計画は `docs/handoff.md` にある。

## opt-in の仕組み(D10)

フック 3 本は**リポジトリルートに `PROGRESS.md` が存在する時だけ**動く。無ければ即 `exit 0`。有効化は対象リポジトリで:

```bash
touch PROGRESS.md
echo "PROGRESS.md" >> .gitignore   # 必ず gitignore する(D2・machine-local ファイル)
```

`jq` が無い環境ではフックは何もせず `exit 0` する(fail-open)。依存は `jq` と `git` のみ。

## フック(`hooks/hooks.json` → `scripts/*.sh`)

- `session-start.sh`(SessionStart)→ `PROGRESS.md` の「現在地」+ ログ直近 3 件を stdout に出してコンテキスト注入(`### ` エントリ 4 件目以降は出さない)。空ファイルなら何も注入しない
- `post-tool-use.sh`(PostToolUse, matcher: Bash)→ **主役**。`tool_input.command` に `git commit` / `gh pr create` を検知したら PROGRESS.md の更新を強制(`decision: block`)。ただし mtime が直近 5 分以内なら二重要求防止で `exit 0`。ログの `### ` エントリが 10 件超なら古い方から機械トリム(`touch -r` で **mtime を保存** — トリムで更新要求ガードを潰さないため)
- `stop.sh`(Stop)→ バックストップ。**最初に `stop_hook_active` を評価**して true なら即 `exit 0`(無限ループ防止・最重要)。HEAD のコミット時刻 > PROGRESS.md の mtime なら block

block 出力は旧スキーマ(トップレベル `decision`/`reason`)と新スキーマ(`hookSpecificOutput.additionalContext`)を併記して両対応にしている。`echo "git commit"` 等での誤発火は許容(実害は余計な更新要求 1 回)。

## skills

- `create-issue`(Phase 4)→ PBI 形式の Issue 起票。`templates/*.md`(feature/bug/refactor/chore/epic/task)同梱。EPIC は Sub-issues API で親子管理。依存(`depends on:`)/ `Target scope` の機械可読宣言を含む。DoD はリポジトリ側データ(設定ファイルの `dodFiles` → `.claude/dod/*.md` → 無ければ省略)
- `implement-issue`(Phase 2)→ Issue を**内部ループ(最大 10 試行・自己診断式)**で end-to-end 実装(ブランチ作成 → 実装 → ローカルゲート → `/simplify`(`workflow-cc:reviewer` 内で起動・無ければ code-simplifier plugin。最初の PR 作成前に 1 回。diff 20 行未満・docs-only・利用不可は skip して報告)→ `/security-review`(PR 作成前・HIGH/MEDIUM 0 件必須。Step 5 では再実行しない)→ commit → push → PR → レビュー → 修正)。各試行は「現在の状態を読み直し次の 1 歩だけ進める」。マルチレビュアー対応(`review=codex,grok`)、既定レビュアーは `project` + `adversarial`(red-team: 独立 subagent が「壊れている」前提で具体的な破壊シナリオを探す。根拠の無い指摘は禁止)+ `grok`(別エンジンの視点を常設。利用不可なら fail-open で続行)、**レビュー系は独立かつ read-only なもの同士を必ず同一メッセージの複数 Agent 呼び出しで並列起動**(差分照合ラウンド・security-review の再実行も対象。simplify → security-review だけは直列)、レビューは初回フル・2 回目以降は差分照合モード(指摘を出したレビュアーのみ、指摘リスト + 修正 diff で解消判定)。レビュー系実行体(simplify / security-review / project / adversarial)は `workflow-cc:reviewer` agent で起動し、**既定は opus / effort high**(D22)。`review-model=<名>` でモデルだけ上書き可・`review-model=inherit` はセッション継承(実装本体のモデルは変えない・codex / grok は対象外)。自動 merge はしない。**リポジトリ設定解決の正典**であり、**レビュー系実行体のモデル解決の正典**でもある(run-epic / create-issue から参照される)
- `run-epic`(Phase 3)→ EPIC の OPEN な Sub-issues を GitHub API で取得し、子エージェント(`workflow-cc:implementer` = 既定 opus / effort medium, `isolation: worktree`)へ委譲して実装。**既定は直列**。`parallel=N` 指定時のみ、依存宣言(`depends on:` / `Target scope`)の機械解析で独立と判定できた子を wave 並列(バッチ上限 N・親の 1b 検証は常に直列・**本文からの LLM 予測は判定に使わない**)。依存先 PR が未 merge の子は ready-set から外れ「merge 待ち」として次回実行に持ち越す。`model=<名>` で子エージェントのモデルを上書き可(子 spawn のみに適用・省略時は opus / medium・`model=inherit` はセッション継承・明示値のフォールバック禁止)。`review-model=<名>` は解釈せず子 prompt にパススルーする(子が回すレビュー系のモデル。`model=` とは別物)。worktree が成立しない環境(ツールチェーンが docker のみ等)は main checkout 直列に自動フォールバック(並列不可)。merge は人間

## リポジトリ設定の解決(ハードコード禁止)

skill はリポジトリ固有値をハードコードしない。設定ファイルは `.claude/workflow-cc.json` のみ(path-scope 対応。旧 `.claude/workflow.json` は 0.5.0 で廃止 — リネームで移行、検出時は案内を出す)。**無くても全項目が自動導出で動く**。**正典は `skills/implement-issue/SKILL.md` の「リポジトリ設定の解決」** — スキーマ・キー許可リスト・prefix マッチ規則・二段階解決の詳細はそちらが正で、ここには要点だけ書く:

| 項目 | 設定ファイル | 自動導出 |
|---|---|---|
| repo slug | — | `gh repo view --json nameWithOwner` |
| ベースブランチ | ルートの `baseBranch`(scope 内は禁止) | `gh repo view --json defaultBranchRef` |
| ローカルゲート | ルートの `gates` + 変更ファイルにマッチした `scopes[].gates` の union | ルート `package.json` の scripts(`type-check`/`lint`/`test`)。無ければゲート無しとして続行し最終報告に明記 |
| CI の扱い | ルートの `trustCI`(既定 true・scope 内は禁止) | true なら PR 後に `gh pr checks` を確認 |
| レビュアー | ルートの `reviewers` + マッチ scope の union | `["project", "adversarial", "grok"]` |

- **二段階解決**: repo-wide(baseBranch / trustCI)は起動時に 1 回、scope 依存(gates / reviewers / dodFiles)は**ゲート実行直前に変更ファイル集合から**再解決する(起動時には diff が存在しないため)
- **prefix マッチ**: `file == prefix` または `file.startswith(prefix + "/")`。`apps/web` は `apps/web-old` にマッチしない
- モノレポ: サブプロジェクトごとにゲートが違う場合は `scopes[]` で宣言する(自動導出はルートの `package.json` しか見ない)
- **effort は agent 定義の frontmatter でしか指定できない**(Agent 呼び出しで上書きできるのは `model` だけ)。実装 = `agents/implementer.md`(medium)、レビュー = `agents/reviewer.md`(high)。変えるときはこの 2 ファイルと、既定値を書いた箇所(両 SKILL.md・README・handoff の D22)を揃える
- **モデル指定(`model` / `review-model`)は設定ファイルに入れない**。コスト許容度は個人の都合でありリポジトリの事実ではないため、引数だけで受ける(D14 / D15 / D20)

## 注意

- `PROGRESS.md` に書いてよいのは **git / issue に無い情報だけ**(D12): plan との乖離・失敗アプローチと理由・ハマりどころ・次の一手。「何を変更したか」等は書かない
- フックの変更は `/reload-plugins` かセッション再起動で反映される
- バージョンを上げるときは `.claude-plugin/plugin.json` とルートの `.claude-plugin/marketplace.json` の workflow-cc エントリを**両方**同じ値にする(このプラグインは CHANGELOG を持たない)
