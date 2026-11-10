#!/usr/bin/env bash
# Blocks a commit that adds personal data. Two layers:
#   1. Staged files that must never be tracked (.env files, the advisor profile, private dirs).
#   2. Added lines matching your own patterns — one case-insensitive extended regex per line,
#      # for comments — e.g. your account last-4s, card names, employer, street, paycheck.
#      Read from ~/.config/personal-finance-tracker/private-patterns (outside the repo, so every
#      clone and worktree is covered with nothing to copy) and from .private-patterns at the repo
#      root (git-ignored) if present; PRIVATE_PATTERNS_FILE overrides the home-directory path.
#      A line starting with ! is an exception: text matching that (case-sensitive) regex is
#      removed from each added line before the patterns are checked, so one known-public value
#      can be allowed without loosening a broad pattern — e.g. `!demo\.example\.com` beside
#      `example\.com`. Anything else private on the same line is still caught.
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
all_patterns=$(cat "$home_patterns" .private-patterns 2>/dev/null | grep -vE '^\s*(#|$)' || true)
patterns=$(printf '%s\n' "$all_patterns" | grep -vE '^!' || true)
allowed=$(printf '%s\n' "$all_patterns" | grep -E '^!.' | cut -c2- || true)
if [ -n "$patterns" ]; then
  added=$(git diff --cached -U0 --diff-filter=ACMR -- . ':!package-lock.json' | grep -E '^\+[^+]' || true)
  # Blank out the allowed values (one output line per input line, so numbers still line up).
  checked="$added"
  d=$'\001'
  while IFS= read -r a; do
    [ -z "$a" ] && continue
    checked=$(printf '%s\n' "$checked" | sed -E "s${d}${a}${d}${d}g")
  done <<< "$allowed"
  hit_lines=$(printf '%s\n' "$checked" | grep -niEf <(printf '%s\n' "$patterns") | cut -d: -f1 || true)
  if [ -n "$hit_lines" ]; then
    echo "✗ Staged changes match your private patterns:"
    printf '%s\n' "$added" | awk 'NR==FNR { want[$1]; next } FNR in want' <(printf '%s\n' "$hit_lines") - \
      | cut -c1-160 | sed 's/^/    /'
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "Commit blocked. Replace real values with illustrative ones (see CLAUDE.md)."
  exit 1
fi
