#!/bin/bash
# plugins/<name>/.claude-plugin/plugin.json と .claude-plugin/marketplace.json の
# version が全プラグインで一致しているかを検査する。
#   exit 0: 全一致 / exit 1: 不一致・片側欠落あり / exit 2: 実行環境の問題 (jq 無し等)

set -u

command -v jq >/dev/null 2>&1 || { echo "jq が見つからない (brew install jq)" >&2; exit 2; }

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MARKETPLACE="$ROOT/.claude-plugin/marketplace.json"
[ -f "$MARKETPLACE" ] || { echo "marketplace.json が無い: $MARKETPLACE" >&2; exit 2; }

ENTRIES=$(jq -r '.plugins[] | [.name, .source, .version // ""] | @tsv' "$MARKETPLACE" 2>/dev/null) \
  || { echo "marketplace.json を JSON として読めない: $MARKETPLACE" >&2; exit 2; }

status=0
listed=""

while IFS=$'\t' read -r name source mversion; do
  [ -n "$name" ] || continue
  rel=${source#./}
  listed="$listed $rel"
  manifest="$ROOT/$rel/.claude-plugin/plugin.json"
  if [ ! -f "$manifest" ]; then
    echo "NG  $name: marketplace.json にあるが plugin.json が無い ($rel/.claude-plugin/plugin.json)" >&2
    status=1
    continue
  fi
  pversion=$(jq -r '.version // ""' "$manifest" 2>/dev/null) \
    || { echo "NG  $name: plugin.json を JSON として読めない" >&2; status=1; continue; }
  if [ -z "$mversion" ] || [ "$mversion" != "$pversion" ]; then
    echo "NG  $name: marketplace.json=${mversion:-<なし>} plugin.json=${pversion:-<なし>}" >&2
    status=1
  else
    echo "OK  $name $pversion"
  fi
done <<< "$ENTRIES"

# plugins/ にあるのに marketplace.json に載っていないプラグイン
for manifest in "$ROOT"/plugins/*/.claude-plugin/plugin.json; do
  [ -f "$manifest" ] || continue
  dir=${manifest#"$ROOT"/plugins/}
  dir=${dir%%/*}
  case " $listed " in
    *" plugins/$dir "*) ;;
    *) echo "NG  $dir: plugins/$dir/.claude-plugin/plugin.json があるが marketplace.json に無い" >&2; status=1 ;;
  esac
done

exit $status
