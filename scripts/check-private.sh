#!/usr/bin/env bash
# Blocks a commit that adds personal data. Two layers:
#   1. Staged files that must never be tracked (.env files, the advisor profile, private dirs).
#   2. Added lines matching your own patterns — one case-insensitive extended regex per line,
#      # for comments — e.g. your account last-4s, card names, employer, street, paycheck.
#      Read from ~/.config/personal-finance-tracker/private-patterns (outside the repo, so every
#      clone and worktree is covered with nothing to copy) and from .private-patterns at the repo
#      root (git-ignored) if present; PRIVATE_PATTERNS_FILE overrides the home-directory path.
#
# Runs from .githooks/pre-commit once you `git config core.hooksPath .githooks`
# (npm install does this for you). Bypass for a false positive: git commit --no-verify.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0
blocked='^(\.env($|\.)|config/advisor-profile\.json$|planning/(progress|projects)/|private/|notion_data/|design/|\.setting/|temp/)'
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in .env.example|.env.test.example) continue ;; esac
  if [[ "$f" =~ $blocked ]]; then
    echo "✗ $f holds personal data and must not be committed (git rm --cached \"$f\")"
    fail=1
  fi
done < <(git diff --cached --name-only --diff-filter=ACMR)

home_patterns="${PRIVATE_PATTERNS_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/personal-finance-tracker/private-patterns}"
patterns=$(cat "$home_patterns" .private-patterns 2>/dev/null | grep -vE '^\s*(#|$)' || true)
if [ -n "$patterns" ]; then
  hits=$(git diff --cached -U0 --diff-filter=ACMR -- . ':!package-lock.json' \
    | grep -E '^\+[^+]' | grep -iEf <(printf '%s\n' "$patterns") || true)
  if [ -n "$hits" ]; then
    echo "✗ Staged changes match your private patterns:"
    printf '%s\n' "$hits" | cut -c1-160 | sed 's/^/    /'
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "Commit blocked. Replace real values with illustrative ones (see CLAUDE.md)."
  exit 1
fi
