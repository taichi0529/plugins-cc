---
name: implement-issue
description: GitHub Issue を内部ループで end-to-end 実装するスキル (リポジトリ非依存)。ブランチ作成 → 実装 → ローカル検証 → コード整理 (/simplify) → セキュリティレビュー (/security-review) → コミット → push → PR 作成 → コードレビュー → 修正までを「現在の状態を読み直し、次の1歩を進める」を最大10回繰り返して完了させる。「Issue 実装して」「#123 を実装」「implement issue」「イシューを実装」などのリクエスト時に使用。引数は Issue 番号 + 任意の review= / review-model= 指定 (例 `42 review=codex,grok review-model=opus`)。
---

# Issue Implementation Skill (汎用)

GitHub Issue の実装を、ブランチ作成から PR 作成・レビュー対応まで**一度の実行で end-to-end** に完了させる。
本スキルは内部に有限ループ (最大 10 試行) を持ち、各試行は「現在の状態を自己診断 → 次に必要な1歩だけ進める」を繰り返して、成功条件を全て満たすか max 試行に達したら return する。

引数: `$ARGUMENTS`
- 第1引数: Issue 番号 (例: `42`, `#42`)
- 任意: `review=<reviewer,...>` (例: `review=codex,grok`)。省略時の既定は `project,adversarial,grok`。自然言語での指定 (「codex でもレビューして」) も同義に解釈する
- 任意: `review-model=<モデル名>` (例: `review-model=sonnet`)。レビュー系実行体 (Step 3.5 / 3.6 / 5) を走らせるモデル。省略時の既定は **`opus` (effort high)**。詳細は「レビュー系実行体のモデル解決」を参照
- **`model=` は受け付けない**。指定された場合は実行せず「implement-issue に `model=` は無い。レビュー系のモデルは `review-model=`、run-epic の子エージェントのモデルは run-epic 側の `model=`」と報告して停止する (黙って `review-model` と読み替えない)

## 動作モード

このスキルは2つの方法で起動される。どちらの場合も同じアルゴリズムを実行する。

1. **直接起動** (`/implement-issue 42`): 現在のスレッドがそのままアルゴリズムを実行する。実装 (Step 3) のモデル・effort は**セッションの設定のまま** (skill から切り替える手段は無い)
2. **run-epic からの委譲**: 親 (run-epic) が `Agent({subagent_type: "workflow-cc:implementer", isolation: "worktree", prompt: "本スキルを読んでアルゴリズムを実行"})` で spawn し、子エージェントが本スキルを Read してアルゴリズムを実行する。実装のモデル・effort は `workflow-cc:implementer` の frontmatter (既定 opus / medium) と run-epic の `model=` で決まる

直接起動時もメインコンテキストの汚染が気になるなら、子エージェントへ委譲してから本スキルを実行させる構成に切り替えてよい。判断はユーザーの状況次第。

## リポジトリ設定の解決 (正典 — run-epic / create-issue もこの規則を参照する)

ハードコード禁止。設定ファイルは `.claude/workflow-cc.json` (リポジトリルート・任意) のみ。**無くても全項目が自動導出で動くこと。**

旧 `.claude/workflow.json` (〜0.4.x) は**読まない** (0.5.0 で廃止)。旧ファイルの存在を検出した場合は「`.claude/workflow.json` は 0.5.0 で廃止。`.claude/workflow-cc.json` へリネームしてください (`scopes` 無しのフラット形式はそのまま有効)」と最終報告に案内する。

### workflow-cc.json スキーマとキー許可リスト

```json
{
  "baseBranch": "dev",
  "trustCI": true,
  "gates": ["npm run type-check"],
  "reviewers": ["project"],
  "dodFiles": [".claude/dod/common.md"],
  "scopes": [
    { "paths": ["apps/web"], "gates": ["npm run lint -w web"], "reviewers": ["project", "grok"] },
    { "paths": ["backend"], "gates": ["make -C backend test"], "dodFiles": [".claude/dod/backend.md"] }
  ]
}
```

| キー | ルート直下 (repo-wide) | `scopes[]` 要素内 |
|---|---|---|
| `baseBranch` / `trustCI` | 可 | **禁止** — 記載があれば設定エラーとして実行せず停止・報告する |
| `gates` / `reviewers` / `dodFiles` | 可 (グローバル既定) | 可 (マッチ時にグローバルへ**追加** union) |
| `paths` | — | **必須**・非空のパス配列 (リポジトリ相対 POSIX) |

全フィールド任意。`scopes` の無いファイルはフラット形式として従来どおり動く。

### 二段階解決

**① 起動時 (最初の試行の冒頭で 1 回)** — repo-wide のみ解決する:

| 項目 | 設定ファイル (ルート直下) | 自動導出 (設定に無い場合) |
|---|---|---|
| repo slug | — | `gh repo view --json nameWithOwner -q .nameWithOwner` (失敗時は `git remote get-url origin` から導出) |
| ベースブランチ | `baseBranch` | `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` |
| CI の扱い | `trustCI` (既定 `true`) | `true`: PR 作成後に `gh pr checks` を確認し、失敗があれば修正対象として Step 3 に戻す。`false`: `gh pr checks` は一切見ない (CI がメンテされていないリポジトリ向け) |
| グローバル既定の gates / reviewers / dodFiles | `gates` / `reviewers` / `dodFiles` | (② と補足を参照。reviewers の最終既定は `["project", "adversarial", "grok"]`) |

**② ゲート実行直前・レビュアー起動直前 (Step 3 のゲート / Step 5 のたびに再解決)** — 変更ファイル集合から scope を解決する:

1. 変更ファイル集合 = 以下の和集合 (rename は新パス側を採る):
   ```bash
   git diff --name-only <base>...HEAD          # コミット済み
   git diff --name-only --cached               # staged
   git diff --name-only                        # unstaged
   git ls-files --others --exclude-standard    # untracked
   ```
2. 各 `scopes[]` 要素は、変更ファイルのいずれかが `paths` のいずれかに **prefix マッチ**すれば採用
3. 実行する gates / reviewers / dodFiles = ルートのグローバル既定 → 採用 scope の配列 (`scopes` の記載順) を**この順で連結**し、**文字列完全一致で dedupe (初出順保持)**
4. 結果が空 (グローバルも scope も無し) なら従来の自動導出: リポジトリルートの `package.json` の scripts に `type-check` / `lint` / `test` があるものを `npm run <name>` で実行 (`test` はテストファイルが存在する場合のみ)。それも無ければ**ゲート無し**として続行し、最終報告に明記

**prefix マッチ規則 (誤マッチ防止・厳守)**:

- `paths` 要素とファイルパスはリポジトリ相対 POSIX 形式に正規化する: 先頭 `./` を除去、末尾 `/` を除去。絶対パス・`..` 含み・空文字は設定エラーとして停止
- マッチ条件: `file == prefix` **または** `file` が `prefix + "/"` で始まる (ディレクトリ境界)。例: `paths: ["apps/web"]` は `apps/web/index.ts` にマッチし、`apps/web-old/x.ts` には**マッチしない**

### 最終報告への明記 (provenance)

- `config_source`: `workflow-cc` / `auto-derive` のいずれか
- 採用された scope (あれば) と、それにより実行された gates / reviewers
- 旧 `.claude/workflow.json` を検出した場合はリネーム案内

### ゲート解決の補足

- **モノレポ**: サブプロジェクトごとにゲートが違う場合は `workflow-cc.json` の `scopes[]` で宣言すること (自動導出はリポジトリルートの `package.json` しか見ない。アプリ本体がサブディレクトリにある場合、宣言が無いと「ゲート無し」に解決される)
- **「ゲート無し」に解決されても**、CLAUDE.md がコード品質チェック (formatter / linter / 静的解析 / テスト) の実行方法を規定している場合は、それをローカルゲートとして扱い必ず pass させる (CI と同一チェックであることが多い)

## レビュー系実行体のモデル解決 (`review-model` — 正典)

Step 3.5 (`/simplify`) / Step 3.6 (`/security-review`) / Step 5 (project・adversarial レビュー) を**どのモデル・effort で走らせるか**を決める。**実装本体 (Step 3) には影響しない** (実装は現在のセッション / 子エージェントのモデル・effort のまま)。

レビュー系実行体は本 plugin の **`workflow-cc:reviewer` agent** で起動する。その frontmatter が既定値を持つ: **`model: opus` / `effort: high`**。レビューは見落としの代償が大きく、実装より高い effort を充てる価値があるため。Agent 呼び出しで上書きできるのは `model` だけで、effort は frontmatter で固定される (変えたい場合は `agents/reviewer.md` を編集する)。

### 値の解決と起動の形

| 指定 | 起動の形 | モデル / effort |
|---|---|---|
| 省略 (既定) | `Agent(subagent_type: "workflow-cc:reviewer")` — `model` パラメタは付けない | opus / high |
| `review-model=<モデル名>` (例: `review-model=sonnet`。「レビューは sonnet で」等の自然言語も同義) | `Agent(subagent_type: "workflow-cc:reviewer", model: "<モデル名>")` | 指定モデル / high |
| `review-model=inherit` | `Agent(subagent_type: "general-purpose")` — `model` パラメタは付けない | セッション (子エージェント) のモデル・effort をそのまま継承 |

以下、この表で決まった起動の形を **`<R>`** と書く。

- 値の allowlist は本 SKILL に持たない (利用可能なモデル名は harness 側の事実で環境ごとに変わる。代表例: `haiku` / `sonnet` / `opus` / `fable`)。値が空なら実行せずエラーを報告して停止
- `.claude/workflow-cc.json` には**入れない**。モデル選択は個人・コスト都合であってリポジトリの事実ではない (run-epic の `model=` と同じ理由)

### 利用不可だったときの扱い (明示指定と既定で分ける)

| 状況 | 挙動 |
|---|---|
| **`review-model=` で明示した値**の spawn が拒否された | **フォールバックせず停止**し「review-model=<値> が環境で利用不可」と報告する |
| **既定**の spawn がモデル起因で拒否された (opus が使えない環境) | **停止しない**。`Agent(subagent_type: "general-purpose")` (モデル・effort 継承) で即座に再試行し、最終報告に「review-model 既定の opus が利用不可のため継承で実行」と明記する |
| `workflow-cc:reviewer` が agent type として解決できない (plugin の読み込み不備等) | `general-purpose` に同じ prompt を渡して起動する。既定なら `model: "opus"`、明示値ならその値を付ける。この経路は **effort 未適用**として最終報告に明記する |

「ユーザーが選んだ値を黙って別物に差し替えない」と「ユーザーが選んでいない既定で本体のループを止めない」を両立させる (後者は Step 3.5 / 3.6 の fail-open と同じ思想)。

### 適用範囲 (ロール別)

| ロール | 実行体 | 適用 |
|---|---|---|
| simplify (Step 3.5) | `<R>` の中で Skill ツールから `simplify` を起動させる。subagent 内で `simplify` が解決できなければ `Agent(subagent_type: "code-simplifier:code-simplifier")` (明示値があれば `model` も付ける)、それも無ければ Skill ツールで `simplify` を現セッションから起動 | `<R>` 経路は両方。code-simplifier 経路は model のみ (effort は同 agent の定義次第)。Skill 直接経路はどちらも未適用 |
| security-review (Step 3.6) | `<R>` の中で Skill ツールから `security-review` を起動させる | 両方 |
| project (Step 5) | `<R>` の中で、リポジトリの review skill / 公式 `/code-review` を起動させる | 両方 (公式 `/code-review` が内部でさらに fork する分までは制御できない) |
| adversarial (Step 5) | `<R>` | 両方 |
| codex / grok (Step 5) | `Agent(subagent_type: "codex:codex-rescue" / "grok-cc:grok-rescue")` | **対象外** — 実際にレビューするのは外部 CLI 側のエンジン。`review-model` は渡さない |

**最終報告に「どのロールにどのモデル・effort が実際に適用されたか」を書く** (適用できなかったロールは理由付きで)。ここを書かないと「opus high でレビューしたつもりが継承モデルだった」という取り違えが検出できない。

## 成功条件 (全部満たしたら success を返す)

以下を**全て**客観的に確認できたときのみ完了とみなす:

- [ ] 該当 Issue 用の feature ブランチが存在し、push 済み
- [ ] PR が作成済み (`gh pr list --head <branch>` で 1 件以上)
- [ ] **解決済みローカルゲートがすべて pass** (ゲート無しの場合はこの項目を skip し最終報告に明記)
- [ ] 最初の PR 作成前に `/simplify` を実行済み (利用不可 / docs-only で skip した場合はその旨を最終報告に明記)
- [ ] 最初の PR 作成前に `/security-review` を実行済みで、**HIGH / MEDIUM の未対応指摘が 0 件** (利用不可 / docs-only で skip した場合はその旨を最終報告に明記)
- [ ] `trustCI` が true の場合: `gh pr checks` に失敗が無い
- [ ] Step 5 のレビューを最新 HEAD に対して実行済みで (初回ラウンドはフル実行、2 回目以降は差分照合モードで可)、**(a) project レビューの must-fix (信頼度 ≥80) の未対応指摘が 0 件、(b) security HIGH / MEDIUM の未対応指摘が 0 件、(c) 外部レビュアー (codex / grok) / adversarial レビューの指摘のうち採用した分の未対応が 0 件** (advisory (60-79) は無視可、ただし最終報告に件数を残す。純 docs / コメントのみの PR は scope 外で skip 可、その場合は最終報告に "skipped: docs only" と記載)
- [ ] Step 6 の項目を満たす最終報告を準備済み (PR URL 含む)

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

直接起動 (main thread) の場合は、上記の代わりに Step 6 の最終報告をユーザーに提示する。

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
- feature ブランチにいるが PR 未作成なら → Step 3.5 (simplify 未実施の場合) → Step 3.6 (security-review 未完了の場合) → Step 4
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

「リポジトリ設定の解決」の **② をこの時点で再解決** (変更ファイル集合 → scope マッチ → union) し、得られたゲートを全て実行する。ゲート無しに解決されたリポジトリではこの確認を skip する (最終報告に明記)。

### Step 3.5: コード整理 (/simplify — 最初の PR 作成前に 1 回)

**最初の PR 作成前に必ず 1 回**実行する。**PR 作成後の修正ループでは再実行しない** (レビュー対応の diff を最小に保ち、採否検証を容易にするため)。

1. 前提: Step 3 の解決済みローカルゲートがすべて pass していること
2. 「レビュー系実行体のモデル解決」で決めた `<R>` で起動する:
   - **第 1 選択**: `<R>` を起動し、prompt に「**Skill ツールで `simplify` を起動**し、機能を変えない整理だけを行え。結果 (整理の概要と変更ファイル) を返せ」+ リポジトリの絶対パス + ベースブランチ名 + 本ブランチ名 を埋め込む
   - **第 2 選択** (subagent 内で `simplify` が解決できなかった場合): `Agent(subagent_type: "code-simplifier:code-simplifier")` (`review-model=` の明示値があれば `model` も付ける) に同じ指示を渡す。この経路は **effort high 未適用** — 最終報告に明記する
   - **第 3 選択** (上記どちらも解決できない環境): Skill ツールで `simplify` を現セッションから起動する。**この経路ではモデル・effort とも指定できない** — 最終報告に「simplify: model/effort 未適用 (Skill 経路)」と明記する
   - どの経路でも対象は**本ブランチの変更ファイル (`git diff <base>...HEAD` の範囲) に限定**し、Issue スコープ外のファイルには触れさせない
3. simplify が変更を加えた場合: **解決済みローカルゲートを再実行** (「リポジトリ設定の解決」② を再解決) し、すべて pass するまで Step 4 に進まない。simplify 起因でゲートが落ちた場合は該当の整理を revert してよい (**機能維持が最優先** — simplify は機能を変えない整理だけが目的)
4. **skip 条件** (いずれかに該当したら skip し、最終報告に明記):
   - 純 docs / コメントのみの変更 (例: `*.md` のみ) → "simplify skipped: docs only"
   - **diff が小さい**: `git diff <base>...HEAD --shortstat` の追加 + 削除行の合計が **20 行未満** → "simplify skipped: small diff (<20 lines)" (起動コストが期待効果を上回るため)
5. **可用性フォールバック**: 上記の第 1〜第 3 選択がいずれも解決できない場合は**停止せず** Step 3.6 へ進み、最終報告に「simplify 利用不可」と明記する

### Step 3.6: セキュリティレビュー (/security-review — 最初の PR 作成前)

Step 3.5 の直後に実行する。**HIGH / MEDIUM の未対応指摘が 0 件になるまで PR を作成しない** (push 前に検出するのが目的 — PR 後の指摘は公開済みコードへの後追いになる)。

1. 「レビュー系実行体のモデル解決」で決めた `<R>` の subagent 内で公式 `/security-review` を起動する:
   - `<R>` を起動し、prompt に埋め込む: 「**Skill ツールで `security-review` を起動**し、その指摘 (深刻度 / 対象ファイル:行 / 根拠 / 修正案) を構造化して返せ。**自分では修正しない** (採否は呼び出し元が判断する)」+ リポジトリの絶対パス + ベースブランチ名 + 本ブランチ名 (対象は現在のブランチと `<base>` の diff)
   - subagent 内から `security-review` が解決できなかった場合はその旨を返させ、**現セッションから Skill ツールで直接起動**する (この経路ではモデル・effort とも未適用 — 最終報告に明記)
   - 副次的な利点: レポートが tool result として返るため、下記 6 の「レビューレポートを自分の最終応答にしてしまう」事故が構造的に起きにくくなる
2. 指摘の扱い: **HIGH / MEDIUM は Step 3 に戻って修正** → 解決済みゲート再実行 → **本 Step を再実行**して 0 件を確認してから Step 4 へ。**LOW** は判断に委ね、却下時は理由を最終報告に添える
3. **PR 作成後の修正ループでは再実行しない**。ただしレビュー対応でセキュリティに敏感な変更 (認証・認可・外部入力の扱い・シークレット・SQL / コマンド組み立て等) を加えた場合は再実行する。この再実行は Step 5 の次ラウンドのレビュアーと**同一メッセージで並列起動**する (Step 5「並列実行の原則」)
4. **skip 条件**: 純 docs / コメントのみの変更 (例: `*.md` のみ) は skip し、最終報告に "security-review skipped: docs only" と明記
5. **可用性フォールバック**: `/security-review` skill が環境に存在しない場合は**停止せず** Step 4 へ進み、最終報告に「security-review 利用不可」と明記する
6. ⚠️ **レビューレポートを自分の最終応答にしない** (Step 5 の事故パターンと同じ罠)。review skill が return したら、応答を書かずに必ず次のツール呼び出し (HIGH/MEDIUM の修正 or Step 4 のコミット) を実行する

### Step 4: コミット → Push → PR

- **日本語**コミットメッセージ、Conventional Commits プレフィクス (`feat:` / `fix:` / `docs:` / `chore:` / `refactor:` / `test:`)。リポジトリの `git log` の既存流儀が異なる場合はそちらに合わせる
- 1 コミット = 1 論理変更
- co-author 行はセッション既定の指示 (harness からの指定) があればそれに従う。無ければ `Co-Authored-By: Claude <noreply@anthropic.com>`
- `git push origin <branch>` (`--no-verify` / `--no-gpg-sign` は禁止)
- PR 未作成なら、**Step 3.5 (/simplify) と Step 3.6 (/security-review・HIGH/MEDIUM 0 件) を通過済みであることを確認してから** `gh pr create --base <base>` で作成 (未実施なら該当 Step に戻る)。本文は**日本語**、テンプレ:
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

本ステップの後には Step 6 (完了報告) が続く。レビューが return したら、そのレポートを最終応答にせず次のツール呼び出し (トリアージ → PR コメント投稿) に進む — review skill の出力フォーマット指示に応答が引きずられ、レポートを最終応答にして終了した例が過去 2 回ある (Skill 経路で現セッションから起動した場合に起きやすい)。

#### レビュアーの解決 (優先順)

1. 起動引数の明示指定: `review=codex,grok` (自然言語指定も同義)
2. 設定ファイルの `reviewers` (「リポジトリ設定の解決」② — グローバル既定 + 変更ファイルにマッチした scope の union)
3. 既定: `["project", "adversarial", "grok"]` (adversarial / grok を外したいリポジトリは設定ファイルの `reviewers` で明示指定する。その回だけ外すなら `review=project,adversarial` — 引数 / 設定があれば既定は使われない)
   - `grok` を既定に含めるのは、project / adversarial がどちらもセッションと同系統のモデルで動くため。**別エンジンの視点**を 1 つ常設して、同じ盲点を共有するレビューだけで合格させない
   - grok-cc plugin が未インストール / Grok CLI が未認証の環境では下記「可用性フォールバック」で `grok: 利用不可` として続行する (既定に含まれているだけで本体のループを止めない)

#### レビューラウンドの方式 (初回フル / 2 回目以降は差分照合)

- **初回ラウンド**: 指定された全レビュアーをフル実行する (下記「各レビュアーの実行方法」)。実行時の `git rev-parse HEAD` を記録する
- **2 回目以降のラウンド (修正後の再レビュー)**: 全レビュアーの全量再実行は**しない** (同じ diff を何度も読ませるのはトークンの無駄):
  - 再実行するのは**前ラウンドで未対応指摘 (must-fix / security HIGH・MEDIUM / 採用した外部指摘) を出したレビュアーだけ**。指摘 0 件だったレビュアーは再実行しない
  - prompt に渡すのは「前ラウンドの該当指摘リスト」+「修正 diff (`git diff <前ラウンドの HEAD SHA>...HEAD`)」のみ。full diff と Issue 本文の再埋め込みはしない
  - 判定させるのは 2 点だけ: (a) 各指摘が解消されたか (b) 修正 diff 自体に新たな問題が無いか
  - ラウンドごとに実行時 HEAD SHA を記録し直す
  - 再実行対象が複数いるなら、**差分照合ラウンドでも同一メッセージで並列起動**する (下記「並列実行の原則」)
  - 再実行時の起動の形は初回と同じ `<R>` を使う (ラウンドごとにモデル・effort を変えない — 指摘の解消判定が同じ基準で行われるように)
  - **フル再実行に戻す例外**: 修正がレビュー済み範囲を大きく超えた場合 (目安: 修正 diff の行数が前ラウンドでレビューした diff の 5 割超)。この場合は初回と同じフル実行にする

#### 並列実行の原則 (レビュー系は並列にできるものを必ず並列にする)

レビュー系実行体は**互いに独立で、かつ working tree を書き換えないもの同士なら、必ず同一メッセージ内の複数 Agent 呼び出し (同期) で並列起動する**。1 体ずつ結果を待ってから次を起動しない (待ち時間が直列に積み上がるだけで、得られる指摘は変わらない)。

| 場面 | 並列にするもの |
|---|---|
| Step 5 のフルラウンド | 解決された全レビュアー (project / adversarial / grok / codex) |
| Step 5 の差分照合ラウンド | 再実行対象になったレビュアー全員 |
| Step 5 のラウンド中に Step 3.6 の再実行が必要になった場合 (セキュリティに敏感な修正を入れた) | そのラウンドのレビュアー + security-review を同じメッセージで起動 |

- 並列化の手段は**同一メッセージ内の複数 Agent 呼び出し (同期) に限る**。background 起動 + SendMessage 返信方式は、返信の宛先不達・通知の迷子が実測で発生している
- **全員の結果が揃ってからトリアージする** (先に返ってきた 1 体の指摘で修正を始めない — 残りのレビュアーが古い HEAD を読むことになり、指摘と行番号がずれる)
- Skill 経路に落ちたロール (モデル・effort 未適用) は現セッションで動くため並列にできない。**Agent 経路のロールを先に並列起動し、その結果を受け取ってから** Skill 経路のロールを実行する
- **並列にしないもの**: Step 3.5 (`/simplify`) → Step 3.6 (`/security-review`) は**直列のまま**。simplify は working tree を書き換える唯一のレビュー系実行体で、並走させると security-review が整理途中のコードを読む。「整理済みのコードに対して 1 回で済ませる」という Step 3.6 の前提も崩れる

#### 各レビュアーの実行方法 (フル実行の形)

指定された全レビュアーを上記の原則どおり**同一ターンで並列実行**する (最新 HEAD に対して)。

`<R>` は「レビュー系実行体のモデル解決」で決めた起動の形 (既定は `Agent(subagent_type: "workflow-cc:reviewer")` = opus / effort high):

- **`project`**: `<R>` を起動し、その中で review skill を実行させる。使わせる skill は「リポジトリに project 用 review skill (`.claude/skills/code-review-project/` が慣例) があればそれ (Gotcha リスト等のリポジトリ固有知見を含むため素の公式 skill より優先)、無ければ公式 `/code-review`」の順で、**親が起動前に解決して prompt に名前で埋め込む** (子に探させない)。prompt には「自分では修正せず指摘を構造化して返せ」+ リポジトリの絶対パス + ベースブランチ名 + 本ブランチ名 も入れる。subagent 経路が使えない環境では現セッションから Skill ツールで直接起動し「project: model/effort 未適用 (Skill 経路)」と最終報告に明記する。`/security-review` は **Step 3.6 で PR 作成前に実行済みのためここでは再実行しない** (二重実行の廃止)。ただしレビュー対応でセキュリティに敏感な変更を加えた場合は Step 3.6 の規則に従い再実行する
- **`codex`**: `Agent(subagent_type: "codex:codex-rescue")` — **`model` は渡さない** (実際にレビューするのは外部 CLI 側のエンジン)
- **`grok`** (既定に含まれる): `Agent(subagent_type: "grok-cc:grok-rescue")` — 同上、`model` は渡さない
- **`adversarial`** (既定に含まれる): `<R>` で**実装とは独立したコンテキスト**の red-team レビューを起動する (実装した本人のコンテキストで自己批判させない — 自己整合バイアスで甘くなる)。prompt に埋め込む:
  - ローカル repo の絶対パス・レビュー対象ブランチ名・ベースブランチ名 (diff は `git diff <base>...<branch>` 等ローカル git で取らせる)
  - **Issue 本文の全文** (受け入れ条件込み)
  - 役割指定: 「**この変更は壊れていると仮定し、実際に壊れる具体的シナリオを探せ**。観点: 受け入れ条件を満たさない入力・状態 / 境界値 (空・0・巨大・不正型) / 並行・順序依存 / エラーパスでの状態・リソースの取りこぼし / 既存呼び出し元の後方互換。**再現手順または根拠となるコード行を示せない指摘は出すな** (『〜かもしれない』の羅列は禁止)。スタイル・好みには触れるな (simplify / project の担当)」
  - 出力形式の指定: 指摘ごとに「対象ファイル:行 / 壊れるシナリオ (入力・状態 → 期待 vs 実際) / 根拠 / 修正案」
  - セキュリティ脆弱性は Step 3.6 (/security-review) の担当 — adversarial は**機能の破壊**にフォーカスする (発見したら報告してよいが主目的にしない)

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
- 外部レビュアー (codex / grok) と adversarial の指摘には confidence スコアが無いので、**1 件ずつトリアージ**して「採用 (must-fix 扱い → Step 3 で対応) / 却下 (理由必須)」に振り分ける。adversarial の指摘は**再現シナリオの具体性**で判定する (シナリオが実際に成立するかをコードで確認してから採否を決める)
- レビュー結果 (却下した指摘とその理由を含む) を **PR コメントとして投稿** (`gh pr comment <PR> --body "..."`) — 人間が後から採否判定を検証できるように。PR が未作成の場合 (push 拒否等) は同内容を最終報告に記載する
- 純 docs / コメントのみの PR (例: `*.md` のみの変更) は **scope 外で skip 可**、最終報告に「review skipped: docs only」と明記
- **must-fix + security HIGH/MEDIUM + 採用済み外部指摘 が全て 0 件 (skip 含む) を確認できたら、即座に Step 6 へ進む。ここで親へ return しない**

### Step 6: 完了報告 (success を return する直前)

⚠️ **直接起動 vs run-epic 経由で出口が異なる**:

- **直接起動 (`/implement-issue 42`)**: 成功条件を満たした時点で本ステップを実行 → ユーザーへ最終報告。merge / close は**ユーザー判断** (本 skill のスコープ外)
- **run-epic 経由**: 成功条件を満たしただけでは**まだ親に return してはいけない**。run-epic の prompt template が要求する追加 step (PR 状態確認 + ローカルゲート最終確認 + 自己診断) を続けて実行してから親に return する。**merge / Issue close は行わない** (merge は人間判断)

最終報告に以下を含める:

- PR URL
- 実装内容の要約 (箇条書き。PR を開かなくても変更の要点が分かる粒度で)
- ローカルゲートの実行結果 (各ゲートの pass/skip。ゲート無しならその旨)
- `/simplify` の結果 (適用された整理の概要 / "simplify skipped: docs only" / 「simplify 利用不可」のいずれか)
- `/security-review` の結果 (HIGH / MEDIUM / LOW の件数と対応状況・LOW 却下の理由 / "security-review skipped: docs only" / 「security-review 利用不可」のいずれか)
- `trustCI` の扱い (true なら `gh pr checks` の結果、false なら「CI 不参照」)
- レビュアーごとの指摘件数と採否。例: `project: must-fix 0・advisory 2 / adversarial: 2件 (採用1・却下1) / grok: 3件 (採用1・却下2) / codex: 利用不可`
- レビューのラウンド数と方式 (例: `フル 1 + 差分照合 2`)
- **レビュー系のモデル・effort の解決値と実際の適用状況**。例: `review: opus / effort high (既定・workflow-cc:reviewer) — simplify / security-review / project / adversarial に適用。grok は対象外 (外部エンジン)`。既定が利用不可で継承に落ちた場合・effort 未適用の経路 (general-purpose / code-simplifier) や Skill 経路に落ちたロールがある場合は必ずここに書く
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
- **`review-model=` で明示された値が使えないときに、黙って別のモデルへ落とさない** (停止して報告する)。逆に既定 (opus / effort high) が使えないだけで本体のループを止めない (継承で続行し報告に明記)

## 起動例

直接:
```
/implement-issue 42
/implement-issue 42 review=codex,grok             # レビュアーを明示 (既定は project,adversarial,grok)
/implement-issue 42 review=project,adversarial   # grok を外す
/implement-issue 42 review-model=sonnet          # レビュー系を sonnet (effort high) で回す (既定は opus / high)
/implement-issue 42 review-model=inherit         # レビュー系もセッションのモデル・effort を継承
```

run-epic 経由 (推奨、main context 保護):
```
/run-epic 252
```
→ run-epic が EPIC #252 の OPEN な Sub-issue ごとに `Agent({subagent_type: "workflow-cc:implementer", isolation: "worktree"})` で spawn し、子 (既定 opus / effort medium) が本スキルのアルゴリズムを実行
