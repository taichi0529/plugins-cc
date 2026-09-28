#!/bin/bash
# pre-commit から呼ぶ check-versions.sh のラッパー。
# - 対象ファイル (marketplace.json / plugins/*/.claude-plugin/plugin.json) の変更が
#   ステージに無ければ何もしない。pre-commit の files: は削除を拾わないので、
#   削除も含めてここで判定する (always_run: true で呼ばれる前提)
# - 検査はステージ内容 (index) を展開した一時ディレクトリで行う。作業ツリーの
#   untracked ファイルが結果に混ざらないようにするため

set -u

git diff --cached --name-only \
  | grep -qE '^(\.claude-plugin/marketplace\.json|plugins/[^/]+/\.claude-plugin/plugin\.json)$' \
  || exit 0

snapshot=$(mktemp -d) || exit 2
trap 'rm -rf "$snapshot"' EXIT

git checkout-index -a --prefix="$snapshot/" || exit 2
bash "$snapshot/scripts/check-versions.sh"
