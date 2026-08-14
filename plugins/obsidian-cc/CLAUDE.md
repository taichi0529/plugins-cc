# CLAUDE.md — obsidian-cc

`plugins/obsidian-cc/` で作業するときのガイド。マーケットプレイス全体の規約はルートの `CLAUDE.md` を参照。以下のパスはこのプラグインディレクトリからの相対。

## プラグイン概要

Claude Code のセッションでやった作業を Obsidian vault のデイリーノートに日報として書き、commit / push する plugin。元は user レベルの `~/.claude/skills/daily_report/` にあったものを、vault パスのハードコードを設定ファイルに追い出して plugin 化した。

3 つの部品しかない。

| ファイル | 役割 |
|---|---|
| `skills/daily-report/SKILL.md` | 日報の手順書。**判断はここ (本体セッション)、書き込みはサブエージェント** |
| `commands/setup.md` | `/obsidian-cc:setup`。設定ファイルの作成・検証の手順書 |
| `scripts/obsidian-cc.sh` | 設定の検証・書き込みと実行時コンテキスト収集。bash + git + jq のみ |

ビルド・テストランナーは無い。検証は `bash -n` と、ダミー vault リポジトリを作ってヘルパーを直接叩く方式。

## 設計上の不変条件

**この 4 つを壊す変更はしない。**

1. **git コマンドは必ず `-C <repoRoot>`**。このスキルは他プロジェクトのセッションから呼ばれるので、`-C` を落とすと無関係なリポジトリにコミットする。`cd` してからの実行も禁止。skill の `allowed-tools` を `Bash(git -C:*)` にしているのは、`-C` の無い git コマンドを構造的に弾くため — ここを `Bash(git:*)` などに緩めない
2. **設定は `scripts/obsidian-cc.sh` 経由でしか触らない**。skill / command が `~/.claude/obsidian-cc.json` を直接書くと検証を迂回する
3. **`vaultDir` は `repoRoot` 配下**。外だと commit 対象にならないので、検証で落とす
4. **書き込み前に `AskUserQuestion` で 1 回だけ確認**。これが唯一の歯止め。承認前にファイルを触らない
5. **`!` によるコマンド展開から呼ぶものは、絶対に非ゼロ終了させない**。Claude Code は非ゼロ終了を「Shell command failed」として扱い、**プロンプトの組み立て自体を中断する** — つまり手順書に一歩も進めない。`context` が常に exit 0 なのはこのため。`commands/setup.md` は終了コードに意味を持つ `check` を呼ぶので `|| true` で吸収している (v0.2.1 で修正。未設定時に setup コマンドが起動しないバグだった)。この 2 箇所のどちらも緩めないこと
6. **最新化は fast-forward 限定** (`do_pull`)。vault は人間が Obsidian から直接編集し、別マシンからも push される。`merge` や `rebase` に踏み込むと、失敗時にユーザーの vault を中途半端な状態で放置することになる。ff できないなら**何もせず理由を返す**のが正しい

## ヘルパーの契約 (`scripts/obsidian-cc.sh`)

サブコマンドは `check` / `context` / `env` / `write` / `allow-git` / `path`。

- **出力の 1 行目は必ず `STATUS: <値>`** (`ok` / `unconfigured` / `invalid` / `written` / `exists` / `already` / `added` / `error` / `usage-error`)。skill と command はこの行で分岐する。値を増減するときは両方の手順書を直す
- **`context` は常に exit 0**。skill 本文の `!` によるコマンド展開ブロックから呼ばれるので、失敗しても展開自体は成功させ、`STATUS:` で異常を伝える。それ以外のサブコマンドは 0=正常 / 1=設定不備 / 2=使い方の誤り
- **`context` の副作用は `--pull` を渡したときだけ**。skill は `context --pull` で呼び、`setup` からは呼ばない。`--pull` 無しの `context` は読み取りのみ (`pull: skipped (--pull 未指定)`) — テストや診断で状態を変えずに覗けるようにするため、この既定は変えない
- **`do_pull` の出力は 1 行の `pull: <結果>`**。値は `up-to-date` / `fast-forwarded` / `skipped (理由)` / `failed (理由)`。SKILL.md の手順 0 がこの 4 種で分岐するので、増減させるときは手順書も直す。ff できない理由は `rev-list --count` の ahead / behind から判定している (両方 > 0 なら分岐、behind のみなら未コミット変更との衝突)
- **bash 3.2 互換** (macOS 標準の `/bin/bash` が 3.2)。配列は使わない — 検証結果は改行区切りの文字列 `PROBLEMS` に貯めている。`set -e` も使わない (診断で失敗コマンドの結果を読むため)
- `write` は検証に通らなければ**書かない**。既存ファイルがあれば `--force` が無い限り `STATUS: exists` で止まる
- `allow-git` は `~/.claude/settings.json` を書き換える唯一の箇所。必ずバックアップ (`.obsidian-cc.bak`) を取り、既に同じルールがあれば `STATUS: already` で何もしない。**command 側で承認を取ってからしか呼ばない**
- 設定パスは `$OBSIDIAN_CC_CONFIG`、settings パスは `$OBSIDIAN_CC_SETTINGS` で差し替えられる (テスト用)

### プロジェクトノートの判定

`context` は `vaultDir` 直下の `*.md` から、frontmatter の tags に `projectTag` を持つノートを列挙する。awk で **frontmatter の範囲だけ**を見ているので、本文中の `- project` という行では誤検出しない。list 記法 (`- project`) とインライン記法 (`tags: [project, wip]`) の両方に対応。

## 検証手順

```bash
bash -n scripts/obsidian-cc.sh

# ダミー vault で一通り叩く (bare remote を作って remote/branch 検証まで通す)
tmp=$(mktemp -d)
git init -q --bare "$tmp/remote.git"
git init -q -b main "$tmp/vault"
git -C "$tmp/vault" remote add origin "$tmp/remote.git"
mkdir -p "$tmp/vault/notes"
printf -- '---\ntags:\n  - project\n---\n' > "$tmp/vault/notes/Foo.md"
git -C "$tmp/vault" add -A
git -C "$tmp/vault" -c user.email=t@e -c user.name=t commit -qm init

export OBSIDIAN_CC_CONFIG="$tmp/config.json"
export OBSIDIAN_CC_SETTINGS="$tmp/settings.json"
scripts/obsidian-cc.sh check      # → STATUS: unconfigured
scripts/obsidian-cc.sh write --repo-root "$tmp/vault" --vault-dir "$tmp/vault/notes"
scripts/obsidian-cc.sh context    # → STATUS: ok / Foo が列挙される
```

異常系も確認すること: repoRoot が git repo でない / vaultDir が repoRoot の外 / remote・branch が無い / 壊れた JSON / `projectTag` に空白。いずれも `write` が書かずに `STATUS: invalid` で止まること。

**設定ファイルが無い状態での終了コードは必ず確認する**（v0.2.1 の回帰テスト）。手順書に埋め込まれている形のまま叩いて、`rc=0` になること:

```bash
export OBSIDIAN_CC_CONFIG=/tmp/does-not-exist.json
scripts/obsidian-cc.sh check || true          # → STATUS: unconfigured / rc=0
scripts/obsidian-cc.sh context --pull || true # → STATUS: unconfigured / rc=0
```

`|| true` を外すと `check` は rc=1 を返し、`!` 展開が「Shell command failed」でコマンドごと落ちる。

## 注意

- skill の名前は `daily-report` (元の `daily_report` からハイフンに変更)。呼び出しは `/obsidian-cc:daily-report`
- `disable-model-invocation: true` を付けてある。日報は明示的に呼ぶものなので、モデルの自動判断で走らせない
- バージョンを上げるときは `.claude-plugin/plugin.json` とルートの `.claude-plugin/marketplace.json` の obsidian-cc エントリを**両方**同じ値にする
