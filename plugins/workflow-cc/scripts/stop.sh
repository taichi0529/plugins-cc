#!/bin/bash
# Stop hook: バックストップ。PostToolUse フックをすり抜けた場合の保険。
# opt-in (D10): リポジトリルートに PROGRESS.md が存在する時だけ動く。
#
# 動作:
#   1. stop_hook_active が true なら即 exit 0 (無限ループ防止・最重要)
#   2. HEAD のコミット時刻 > PROGRESS.md の mtime なら block
#   3. それ以外は exit 0
#
# 煩すぎる場合の条件緩和 (「HEAD との差が N 分以上の時だけ」等) は
# Phase 1 の観察結果で決める (§10)。

set -u

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)

# 無限ループ防止ガード — 何よりも先に評価する
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
[ "$ACTIVE" = "true" ] && exit 0

CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$CWD" ] || exit 0

ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null) || exit 0
PROGRESS="$ROOT/PROGRESS.md"
[ -f "$PROGRESS" ] || exit 0

HEAD_TS=$(git -C "$ROOT" log -1 --format=%ct 2>/dev/null)
[ -n "$HEAD_TS" ] || exit 0

file_mtime() {
  stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null
}
MTIME=$(file_mtime "$PROGRESS")
[ -n "$MTIME" ] || exit 0

if [ "$HEAD_TS" -gt "$MTIME" ]; then
  REASON="HEAD のコミットが ${PROGRESS} より新しい。『現在地』の上書きと『ログ』への追記 (plan差分 / 失敗 / ハマり、3〜5 行) を済ませてから終了すること。"
  jq -n --arg r "$REASON" '{ decision: "block", reason: $r }'
  exit 0
fi

exit 0
