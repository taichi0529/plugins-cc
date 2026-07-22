---
name: implement-issue
description: GitHub Issue を内部ループで end-to-end 実装するスキル (リポジトリ非依存)。ブランチ作成 → 実装 → ローカル検証 → コミット → push → PR 作成 → コードレビュー → 修正までを「現在の状態を読み直し、次の1歩を進める」を最大10回繰り返して完了させる。「Issue 実装して」「#123 を実装」「implement issue」「イシューを実装」などのリクエスト時に使用。引数は Issue 番号 + 任意の review= 指定 (例 `42 review=codex,grok`)。
---

# Issue Implementation Skill (汎用)

GitHub Issue の実装を、ブランチ作成から PR 作成・レビュー対応まで**一度の実行で end-to-end** に完了させる。
本スキルは内部に有限ループ (最大 10 試行) を持ち、各試行は「現在の状態を自己診断 → 次に必要な1歩だけ進める」を繰り返して、成功条件を全て満たすか max 試行に達したら return する。

引数: `$ARGUMENTS`
- 第1引数: Issue 番号 (例: `42`, `#42`)
- 任意: `review=<reviewer,...>` (例: `review=codex,grok`)。自然言語での指定 (「codex でもレビューして」) も同義に解釈する

## 動作モード

このスキルは2つの方法で起動される。どちらの場合も同じアルゴリズムを実行する。

1. **直接起動** (`/implement-issue 42`): 現在のスレッドがそのままアルゴリズムを実行する
2. **run-epic からの委譲**: 親 (run-epic) が `Agent({subagent_type: "general-purpose", isolation: "worktree", prompt: "本スキルを読んでアルゴリズムを実行"})` で spawn し、子エージェントが本スキルを Read してアルゴリズムを実行する

直接起動時もメインコンテキストの汚染が気になるなら、子エージェントへ委譲してから本スキルを実行させる構成に切り替えてよい。判断はユーザーの状況次第。

## リポジトリ設定の解決 (最初の試行の冒頭で 1 回だけ行う)

ハードコード禁止。以下をこの順で解決し、以後の全 Step で使う。
`.claude/workflow.json` (リポジトリルート・任意) があれば明示設定として最優先。**このファイルが無くても全項目が自動導出で動くこと。**

| 項目 | workflow.json | 自動導出 (workflow.json に無い場合) |
|---|---|---|
| repo slug | — | `gh repo view --json nameWithOwner -q .nameWithOwner` (失敗時は `git remote get-url origin` から導出) |
| ベースブランチ | `baseBranch` | `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` |
| ローカルゲート | `gates` (コマンド文字列の配列) | リポジトリルートの `package.json` の scripts に `type-check` / `lint` / `test` があるものを `npm run <name>` で実行 (`test` はテストファイルが存在する場合のみ)。どちらにも無ければ**ゲート無し**として続行し、最終報告に「ゲート無し」と明記 |
| CI の扱い | `trustCI` (既定 `true`) | `true`: PR 作成後に `gh pr checks` を確認し、失敗があれば修正対象として Step 3 に戻す。`false`: `gh pr checks` は一切見ない (CI がメンテされていないリポジトリ向け) |
| レビュアー | `reviewers` (配列) | `["project"]` (詳細は Step 5) |

ゲート解決の補足:

- **モノレポ注意**: 自動導出はリポジトリルートの `package.json` しか見ない。アプリ本体がサブディレクトリ (例: `backend/app/src/`) にある場合は「ゲート無し」に解決されるため、恒久的には `.claude/workflow.json` の `gates` に明示すること
- **「ゲート無し」に解決されても**、CLAUDE.md がコード品質チェック (formatter / linter / 静的解析 / テスト) の実行方法を規定している場合は、それをローカルゲートとして扱い必ず pass させる (CI と同一チェックであることが多い)

workflow.json の例 (全フィールド任意):

```json
{
  "baseBranch": "dev",
  "gates": ["npm run type-check", "npm run lint"],
  "trustCI": false,
  "reviewers": ["project", "codex"]
}
```

## 成功条件 (全部満たしたら success を返す)

以下を**全て**客観的に確認できたときのみ完了とみなす:

- [ ] 該当 Issue 用の feature ブランチが存在し、push 済み
- [ ] PR が作成済み (`gh pr list --head <branch>` で 1 件以上)
- [ ] **解決済みローカルゲートがすべて pass** (ゲート無しの場合はこの項目を skip し最終報告に明記)
- [ ] `trustCI` が true の場合: `gh pr checks` に失敗が無い
- [ ] Step 5 のレビューを最新 HEAD に対して実行済みで、**(a) project レビューの must-fix (信頼度 ≥80) の未対応指摘が 0 件、(b) security HIGH / MEDIUM の未対応指摘が 0 件、(c) 外部レビュアー (codex / grok) 指摘のうち採用した分の未対応が 0 件** (advisory (60-79) は無視可、ただし最終報告に件数を残す。純 docs / コメントのみの PR は scope 外で skip 可、その場合は最終報告に "skipped: docs only" と記載)
- [ ] 変更点を 3〜5 行で要約した最終報告を準備済み (PR URL 含む)

## アルゴリズム (内部ループ)

```
attempts = 0
max_attempts = 10

while attempts < max_attempts:
    attempts += 1

    # Step 0: 現在地の自己診断 (毎試行必ず先頭から)
    diagnose()

    # 成功条件チェック
    if all_success_conditions_met():
        return success(pr_url, summary, attempts)

    # 残作業の特定 (Step 0 の結果から判断)
    next_step = determine_next_step()

    # 該当 step を1ステップ分だけ進める
    execute(next_step)

    # ループ先頭へ戻り、最新状態で再判定
    continue

# max 試行に達した
return failure("max attempts reached", current_state, residual_tasks)
```

## 戻り値の形式 (run-epic 等の親へ)

成功時:

```
status: success
pr_url: https://github.com/<owner>/<repo>/pull/<番号>
summary:
  - 実装内容の要約 (3〜5 行)
attempts: <使用した試行回数>
```

失敗時 (max_attempts 到達 or 致命的エラー):

```
status: failure
reason: <理由 — ローカルゲート失敗内容 / max attempts reached の現在地 等>
pr_url: <作成済なら>
last_state: <Step 0 の最終診断結果>
attempts: <使用した試行回数>
```

直接起動 (main thread) の場合は最終応答に上記を 3〜5 行で要約してユーザーに提示する。

## PROGRESS.md との連携

- **直接起動時**: リポジトリルートに `PROGRESS.md` が存在すれば、Step 0 の初回に「現在地」を上書きしてから着手する (作業中 Issue / ブランチ / 状態 / 次の一手)。コミットや PR 作成後にフックから更新要求が来たら素直に従う。書いてよいのは **git / issue に無い情報だけ**: plan との乖離・失敗アプローチと理由・ハマりどころ・次の一手
- **run-epic 経由 (worktree 子)**: **PROGRESS.md には一切触れない** (作成も更新もしない)。gitignored のため worktree には存在せず、フックも発火しない。進捗は親セッションが EPIC issue のチェックボックスと親自身の PROGRESS.md に集約する

## イデンポテント実行手順 (各試行で先頭から実行)

### Step 0: 現在地の自己診断

毎試行、以下を確認してから動く:

```
gh issue view <N> --json number,title,labels,state
git rev-parse --abbrev-ref HEAD
git log --oneline -5
gh pr list --head "$(git rev-parse --abbrev-ref HEAD)" --json number,url,state,headRefName
```

判定:

- ブランチがベースブランチ (または `main` / `master` 等の保護ブランチ) のままなら → Step 1
- feature ブランチにいるが PR 未作成なら → Step 4
- ローカルゲートが未通過なら → Step 3 (修正)
- `trustCI` が true で `gh pr checks` に失敗があるなら → Step 3 (修正)
- PR があり ローカルゲート通過済みだがレビュー未実施なら → Step 5 (レビュー)
- PR があり レビュー指摘あり (`must-fix ≥80` / `security HIGH/MEDIUM` / 採用済み外部指摘) なら → Step 3 (修正)
- すべて満たすなら → success を return

### Step 1: ブランチ準備 (初回のみ)

1. `gh issue view <N>` で本文・ラベル・関連 PR を確認
2. run-epic 経由の場合は親 EPIC issue の文脈 (関連 Sub-issue / 優先度) も確認する
3. ベースブランチは「リポジトリ設定の解決」で決めたもの (以下 `<base>`)
4. ブランチ名: `<type>/<短い kebab 要約>` または `<type>/<短い kebab 要約>-<番号>` 形式
   - `<type>` は `feat` / `fix` / `docs` / `chore` / `refactor` / `test`
   - 例: `feat/quiz-result-animation-42`, `fix/navigation-types-123`
   - リポジトリに既存のブランチ命名規約 (CLAUDE.md / git log から観察) があればそちらに従う
5. 既に同名ブランチがあれば checkout、なければ `git checkout -b <branch>` で作成

```bash
git fetch origin <base>
git checkout <base>
git pull origin <base>
git checkout -b <type>/<kebab-summary>
```

### Step 2: 参照ドキュメント (衝突時はこの順で優先)

1. `CLAUDE.md` (プロジェクト規約・Gotcha — 実装前に必ず読む。リポジトリ固有の禁止事項・死にコード・pin されたバージョン等はここが正)
2. `.claude/rules/` (存在すれば — coding-style / security / git-workflow / testing 等)
3. Issue 本文・コメント・関連 PR

リポジトリ固有の Gotcha は本スキルには書かない。**各リポジトリの CLAUDE.md の管轄**である。

### Step 3: 実装 or 修正

- 初回: Issue 要件に基づいて実装
- 2 回目以降: 前回レビュー指摘 or ローカルゲート失敗の修正
- テストが必要な変更 (ビジネスロジック・ユーティリティ関数) は実装と同時にテストを書く。テストツール・流儀はリポジトリの既存テストと CLAUDE.md / `.claude/rules/testing.md` に従う

**ローカルゲート (変更後は必ず全て pass するまで Step 4 に進まない)**:

「リポジトリ設定の解決」で決めたゲートを全て実行する。ゲート無しのリポジトリではこの確認を skip する (最終報告に明記)。

### Step 4: コミット → Push → PR

- **日本語**コミットメッセージ、Conventional Commits プレフィクス (`feat:` / `fix:` / `docs:` / `chore:` / `refactor:` / `test:`)。リポジトリの `git log` の既存流儀が異なる場合はそちらに合わせる
- 1 コミット = 1 論理変更
- co-author 行はセッション既定の指示 (harness からの指定) があればそれに従う。無ければ `Co-Authored-By: Claude <noreply@anthropic.com>`
- `git push origin <branch>` (`--no-verify` / `--no-gpg-sign` は禁止)
- PR 未作成なら `gh pr create --base <base>` で作成。本文は**日本語**、テンプレ:
  ```
  ## Summary
  ## Test plan
  ## 関連
  ```
- 変更は最小限にする (Issue スコープ外の refactor・cleanup を混ぜない)
- **push / PR 作成が permission 設定で拒否された場合** (プロジェクトの `.claude/settings.json` の deny 等): **迂回禁止** (deny の回避・設定変更・bypass フラグはしない)。ローカルで完了できる残作業 (Step 3 のゲート・Step 5 のレビュー) は先に進めてよいが、最終的に `status: failure` で return し、reason に「push が permission で拒否された」ことと人間が実行すべきコマンド (`git push origin <branch>` / `gh pr create --base <base> ...`、PR 本文案込み) を明記する

```bash
git add <変更ファイル>
git commit -m "feat: 〇〇を実装"
git push origin <branch>
gh pr create --base <base> --title "<タイトル>" --body "$(cat <<'EOF'
## Summary
- 実装内容

## Test plan
- ローカル動作確認 / テスト実行結果

## 関連
Closes #<N>
EOF
)"
```

### Step 5: コードレビュー (マルチレビュアー対応)

⚠️ **このステップは「terminal step」ではありません。** review が 0 件になっても、自分のタスクは未完了です。本ステップ完了後、**Step 6 (完了報告) を必ず連続実行**してください。「review skill の execution が return した」≠「implement-issue タスクが完了した」

⚠️ **実測 2 回の事故パターン (最重要)**: レビュー (特に /security-review) の実行直後、その**レビューレポートを自分の最終応答にしてタスクを終了**してしまう — review skill の出力フォーマット指示に応答が乗っ取られる。レビューが return したら、**応答を書かずに必ず次のツール呼び出し (トリアージ → PR コメント投稿) を実行**すること。レビューレポート自体を最終応答にしてはならない。

#### レビュアーの解決 (優先順)

1. 起動引数の明示指定: `review=codex,grok` (自然言語指定も同義)
2. `.claude/workflow.json` の `reviewers` 配列 (例: `["project", "codex"]`)
3. 既定: `["project"]`

#### 各レビュアーの実行方法

指定された全レビュアーを**同一ターンで並列実行**する (最新 HEAD に対して)。並列化は**同一メッセージ内の複数 Agent 呼び出し (同期)** で行うこと — background 起動 + SendMessage 返信方式は、返信の宛先不達・通知の迷子が実測で発生している:

- **`project`**: リポジトリに project 用 review skill (`.claude/skills/code-review-project/` が慣例) があれば**それを使う** (Gotcha リスト等のリポジトリ固有知見を含むため素の公式 skill より優先)。無ければ公式 `/code-review` にフォールバックし、あわせて `/security-review` も並列実行する
- **`codex`**: `Agent(subagent_type: "codex:codex-rescue")`
- **`grok`**: `Agent(subagent_type: "grok-cc:grok-rescue")`

**外部レビュアー (codex / grok) には GitHub を参照させない** (実行環境から GitHub API に届かない実績のある罠)。prompt に以下を直接埋め込む:

- ローカル repo の絶対パス
- レビュー対象ブランチ名とベースブランチ名 (diff は `git diff <base>...<branch>` 等ローカル git で取らせる)
- **Issue 本文の全文** (受け入れ条件込み)
- 出力形式の指定: 指摘ごとに「対象ファイル:行 / 問題 / 根拠 / 修正案」

**可用性フォールバック**: 指定された agent type / skill が環境に存在しなければ、**停止せず**「<name> は利用不可、残りで続行」として続行し、最終報告に明記する。

**エンジン実起動の確認 (実測で発生した罠)**: rescue 系 agent は外部 CLI (Codex / Grok) を呼べない時に**黙って Claude 自身が代行レビュー**することがある。それでは「独立した別エンジンの視点」という外部レビュアーの目的が満たされない。対策:
- 外部レビュアーへの prompt に必ず含める: 「**外部 CLI (Codex/Grok) を実際に起動し、その出力に基づいて報告せよ。CLI が起動できない (未認証・未インストール等) 場合は代行レビューをせず『利用不可: <理由>』とだけ返せ**。報告の冒頭にエンジン実起動の有無を明記せよ」
- 応答にエンジン実起動の明示が無い/代行だった場合は、そのレビュアーを「利用不可」として扱い (代行レビューの内容自体は参考情報として扱ってよい)、最終報告に正確に記載する

#### 採否判定とゲート

- project レビューの指摘: **must-fix (信頼度 ≥80)** と **security HIGH / MEDIUM** は Step 3 に戻って対応 (次の試行で修正)。security LOW は判断に委ね、却下時は理由を最終報告に添える。**advisory (信頼度 60-79)** は却下可、ただし件数と内容を最終報告に添える
- 外部レビュアー (codex / grok) の指摘には confidence スコアが無いので、**1 件ずつトリアージ**して「採用 (must-fix 扱い → Step 3 で対応) / 却下 (理由必須)」に振り分ける
- レビュー結果 (却下した指摘とその理由を含む) を **PR コメントとして投稿** (`gh pr comment <PR> --body "..."`) — 人間が後から採否判定を検証できるように。PR が未作成の場合 (push 拒否等) は同内容を最終報告に記載する
- 純 docs / コメントのみの PR (例: `*.md` のみの変更) は **scope 外で skip 可**、最終報告に「review skipped: docs only」と明記
- **must-fix + security HIGH/MEDIUM + 採用済み外部指摘 が全て 0 件 (skip 含む) を確認できたら、即座に Step 6 へ進む。ここで親へ return しない**

### Step 6: 完了報告 (success を return する直前)

⚠️ **直接起動 vs run-epic 経由で出口が異なる**:

- **直接起動 (`/implement-issue 42`)**: 成功条件を満たした時点で本ステップを実行 → ユーザーへ最終報告。merge / close は**ユーザー判断** (本 skill のスコープ外)
- **run-epic 経由**: 成功条件を満たしただけでは**まだ親に return してはいけない**。run-epic の prompt template が要求する追加 step (PR 状態確認 + ローカルゲート最終確認 + 自己診断) を続けて実行してから親に return する。**merge / Issue close は行わない** (merge は人間判断)

最終報告に以下を含める:

- PR URL
- 実装内容の要約 (箇条書き 3〜5 行)
- ローカルゲートの実行結果 (各ゲートの pass/skip。ゲート無しならその旨)
- `trustCI` の扱い (true なら `gh pr checks` の結果、false なら「CI 不参照」)
- レビュアーごとの指摘件数と採否。例: `codex: 3件 (採用1・却下2) / grok: 利用不可 / project: must-fix 0・advisory 2`
- 却下した指摘の理由 (簡潔に列挙)
- 試行回数 (attempts)

直接起動の場合のみ、最終応答後に `/claude-md-management:revise-claude-md` が利用可能ならセッションの学びを CLAUDE.md に蓄積する (コミットはリポジトリの流儀に従う)。run-epic 経由の場合は親側で集約するため子はスキップ。

## 厳守事項

- **ベースブランチと保護ブランチ (`main` / `master` / `dev` 等) への直接コミット・マージは禁止**。必ず PR 経由
- **`--no-verify` / `--no-gpg-sign` などの bypass フラグは使わない**
- **`.env` / API キー / 証明書をコミットしない**
- **security 系 rules 違反の指摘は最優先で直す**
- **変更は Issue スコープ最小限**。周辺の整理整頓を PR に混ぜない
- **`max_attempts = 10` を超えたら必ず failure を return**。無限ループは禁止 (リトライ判断は呼び出し元に委ねる)
- **解決済みローカルゲートは必ず pass してから PR を作成・更新する**

## 起動例

直接:
```
/implement-issue 42
/implement-issue 42 review=codex,grok
```

run-epic 経由 (推奨、main context 保護):
```
/run-epic 252
```
→ run-epic が EPIC #252 の OPEN な Sub-issue ごとに `Agent({isolation: "worktree"})` で spawn し、子が本スキルのアルゴリズムを実行
