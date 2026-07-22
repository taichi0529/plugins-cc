# 個人ワークフロー plugin 化 + PROGRESS.md 運用 — 引き継ぎ資料

作成: 2026-07-13 / 作成元セッション: 1D-Exam-DR (Expo SDK 52 アップグレード完了後の設計議論)
想定読者: **別プロジェクトで本設計を実装・テストする Claude Code セッション** (人間 = 太一さん)

---

## 0. この資料の目的と使い方

1D-Exam-DR / 1D-Exam-DH で運用している「複数 issue 一括 + ループ実行」ワークフローを、
(a) **PROGRESS.md による状態永続化 (hook 強制)** と (b) **汎用 skill 群の plugin 化** の 2 本立てで
リポジトリ非依存の個人 plugin に切り出す。本資料はその**確定済み設計の全量**である。

- 設計判断は §2 に集約済み。**蒸し返さずにそのまま実装する** (変更が必要ならユーザーに確認)。
- 実装順は §10 のテスト計画の Phase 順に従う (フック単体 → skill → 並列 → マルチレビュアー)。
- 元になる skill ファイルは DR リポジトリ内にある (§12)。同一マシンなら**読み取り専用で参照可**。
  DR/DH リポジトリのファイルは編集しないこと。

---

## 1. 背景と動機

- ユーザーの運用: `/implement-issue N` (内部ループ・自己診断式) と `/run-epic N` (worktree 並列) で
  複数 issue をまとめて処理する。セッションは長時間化し compaction が頻発する。
- 課題 1: compaction / セッション切断をまたぐと「plan との乖離・失敗アプローチ・次の一手」が失われる。
  進捗の事実 (何をコミットしたか) は git / gh から自己診断で復元できるが、**判断の文脈**は復元できない。
- 課題 2: skills を DR → DH に手作業移植している (docs/hygienist.md が移植指示書)。
  skill のバグ修正のたびに移植メモが増える。plugin 一本化で「修正 1 コミット → 全リポジトリ反映」にしたい。
- 調査結論 (§13 に出典): 「節目で状態をファイルに書き出す」は Anthropic 公式の long-running agents
  ハーネス (claude-progress.txt + セッション終端の commit + progress 更新の義務化) や OpenAI の
  PLANS.md (every stopping point) と同型の確立手法。**最大の失敗モードは staleness** (更新を別チョアに
  すると必ず腐り、エージェントが古いメモを信じる)。対策は「更新をコミット/ターン終端に hook で強制」。

外部から貰った意見 (採用済み・§2 の判断のベース):

> 着手前の plan ファイル (受け入れ条件込み) + issue 完了ごとに PROGRESS.md 追記を Stop hook か
> コミット hook で強制、が最小構成。マージ後の記録は plan と結果の差分が大きかった場合だけで十分。
> 毎回書くと形骸化する。

---

## 2. 確定済み設計判断 (Decision log)

| # | 判断 | 理由 |
|---|---|---|
| D1 | 着手前の plan ファイルは**作らない**。plan と受け入れ条件は GitHub issue 本文が正。複数 issue 一括なら EPIC のチェックボックスが feature list | issue と plan ファイルの二重管理は bit-rot の元 |
| D2 | PROGRESS.md は**リポジトリルート・gitignore** (コミットしない) | PR diff ノイズゼロ・並列 worktree で conflict しない・永続価値のある学びは memory / ADR / issue コメントへ昇格させるので使い捨てでよい |
| D3 | PROGRESS.md は**上書き層 (現在地) + 追記層 (ログ、直近 10 件トリム)** の二層 | 純追記型はコンテキスト圧迫、純上書き型は学びが消える |
| D4 | 更新は**フックで強制** (PostToolUse の commit 検知が主、Stop がバックストップ) | 「更新を別チョアにすると必ず腐る」への構造的対策 |
| D5 | マージ後の記録は**乖離が大きい時だけ**。ADR は実装 PR に同梱が基本。マージ後に気づいた分は memory か issue コメント、ADR 単独 PR は最終手段 | docs-only PR を増やさない (ユーザー明示要望) |
| D6 | plugin に入れるのは**汎用ワークフロー層のみ**: implement-issue / run-epic / create-issue + PROGRESS フック 3 本 | plugin を「モバイル用」でなく「ループ運用そのもの」にし、どのリポジトリでも使えるようにする |
| D7 | **iOS/Android 固有 skill は plugin に入れない** (android-s3-deploy / ios-s3-ota-deploy / deploygate-deploy / eas-production-build は各リポジトリ残留) | ユーザー明示指示 |
| D8 | code-review-project (Gotcha リスト含む) もリポジトリ残留。plugin 版 implement-issue は「リポジトリに project 用 review skill があればそれ、無ければ公式 `/code-review`」のフォールバック式 | Gotcha はリポジトリの実害蓄積そのもの |
| D9 | レビューは**マルチレビュアー対応**: codex / grok が指定されていればそれでもレビューする (§8) | ユーザー明示要望 |
| D10 | フックは**PROGRESS.md がリポジトリルートに存在する時だけ動く** (無ければ即 exit 0)。plugin はグローバル install、有効化は `touch PROGRESS.md` で opt-in | 全リポジトリで無差別発火させない |
| D11 | run-epic の並列 worktree では**子エージェントに PROGRESS.md を触らせない** (gitignored なので worktree に存在しない = D10 により子ではフック不発)。進捗は EPIC issue のチェックボックス + 親セッションの PROGRESS.md に集約 | 単一状態ファイルは並列の merge conflict 温床 |
| D12 | 書いてよいのは **git / issue に無い情報だけ**: plan との乖離・失敗アプローチと理由・ハマりどころ・次の一手。「何を変更したか」は git log にあるので書かない | 重複情報は token の無駄 + staleness 面積の拡大 |

---

## 3. アーキテクチャ全体像

```
┌─ plugin (汎用エンジン層・全リポジトリ共通) ──────────────┐
│ workflow-cc/                                              │
│ ├── .claude-plugin/plugin.json                            │
│ ├── skills/                                               │
│ │   ├── implement-issue/SKILL.md                          │
│ │   ├── run-epic/SKILL.md                                 │
│ │   └── create-issue/SKILL.md (+ templates/)              │
│ ├── hooks/hooks.json          # PROGRESS フック 3 本      │
│ └── scripts/                  # フック実装スクリプト       │
└───────────────────────────────────────────────────────────┘
┌─ 各リポジトリ (固有データ層) ─────────────────────────────┐
│ ├── PROGRESS.md               # touch で opt-in・gitignore │
│ ├── CLAUDE.md / .claude/rules/                            │
│ ├── .claude/workflow.json     # reviewers 等 (§9・任意)    │
│ ├── .claude/skills/           # deploy 系・review 系は残留 │
│ └── (gotchas / DoD データファイル)                         │
└───────────────────────────────────────────────────────────┘
```

---

## 4. PROGRESS.md 仕様

- 置き場所: リポジトリルート。**必ず .gitignore に追加** (テスト対象プロジェクト側で)。
- テンプレート (フックの SessionStart 注入とトリム処理はこの構造を前提にする):

```markdown
# PROGRESS (machine-local / gitignored)

## 現在地 (毎回上書き)
- 作業中: #<issue> <タイトル> / branch <name> / <状態: 実装中|PR作成済|レビュー対応中|...>
- 未完: #A, #B (EPIC #X のチェックボックス参照)
- 次の一手: <1 行>

## ログ (追記・新しい順・直近 10 件でトリム)
### YYYY-MM-DD #<issue> → <PR/結果>
- plan差分: <plan と実装の乖離。無ければ「なし」>
- 失敗: <試して駄目だったアプローチと理由>
- ハマり: <再発しそうな落とし穴>
```

- 運用ルール:
  1. 「現在地」は**常に上書き**。古い現在地を残さない (staleness の元凶)。
  2. ログは 1 issue = 3〜5 行。**直近 10 件を超えた分はフックのスクリプトが機械的に削除**。
  3. 再利用価値のある学びだけを memory / CLAUDE.md に昇格。PROGRESS.md 自体は使い捨て。

---

## 5. フック 3 本の仕様

> ⚠️ hook の入出力スキーマ (stdin JSON のフィールド、`decision: "block"` / `additionalContext` の
> 正確な形式、plugin の hooks.json での `${CLAUDE_PLUGIN_ROOT}` 変数) は実装時に必ず
> **現行の公式 hooks ドキュメントと plugins ドキュメントで検証**すること
> (https://code.claude.com/docs/en/hooks / https://code.claude.com/docs/en/plugins 系)。
> 以下は設計意図と擬似実装であり、フィールド名は当時の理解に基づく。

**共通ガード (3 本すべての先頭)**: stdin JSON の `cwd` から `git rev-parse --show-toplevel` で
リポジトリルートを解決し、`<root>/PROGRESS.md` が存在しなければ **即 exit 0** (D10 の opt-in)。
git リポジトリでない場合も exit 0。

### フック 1: SessionStart — 現在地の自動注入

- 目的: セッション開始・resume・compaction 後に「現在地」を読んだ状態で初手を打たせる。
- 動作: PROGRESS.md の内容 (大きければ「現在地」セクション + ログ先頭 3 件) を additionalContext
  として stdout / JSON 出力で注入する。
- 出力例 (要スキーマ検証): `{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "<PROGRESS.md の内容>"}}`

### フック 2: PostToolUse (matcher: Bash) — コミット検知で更新を強制 (主役)

- 目的: 「issue 完了ごとに更新」を強制する。issue 完了の代理シグナル = `git commit` / `gh pr create`。
- 動作:
  1. stdin JSON の `tool_input.command` に `git commit` または `gh pr create` が含まれるか判定
     (含まれなければ exit 0)。tool_response が失敗 (コミット不成立) なら exit 0。
  2. PROGRESS.md の mtime が直近 (例: 5 分以内) に更新済みなら exit 0 (二重要求防止)。
  3. 未更新なら `{"decision": "block", "reason": "コミットを検知した。PROGRESS.md の『現在地』を上書きし、ログに 3〜5 行 (plan差分/失敗/ハマり) を追記してから続行すること。git に残る情報は書かない"}` を返して Claude に書かせる。
  4. **併せてトリム**: ログの `###` エントリが 10 件を超えていたら古い方から削除して書き戻す
     (この処理はスクリプトが機械的に行う。Claude 任せにしない)。
- 注意: PostToolUse の block はコミットを取り消さない (取り消す必要もない)。あくまで
  「次の行動として更新せよ」というフィードバック強制である。

### フック 3: Stop — バックストップ

- 目的: フック 2 をすり抜けた場合 (commit を伴わない完了、複数コミット後の放置) の保険。
- 動作:
  1. stdin JSON の `stop_hook_active` が true なら **即 exit 0** (無限ループ防止・最重要)。
  2. `git log -1 --format=%ct` (HEAD のコミット時刻) > PROGRESS.md の mtime なら
     `{"decision": "block", "reason": "HEAD が PROGRESS.md より新しい。現在地とログを更新してから終了すること"}`。
  3. それ以外は exit 0。
- 調整前提: このフックが煩い (毎ターン block する) 場合は「HEAD との差が N 分以上の時だけ」等の
  条件緩和をテストで決める (§10 Phase 1 の観察ポイント)。

### hooks.json の配置 (plugin 側)

`hooks/hooks.json` に SessionStart / PostToolUse (matcher: Bash) / Stop の 3 エントリを定義し、
command は `${CLAUDE_PLUGIN_ROOT}/scripts/<name>.sh` (または .py) を指す。

---

## 6. plugin 構造と登録

- plugin 名: `workflow-cc` (plugins-cc マーケットプレイスへの移設時に確定)。
- 構成: §3 の図の通り。`.claude-plugin/plugin.json` に name / description / version。
- 開発中の登録: ローカル path の marketplace 登録 (`/plugin marketplace add <ローカルパス>` 系) を使い、
  再インストールなしで反復できる形にする。正確なコマンドは現行 plugins ドキュメントで確認。
- 既知の罠: plugin 更新でユーザーのローカル修正が巻き戻された前科がある (DeployGate plugin の
  .mcp.json 上書き)。**自作 plugin では「install 後にユーザーが直す」構造を作らない** —
  リポジトリ固有値は必ずリポジトリ側ファイル (§9) から読む。

---

## 7. skills 汎用化仕様

元ファイル: DR リポジトリの `.claude/skills/{implement-issue,run-epic,create-issue}/SKILL.md` (§12)。
**コピーして持ってくるが、以下の改修を必ず行う**:

### 7.1 全 skill 共通 (脱ハードコード)

- repo slug (`1d-dev/1D-Exam-DR`) → `gh repo view --json nameWithOwner` か `git remote get-url origin` から導出。
- ベースブランチ (`dev`) → `gh repo view --json defaultBranchRef` を既定とし、`.claude/workflow.json` の
  `baseBranch` があればそちらを優先 (DR/DH は default が dev でない可能性があるため)。
- ローカルゲート (`npm run type-check` / `npm run lint`) → package.json の scripts から存在するものを
  実行 (`type-check`, `lint`, `test` を探す)。無ければ `.claude/workflow.json` の `gates` 配列。
  どちらも無ければ「ゲート無し」と最終報告に明記して続行。
- 「CI は信頼しない」ポリシー → DR 固有の事情なので **workflow.json の `trustCI: false` (既定 true)** に
  設定化。false のときのみ現行の「gh pr checks を見ない」挙動。
- **掃除対象 (DR 版からコピーする際に削除する古い記述)**: `patches/` (patch-package) への言及、
  SDK 51 / Xcode 26 不整合の Gotcha、`Co-Authored-By: Claude Opus 4.7` 固定行 (現行モデル名に
  するか設定化)、`useAppleAuth` 等 DR 固有の死にコード Gotcha。これらはリポジトリ側 CLAUDE.md の
  管轄であり plugin に持ち込まない。

### 7.2 implement-issue

- ループアルゴリズム (最大 10 試行・自己診断式・成功条件・戻り値形式) は**現行のまま維持**。
- Step 0 に 1 行追加: 「PROGRESS.md が存在すれば『現在地』を更新してから着手」。
- Step 5 (レビュー) を §8 のマルチレビュアー仕様に差し替え。
- Step 5 の review skill 参照をフォールバック式に (D8): `.claude/skills/` に project 用 review skill
  (命名は `code-review-project` を慣例とする) があればそれ、無ければ公式 `/code-review`。

### 7.3 run-epic

- 子エージェント (worktree) への指示に「PROGRESS.md には触れない」を明記 (D11)。
- 親セッションが Sub-issue 完了ごとに EPIC issue のチェックボックスと自分の PROGRESS.md を更新。

### 7.4 create-issue

- テンプレート骨格 (feature/bug/refactor/chore/epic/task、AC の Given/When/Then、Sub-issues API 手順)
  は汎用なので plugin に同梱。
- **DoD はリポジトリ側データ**: `.claude/workflow.json` の `dodFiles` (パス配列) か、慣例パス
  (`.claude/dod/*.md`) を読む。無ければ DoD セクションを省略して起票。
  DR の `dod/mobile.md` 相当はモバイルリポジトリ側にのみ置く。

---

## 8. マルチレビュアー仕様 (implement-issue Step 5 改訂)

### レビュアーの解決 (優先順)

1. 起動引数で明示: `/implement-issue 42 review=codex,grok` (自然言語指定も可: 「codexでもレビューして」)
2. リポジトリ設定: `.claude/workflow.json` の `reviewers` 配列 (例: `["project", "codex"]`)
3. 既定: `["project"]` (= project 用 review skill、無ければ公式 `/code-review`)

### 実行

- 指定された全レビュアーを**同一ターンで並列実行**:
  - `project` → リポジトリの review skill (フォールバック: 公式 `/code-review`)
  - `codex` → `Agent(subagent_type: "codex:codex-rescue")`
  - `grok` → `Agent(subagent_type: "grok-cc:grok-rescue")`
- **外部レビュアーには GitHub を参照させない** (実績のある罠: Codex 実行環境から GitHub API に
  接続できず issue 本文を取得できなかった)。prompt に**ローカル repo パス + ブランチ名 +
  ベースブランチ + issue 本文全文を直接埋め込む**。diff はローカル git で取らせる。
- **可用性フォールバック**: 指定された agent type が環境に存在しなければ、停止せず
  「<name> は利用不可、残りで続行」として最終報告に明記。

### 採否判定とゲート

- codex / grok の指摘には confidence スコアが無いので、**Claude が 1 件ずつトリアージ**して
  「採用 (must-fix 扱い) / 却下 (理由必須)」に振り分ける。
- 成功条件を拡張: 従来の「project レビューの must-fix (≥80) = 0 かつ security HIGH/MEDIUM = 0」に
  加えて「**外部レビュアー指摘のうち採用した分の未対応 = 0**」。
- 却下した指摘は理由ごと PR コメントと最終報告に残す (人間が後から判定を検証できるように)。
- 最終報告のフォーマット例: `codex: 3件 (採用1・却下2) / grok: 利用不可 / project: must-fix 0・advisory 2`

---

## 9. リポジトリ側契約: `.claude/workflow.json` (すべて任意)

```json
{
  "baseBranch": "dev",
  "gates": ["npm run type-check", "npm run lint"],
  "trustCI": false,
  "reviewers": ["project", "codex"],
  "dodFiles": [".claude/dod/common.md", ".claude/dod/mobile.md"]
}
```

- ファイルが無い場合はすべて自動導出 + 既定値 (§7.1) で動く。**plugin はこのファイルが無くても壊れない**こと。

---

## 10. テスト計画 (別プロジェクトでの検証手順)

テスト対象プロジェクトの条件: git リポジトリ・GitHub にリモートあり・issue が切れる・
壊れても困らないこと。本番リポジトリ (1D-Exam-DR / DH) では**テストしない**。

### Phase 1: フック単体

1. plugin 雛形 (hooks のみ) を作りローカル marketplace 登録。
2. 対象リポジトリで `touch PROGRESS.md` + .gitignore 追記。
3. 検証項目:
   - [ ] PROGRESS.md が無いリポジトリではフックが何もしない (opt-in)
   - [ ] SessionStart で現在地が注入される (新セッション/resume/compaction 後)
   - [ ] `git commit` 直後に更新要求が来る。更新したら再要求されない (mtime ガード)
   - [ ] Stop バックストップが効く。かつ **stop_hook_active ガードで無限ループしない**
   - [ ] ログ 11 件目でトリムが走る
   - 観察: block の頻度が煩くないか (煩ければ条件緩和して再測)

### Phase 2: implement-issue 単体

1. 汎用化した implement-issue を plugin に追加。
2. 対象リポジトリで小さい issue を 1 本立てて `/implement-issue N` を end-to-end。
3. 検証項目:
   - [ ] repo slug / ベースブランチ / ゲートが自動導出される (workflow.json 無しで動く)
   - [ ] review skill フォールバック (project skill が無い環境で公式 `/code-review` に落ちる)
   - [ ] PROGRESS.md の現在地更新が Step 0 とコミット時に行われる

### Phase 3: run-epic + 並列

1. Sub-issue 2〜3 本の小さな EPIC で `/run-epic N`。
2. 検証項目:
   - [ ] worktree 子が PROGRESS.md に触らない / 子側でフックが発火しない
   - [ ] EPIC チェックボックスと親 PROGRESS.md が Sub-issue 完了ごとに更新される

### Phase 4: マルチレビュアー

1. `review=codex,grok` 指定で Phase 2 相当を再実行。
2. 検証項目:
   - [ ] codex / grok が並列で走り、ローカルコンテキスト直渡しで GitHub 非依存
   - [ ] トリアージ (採用/却下+理由) が PR コメントと最終報告に残る
   - [ ] plugin 未導入環境相当で「利用不可・続行」フォールバックが動く

### 全体の受け入れ条件

- compaction を 1 回以上またいだセッションで、再開直後の initial action が PROGRESS.md の
  「次の一手」と整合していること (= 本設計の存在意義の実証)。
- PROGRESS.md が 1 週間相当の運用で肥大化しない (トリムが機能)。

---

## 11. 既知の罠・注意

- **hook スキーマは必ず現行ドキュメントで検証** (§5 冒頭)。フィールド名の思い込み実装をしない。
- Stop hook の無限ループ (`stop_hook_active` ガード必須)。
- PostToolUse の判定は `tool_input.command` の文字列 grep なので、`git commit` を含む
  echo やコメントで誤発火し得る。実害は「余計な更新要求 1 回」なので許容し、複雑化させない。
- 外部レビュアー (codex) は GitHub に届かないことがある → ローカル直渡し (§8)。
- plugin 更新でリポジトリ側のユーザー修正を上書きする構造を作らない (§6)。
- 並列 worktree と単一状態ファイルは相性最悪 → D11 の分離を崩さない。
- 調査で報告された最重要教訓: **staleness**。「現在地の上書き」「hook 強制」「トリム」の
  3 点はどれも staleness 対策であり、実装の都合で外さない。

---

## 12. 参照元ファイル (DR リポジトリ・読み取り専用)

| パス | 用途 |
|---|---|
| `/Users/taichi/work/1d/1D-Exam-DR/.claude/skills/implement-issue/SKILL.md` | ループアルゴリズムの原本 (§7.1 の掃除対象を除去して汎用化) |
| `/Users/taichi/work/1d/1D-Exam-DR/.claude/skills/run-epic/SKILL.md` | EPIC 分解・worktree 並列の原本 |
| `/Users/taichi/work/1d/1D-Exam-DR/.claude/skills/create-issue/SKILL.md` (+ `templates/`, `dod/`) | 起票フローの原本。dod/ はリポジトリ側データ化 |
| `/Users/taichi/work/1d/1D-Exam-DR/.claude/skills/code-review-project/SKILL.md` | plugin には入れない。フォールバック仕様 (D8) の参照用 |
| `/Users/taichi/work/1d/1D-Exam-DR/docs/hygienist.md` | 「機械実行可能な引き継ぎ資料」の先行例 (書式の参考) |

---

## 13. 調査ソース (設計根拠)

- Anthropic — Effective harnesses for long-running agents (claude-progress.txt / セッション終端の commit+progress 義務化): https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic — Effective context engineering for AI agents (structured note-taking / NOTES.md): https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Claude Code docs — best practices / memory / hooks / plugins: https://code.claude.com/docs/en/
- OpenAI Cookbook — PLANS.md (every stopping point / ExecPlan だけから再開可能に): https://developers.openai.com/cookbook/articles/codex_exec_plans
- Ralph Wiggum loop (Geoff Huntley、@fix_plan.md をコミット直前に更新): https://ghuntley.com/ralph/
- beads (Steve Yegge、「Markdown プランは write-only メモリで即 bit-rot」批判): https://github.com/steveyegge/beads
- Cline Memory Bank (activeContext.md の staleness 実害報告): https://docs.cline.bot/best-practices/memory-bank
- Harper Reed — todo.md 運用: https://harper.blog/2025/02/16/my-llm-codegen-workflow-atm/
- ushironoko — HANDOVER.md + SessionStart hook (肥大化の自己申告あり): https://zenn.dev/ushironoko/articles/6b905435f3afe8
- Peter Steinberger — 反対派 (「状態は git と会話で持つ」): https://steipete.me/posts/just-talk-to-it
