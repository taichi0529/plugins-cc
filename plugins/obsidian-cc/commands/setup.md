---
description: Obsidian vault の設定 (~/.claude/obsidian-cc.json) を作成・検証する
argument-hint: '[vault リポジトリの絶対パス]'
---

# obsidian-cc セットアップ

## 現在の設定

```!
"${CLAUDE_PLUGIN_ROOT}"/scripts/obsidian-cc.sh check || true
```

- ユーザーが指定したパス: $ARGUMENTS

> 上の `|| true` は消さないこと。未設定時 `check` は exit 1 を返すが、`!` 展開は非ゼロ終了を「Shell command failed」としてコマンド全体を止めるため、**セットアップが必要な状況でこのコマンド自体が起動しなくなる**。

---

## 手順

上の出力の 1 行目 (`STATUS:`) で分岐する。ヘルパーは `"${CLAUDE_PLUGIN_ROOT}"/scripts/obsidian-cc.sh` の各サブコマンド (`check` / `write` / `allow-git`) を `Bash` で呼ぶ。**設定ファイルを自分で直接書かない** — 必ず `write` を通す（検証がそこに入っている）。

### STATUS: ok の場合

設定内容を表で提示して終わる。ただし `$ARGUMENTS` にパスが渡されている場合は、まず下の「1. repoRoot を決める」と同じ方法（`rev-parse --show-toplevel`）で git ルートに解決してから、現在の `repoRoot` と比べる。**解決後の値が違う場合だけ** `AskUserQuestion` で「その値に作り直すか」を 1 回確認し、承認されたら「設定の作成」を `--force` 付きで実行する。渡されたパスが現在の `vaultDir` や `repoRoot` の配下を指しているだけなら、設定は既に正しいので作り直さない。

あわせて `gitAllowRule` が `~/.claude/settings.json` に入っているかを確認する（`check` の出力にある `gitAllowRule` の文字列を `~/.claude/settings.json` から探す）。無ければ「設定の作成」の手順 4 と同じ確認を取る。

### STATUS: unconfigured / invalid の場合

以下を順に進める。

#### 1. repoRoot を決める

`repoRoot` は **Obsidian vault を管理している git リポジトリのルート**。

- `$ARGUMENTS` にパスが渡されている場合、**それをそのまま `repoRoot` にしない**。ユーザーは vault ディレクトリ（repoRoot のサブディレクトリ）を渡してくることが多い。必ずそこから git ルートを求める:

```bash
git -C <渡されたパス> rev-parse --show-toplevel
```

  この出力が `repoRoot`。渡されたパスがそれと異なる場合、渡されたパスは `vaultDir` の候補として使う。出力が空（git 管理下でない）なら、その旨を伝えて下の探索に進む

- 渡されていなければ vault を探す:

```bash
find "$HOME" -maxdepth 4 -type d -name .obsidian -not -path "*/node_modules/*" 2>/dev/null
```

見つかった `.obsidian` の親ディレクトリが vault。そこから git リポジトリルートを求める:

```bash
git -C <vault の親ディレクトリ> rev-parse --show-toplevel
```

候補が複数あれば `AskUserQuestion` で 1 回だけ選ばせる（候補を選択肢に並べ、パスを description に出す）。候補が 0 件なら、vault リポジトリの絶対パスを尋ねる。git 管理下にない vault はこのスキルでは扱えないので、その場合は「先に `git init` して remote を設定してほしい」と伝えて終了する。

#### 2. vaultDir / remote / branch を決める

- `vaultDir` = `.obsidian` があったディレクトリ（デイリーノートとプロジェクトノートの置き場）。repoRoot と同じならそのまま repoRoot を使う。**repoRoot 配下である必要がある**
- `remote` = `git -C <repoRoot> remote` の 1 つ目（無ければ `origin`）
- `branch` = `git -C <repoRoot> symbolic-ref --short HEAD`（取れなければ `main`）
- `projectTag` = 既定の `project`。vault 側でプロジェクトノートに別の tag を使っている場合のみ変える

#### 3. 設定の作成

```bash
"${CLAUDE_PLUGIN_ROOT}"/scripts/obsidian-cc.sh write \
  --repo-root <repoRoot> \
  --vault-dir <vaultDir> \
  --remote <remote> \
  --branch <branch> \
  --project-tag <projectTag>
```

- `STATUS: written` なら成功
- `STATUS: exists` は既存ファイルがあるということ。上書きの可否を `AskUserQuestion` で確認してから `--force` を付けて再実行する
- `STATUS: invalid` なら問題点をそのままユーザーに見せて、直せるものは直して再実行する（勝手にパスを推測して何度も試さない）

#### 4. git 許可ルールの追加（任意・要確認）

`daily-report` skill は `git -C <repoRoot> ...` しか実行しないので、そのパスに限定した許可ルールを `~/.claude/settings.json` に入れておくと毎回の承認が不要になる。

`AskUserQuestion` で **1 回だけ** 確認する。

- 質問: 「`~/.claude/settings.json` に `Bash(git -C <repoRoot>:*)` を追加する?」
- 選択肢 1（推奨）: `追加する (Recommended)` — 日報のたびに git の許可を求められなくなる。許可範囲はこの vault リポジトリのみ
- 選択肢 2: `追加しない` — 実行のたびに手動で承認する

承認されたときだけ実行する:

```bash
"${CLAUDE_PLUGIN_ROOT}"/scripts/obsidian-cc.sh allow-git
```

`STATUS: added` なら成功（`~/.claude/settings.json.obsidian-cc.bak` にバックアップを取っている）。`STATUS: already` なら既に入っていたということで、何もしなくてよい。

#### 5. 最終確認

```bash
"${CLAUDE_PLUGIN_ROOT}"/scripts/obsidian-cc.sh check
```

`STATUS: ok` を確認して、次の内容を報告する。

- 書き込んだ設定（repoRoot / vaultDir / remote / branch / projectTag）
- git 許可ルールを追加したかどうか
- 使い方: `/obsidian-cc:daily-report [補足]` で今日の日報を記録できること

---

## 出力ルール

- 設定ファイルのパスと中身は必ずユーザーに見せる
- 失敗した項目は握り潰さず、ヘルパーの出力をそのまま伝える
- `~/.claude/settings.json` は手順 4 で承認されたときにしか触らない
