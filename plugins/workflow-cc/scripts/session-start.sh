#!/bin/bash
# SessionStart hook: PROGRESS.md の「現在地」+ ログ直近 3 件をコンテキストに注入する。
# opt-in (D10): リポジトリルートに PROGRESS.md が存在する時だけ動く。無ければ即 exit 0。
# 出力仕様: exit 0 の stdout がそのままコンテキストに追加される。

set -u

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)

CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$CWD" ] || exit 0

ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null) || exit 0
PROGRESS="$ROOT/PROGRESS.md"
[ -f "$PROGRESS" ] || exit 0

# ファイルが空なら何も注入しない (touch 直後の opt-in 状態)
[ -s "$PROGRESS" ] || exit 0

echo "[workflow-cc] ${PROGRESS} の内容 (現在地 + 直近ログ)。作業再開時はまず『次の一手』と整合する初手を打つこと:"
echo ""
# 「### 」エントリの 4 件目以降は注入しない (3 件以下なら全量が出る)
awk 'BEGIN { n = 0 } /^### / { n++; if (n > 3) exit } { print }' "$PROGRESS"

exit 0
