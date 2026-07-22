---
name: run-epic
description: EPIC issue 番号を渡すと、その Sub-issues を GitHub API で取得し、未クローズの子 issue を 1 つずつ子エージェント (general-purpose, isolation=worktree) に委譲して直列実装するオーケストレーター skill (リポジトリ非依存)。各子は implement-issue のアルゴリズムを内部ループで完走させ、ローカルゲート通過 → PR 作成まで担い、親に構造化結果を返す。自動 merge はしない (merge は人間)。「EPIC #252 を回して」「run epic 252」「EPIC の sub-issue を全部実装」などのリクエスト時に使用。EPIC の issue 番号を引数として受け取る。
---

# Run-Epic Skill (EPIC Sub-issue 直列オーケストレーション・汎用)

EPIC issue にぶら下がる **Sub-issues を直列に**実装するオーケストレーター。ローカルの todo ファイルではなく、**GitHub の Sub-issues API を唯一の作業リスト**として扱う。未クローズの子 issue を上から順に子エージェントへ委譲し、各 issue を「実装 → ローカルゲート pass → PR 作成」まで完走させる。

> 進捗管理は GitHub の Sub-issues 機能が自動で行う (親 EPIC の進捗バー)。PR が merge され子 issue が close されると進捗バーが自動更新される。本スキルはローカル todo ファイルを持たない。

引数: `$ARGUMENTS` (EPIC の issue 番号。例: `252`, `#252`)

## リポジトリ設定の解決 (起動時に 1 回)

implement-issue skill と同じ規則で解決する (`.claude/workflow.json` が明示設定として最優先、無ければ自動導出):

- **repo slug**: `gh repo view --json nameWithOwner -q .nameWithOwner`
- **ベースブランチ** (以下 `<base>`): `baseBranch` → 無ければ `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`
- **trustCI** (既定 `true`): `false` のとき `gh pr checks` を一切判定基準にしない (CI がメンテされていないリポジトリ向け)。true でも**自動 merge はしない** — merge は常に人間の判断
- **ローカルゲート**: 子が implement-issue skill の解決規則に従う (親は関与しない)

**implement-issue SKILL.md のパス解決** (子に Read させるため親が起動時に解決して絶対パスで埋め込む):

1. 対象リポジトリに `.claude/skills/implement-issue/SKILL.md` があればそれ (リポジトリ固有版を優先)
2. 無ければ本 plugin の `skills/implement-issue/SKILL.md` (本 SKILL.md の隣のディレクトリ。場所が不明なら `ls "$(dirname <本SKILL.mdのパス>)/../implement-issue/SKILL.md"` で確認)

## 実行方式の決定: worktree か main checkout か (起動時に 1 回判定)

子の isolation は**原則 `"worktree"`**。ただし worktree 内でローカルゲートが実行できない環境では成立しない。起動時に判定する:

- **worktree が成立する条件**: ゲートのツールチェーン (linter / 静的解析 / テストランナー) がホストにあり worktree 内で動く、または worktree 単体でセットアップ可能
- **成立しない例 (実測)**: PHP ツールチェーンが docker コンテナ内にしか無く、compose がメイン checkout のディレクトリを固定 volume mount している場合 — worktree のコードはコンテナから見えず、テスト・静的解析が一切実行できない
- 成立しない場合は **main checkout 直列実行に切り替える** (isolation なし。直列なので conflict しない)。切り替えたことを最終報告に明記する。子には「main checkout で直接作業。終了前に `git checkout <base>` で戻す」を指示する

## PROGRESS.md との連携 (D11)

- **worktree 子は PROGRESS.md に一切触れない** (作成も更新もしない)。PROGRESS.md は gitignored のため worktree には存在せず、フックも発火しない — この分離は設計であり、崩さない (単一状態ファイルへの並行書き込みは conflict の温床)
- **main checkout 直列で動かす子は例外**: PROGRESS.md が存在するためフック (コミット / PR 作成検知) が発火する。子には「フックの更新要求には素直に従う」を指示する (直列なので競合しない)
- **親 (このセッション) が集約する**: Sub-issue 1 件の完了 (= 1b の検証 OK) ごとに、リポジトリルートに PROGRESS.md が存在すれば「現在地」を上書き (処理中の EPIC / 完了済み子 / 残り子 / 次の一手) し、「ログ」に子の結果 1 エントリ (PR 番号・plan差分・子が報告した想定外) を追記する

## あなた (オーケストレーター親) のタスク

引数の EPIC 番号 `$ARGUMENTS` の Sub-issues のうち **OPEN な子 issue** を、Sub-issues API が返す順 (= 追加順 = 通常は優先度順) で 1 件ずつ子エージェントに委譲し、全 OPEN 子 issue の PR 作成まで直列実行する。

## 成功条件 (全部満たしたら完了)

- [ ] EPIC `#$ARGUMENTS` の OPEN な Sub-issues すべてについて PR が作成済み (`gh pr list` で確認)
- [ ] 各子 issue の PR が OPEN かつローカルゲート pass 済み
- [ ] EPIC issue にサマリコメント (作成 PR 一覧 / merge 待ち) を投稿済み
- [ ] ユーザーへ最終報告 (実装 issue 数 / 全 PR URL リスト / 想定外メモ / merge 待ち PR 一覧) を提示済み

## 動作モデル

### Step 0: 起動時の状態確認

1. EPIC の妥当性確認:
   ```bash
   gh issue view $ARGUMENTS --json number,title,state,labels
   ```
   - `state` が `OPEN` でない / `epic` ラベルが無い場合は、ユーザーに「指定された #$ARGUMENTS は EPIC ではない可能性がある。続行するか」と確認する
2. Sub-issues を取得 (これが作業リスト):
   ```bash
   gh api /repos/<owner>/<repo>/issues/$ARGUMENTS/sub_issues \
     --jq '.[] | {number, title, state}'
   ```
   - **`state == "open"` の子 issue だけ**を、API が返す順 (先頭から) にリスト化する
   - closed の子はスキップ (= 既に対応済み)
   - **OPEN でも、対応する OPEN な PR が既に存在する子はスキップ** (再実行時の二重実装防止): 各 OPEN 子について `gh pr list --state open --search "Closes #<N>" --json number,url` を確認し、該当 PR があれば作業リストから除外して「PR #<M> 作成済み・merge 待ち」として最終報告に含める。issue state だけを見て再委譲すると、merge 待ちの子に重複ブランチ・重複 PR を作ってしまう
3. リストが空 → 「EPIC #$ARGUMENTS の OPEN な Sub-issues は無し (全て対応済 or 子未登録)」と報告して終了
4. 親セッションの git 状態を確認:
   - `git status` (working tree が clean であること。gitignored な PROGRESS.md 等は無視してよい)
   - `git rev-parse --abbrev-ref HEAD` が `<base>` 上にあること
   - dirty / 別ブランチにいる場合はユーザーに「親 cwd を <base> の clean 状態にしてから再実行してください」と報告して終了
5. リポジトリルートに PROGRESS.md があれば「現在地」を上書きしてから開始 (EPIC 番号 / 処理予定の子リスト / 次の一手)

### Step 1: 各 Sub-issue を直列で処理

OPEN 子 issue リストを上から順に取り出して、以下を 1 件ずつ繰り返す:

#### 1a. 子エージェント spawn

`Agent` ツールを以下のパラメタで起動:

- `subagent_type`: `general-purpose`
- `isolation`: `"worktree"` (必須 — 親の cwd を汚さない)
- `description`: `Issue #<N> 実装 + ローカルゲート pass + PR 作成`
- `prompt`: 下記テンプレ (`<N>` = Sub-issue 番号、`<base>` = ベースブランチ、`<SKILL_PATH>` = 親が解決した implement-issue SKILL.md の絶対パス、に置換)

```
あなたはこのリポジトリの実装エージェントです。
GitHub Issue #<N> を end-to-end で実装し、PR 作成 → ローカルゲート pass → レビュー 0 件 → PR 準備完了を完走させて、親に構造化結果を返してください。

## ⚠️⚠️ 絶対遵守の終了条件 ⚠️⚠️

**review 0 件はタスク完了ではありません。** 親への return は**以下 2 条件すべて**を確認した後だけです:

1. `gh pr list --head <branch> --json number,url,state` で PR が **OPEN** 状態で存在すること
2. ローカルゲート (implement-issue SKILL.md の解決規則で決まったもの) が全て pass していること

review が 0 件になったら、**自分のタスクが半分終わっただけ**と認識してください。残り半分 (PR 状態確認 + 自己診断) を必ず実行してから親に return します。

## 禁止事項

- **PROGRESS.md に触れない** (作成も更新もしない。進捗集約は親の仕事)
- /implement-issue や他の slash command を呼ばない (アルゴリズム本体を自分のコンテキストで実行する。二重 spawn 回避)
- merge / issue close をしない
- push / PR 作成が permission で拒否された場合は迂回せず、implement-issue SKILL.md の該当分岐に従って failure を返す

## 実行手順 (順番厳守)

**Phase A — 実装**

1. ベースブランチを最新化:
   git fetch origin <base>
   git checkout <base>
   git pull origin <base>

2. <SKILL_PATH> を Read して、その「リポジトリ設定の解決」「アルゴリズム」「イデンポテント実行手順」セクションに従って Issue #<N> を実装する。
   - 内部ループで最大 10 試行。各試行で状態自己診断 → 次の1歩 → 次の試行
   - リポジトリの CLAUDE.md / .claude/rules/ を必ず読んで従う (規約・Gotcha はそちらが正)
   - PR 本文には `Closes #<N>` を含め、merge 時に Sub-issue が自動 close → EPIC 進捗バーが進むようにする
   - **advisory 指摘は却下可**、ただし件数と内容を子の戻り値に含めて親に報告する
   - 純 docs / コメントのみの PR はレビュー skip 可、scope 外と最終報告に明記
   - **重要**: implement-issue が "success" を返した時点では**自分のタスクは未完了**です。Phase B を続行してください
   - max_attempts に達したら failure を返す

**Phase B — PR 状態確認 + 自己診断 (Phase A 完了後に必ず連続実行)**

3. `gh pr list --head <branch> --json number,url,state,headRefName` で PR を取得。存在しない or CLOSED/MERGED なら failure
4. ローカルゲートの最終確認 (解決済みゲートを全て再実行)。いずれかが失敗したら failure
5. **最終自己診断 (絶対省略禁止、親へ return する直前に必ず実行)**:
   - `gh pr list --head <branch> --json number,url,state` を実 shell 実行 → PR が OPEN であることを目視確認
   - ローカルゲートが pass していることを確認
   - **両方確認できないうちは絶対に親に return しない**

**Phase C — 親への構造化応答 (上記 5 を pass した後にだけ実行)**

6. 親に以下を構造化して返す:
   - status: "success" or "failure"
   - failure の場合は理由 (ローカルゲート失敗内容 / implement-issue が返した failure reason 等)
   - PR 番号と URL (success のとき)
   - 主な変更点 2-3 行
   - implement-issue が消費した試行回数 (attempts)
   - レビュアーごとの指摘件数と採否 (却下した advisory は 1 行で要約)
   - 想定外があれば 1-2 行

ローカルゲート失敗 / max_attempts 到達 / その他停止すべき問題に遭遇したら、即座に親に "failure: <理由>" で返してください。リトライや回避策は子側で行わず、親が判断します。

⚠️ **重要な誤りパターン (実測で複数回発生)**: レビュー (特に /security-review) が return した直後に、そのレポートを自分の最終応答にして停止する / Phase B を skip して「success」を返す。**review skill が return しても、自分のタスクは Phase B 全体が残っています**。レビュー直後は応答を書かずに、必ず次のツール呼び出し (PR コメント投稿 → Phase B の実 shell 確認) を実行すること。
```

#### 1b. 子の戻り値を**親側で検証** (子の success 文字列を信用しない)

⚠️ **繰り返し発生する事故パターン**: 子がレビュー 0 件で return した直後に Phase B (PR 状態確認) を skip して「success」と称して親に return する。**親側で必ず実 shell 検証**する。

子から戻ってきたら、`status` の文字列とは無関係に以下を毎回実行:

1. 子が報告した PR 番号を取得 (報告に無ければ `gh pr list --search "Closes #<N>" --state open --json number,state,url,headRefName`)
2. `gh pr view <PR> --json state,headRefName` を実 shell 実行 → `"state":"OPEN"` を目視確認
3. `trustCI` が true の場合のみ: `gh pr checks <PR>` を確認し、失敗があれば検証 NG として扱う (watch で長時間待たない。pending は NG にしない)
4. **ローカルゲートの客観確認** (子の「ゲート pass」自己申告は証拠にしない):
   - `trustCI` が true で、`gh pr checks <PR>` にローカルゲート相当のジョブ (lint / テスト等) が含まれて全て pass している場合は、それを合格証拠としてよい
   - それ以外は親が PR head をチェックアウトして解決済みゲートを再実行する:
     - worktree モード: `git fetch origin <headRef>` → `git worktree add <一時dir> origin/<headRef>` → 一時 worktree 内でゲート実行 → `git worktree remove <一時dir>`
     - main checkout 直列モード: `gh pr checkout <PR>` → ゲート実行 → `git checkout <base>` で戻す
   - いずれかのゲートが失敗したら検証 NG (PR が OPEN でも success 扱いにしない)

**判定**:

- **検証 OK (PR OPEN かつゲート合格)** → Step 1c へ進む。merge はユーザーが別途行う
- **検証 NG だが PR は存在する (ゲート失敗 or 状態不整合)** → `SendMessage` で子に Phase B 続行を強制:
  - 内容: 「review pass = 完了ではない。Phase B (PR 状態確認 + ローカルゲート最終確認 + 自己診断) を実行し、確認できたら return せよ」
  - 完了通知を受けたら**再度この 1b の検証を実行**
  - **再検証も NG なら、ユーザーに「Issue #<N> で子が Phase B を完走できず手動介入要」と報告して停止** (再度 SendMessage はせず、ループを避ける)
- **検証 NG で PR 不在 or 子が `status: "failure"` を明示** → 親側で停止:
  - EPIC / 子 issue の状態は変更しない (該当 Sub-issue は OPEN のまま残す)
  - ユーザーに「EPIC #$ARGUMENTS を Sub-issue #<N> で停止: <検証結果 + 失敗理由>」+ PR URL (あれば) + 試行回数 + 想定外メモ を報告
  - スキルを終了 (次の Sub-issue に進まない)

#### 1c. 進捗の記録

- 該当 Sub-issue にコメントを投稿して PR を紐づける (推奨):
  ```bash
  gh issue comment <N> --body "PR #<M> 作成済み (ローカルゲート pass / merge 待ち)。"
  ```
- EPIC 本文にチェックボックス形式の子リストがあっても、この時点では **`- [x]` にしない**。PR は未 merge であり、チェックすると未完了の作業が完了扱いに見える (PR が reject / 放置された場合、EPIC が偽の完了状態のまま残る)。チェックが付くのは PR merge → 子 issue close の後で、本スキルの担当外。PR 作成済みであることは前項の issue コメントと Step 2 のサマリで表現する
- リポジトリルートに PROGRESS.md があれば「現在地」を上書きし「ログ」に子の結果 1 エントリを追記 (「PROGRESS.md との連携」参照)
- **Sub-issue を close しない** (PR が merge されていないため)。merge 時に PR 本文の `Closes #<N>` で自動 close され、EPIC 進捗バーが進む

#### 1d. 親の git 状態をリセット

子の worktree は `Agent` 終了時に自動 cleanup されるが、親 cwd の `<base>` ブランチも最新化:

- `git fetch origin <base>`
- `git checkout <base>` (もし違うブランチにいたら)
- `git pull --ff-only origin <base>` (他の PR が merge されていた場合に追従。**`git pull` 単体は稀に「divergent」誤判定で fail することがある** — `git merge --ff-only origin/<base>` で迂回可)
- `git status` で clean を確認

**子の Edit が親 worktree に着地している場合の救済**:
- `git status` に untracked file が出ている → 子の spill-over
- `rm -f <path>` で削除 (`-f` 必須。interactive 確認モードがブロックする可能性あり)
- 親側に `modified:` で出ている tracked file は `git checkout -- <path>` で復旧

#### 1e. 次の Sub-issue へ

Step 1 へ戻る。

### Step 2: 全 OPEN Sub-issue 処理完了 → EPIC へサマリ + 最終報告

OPEN 子 issue リストを処理し切ったら:

1. EPIC issue にサマリコメントを投稿:
   ```bash
   gh issue comment $ARGUMENTS --body "$(cat <<'EOF'
   ## run-epic 実行サマリ (YYYY-MM-DD)

   - 実装 Sub-issue: N 件 (#... 〜 #...)
   - 作成 PR (merge 待ち):
     - #<M1> <URL>  (Closes #<N1>)
     - #<M2> <URL>  (Closes #<N2>)
   - ローカルゲート: 全 PR で pass 済み
   - 想定外メモ: <子から集めた想定外を集約>
   - 次のアクション: 各 PR をレビュー後に手動 merge → Sub-issue が自動 close → EPIC 進捗バーが進む
   EOF
   )"
   ```

2. ユーザーへの最終報告:
   - EPIC #$ARGUMENTS の処理サマリ / 実装 Sub-issue 数
   - 全 PR URL (merge 待ちリスト、対応する `Closes #<N>` 付き)
   - **merge についての案内**: 「各 PR をレビュー後に手動で merge してください。merge すると `Closes #<N>` で Sub-issue が close され、EPIC の進捗バーが自動で進みます」
   - trustCI の扱い (true なら各 PR の checks 状態、false なら「CI 不参照」)
   - 想定外があれば 3〜5 行

## 厳守事項

- **ローカルゲート失敗時は必ず停止**: 子が `failure` を返したら絶対に次の Sub-issue に進まない。ユーザーが介入してから手動で再起動 (`/run-epic $ARGUMENTS` を再実行すれば、未処理 (OPEN かつ PR 未作成) の Sub-issue から再開する)
- **自動 merge / 自動 close は行わない**: merge は人間が判断する。本スキルは PR 作成までを担当
- **子は原則 `isolation: "worktree"`**: 親の cwd を汚さない、作業空間を分離。ただし「実行方式の決定」の判定で worktree が成立しない環境では main checkout 直列に切り替え、最終報告に明記
- **直列のみ**: 並列で複数 Sub-issue を spawn しない (merge conflict 防止)
- **worktree 子は PROGRESS.md に触れない** (D11)。進捗集約は親のみが行う (main checkout 子はフック要求への追従のみ可)
- **EPIC / Sub-issue の close は親が手動でやらない**: PR merge 時の `Closes #<N>` に任せる
- **保護ブランチ直 push 禁止**: 各子は feature ブランチで PR 経由
- **再起動可能性**: スキル途中で停止しても、再実行すれば未処理の Sub-issue から再開する設計 (idempotent)。作業リストは「OPEN な Sub-issue のうち、OPEN な PR をまだ持たないもの」(Step 0 参照)。issue state だけを真とすると merge 待ちの子を二重実装するため、PR の存在まで含めて判定する
- **子は slash command を呼ばない**: implement-issue のアルゴリズムを子自身のコンテキストで実行 (二重 spawn 回避)

## 既知の Gotcha

- `sub_issues` API はプレビュー扱いの時期があった。`gh api /repos/<owner>/<repo>/issues/<EPIC>/sub_issues` が 404/空配列を返す場合は、EPIC に子が紐づいていないか API 未対応の可能性 → ユーザーに確認
- リポジトリ固有の Gotcha は本スキルには書かない。**各リポジトリの CLAUDE.md の管轄** (子が CLAUDE.md を読む)

## 参照ドキュメント (実装中に必要に応じて読む)

- EPIC issue 本文 + 各 Sub-issue 本文 (`gh issue view <N>`)
- 対象リポジトリの CLAUDE.md / `.claude/rules/` (規約・Gotcha)
- implement-issue SKILL.md (実装アルゴリズム本体 — 子が必ず最初に Read。パスは親が解決して子 prompt に埋め込む)

## 起動例

```
/run-epic 252
```

→ EPIC #252 の OPEN な Sub-issues を上から順に直列実行、各 PR を作成して merge 待ちにする。途中で停止した場合は、原因を直してから同じコマンドを再実行すれば、未処理 (OPEN かつ PR 未作成) の Sub-issue から再開する。
