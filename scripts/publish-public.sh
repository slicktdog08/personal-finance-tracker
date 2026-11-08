#!/usr/bin/env bash
# Publish the current tree to the public repo as one commit on top of its main.
#
# The private repo's history still holds personal data from before the split, so the two
# repos never share commits: this takes HEAD's *tree* (which is public-safe — check-private.sh
# guards every commit) and commits it onto the public main, then pushes that. Nothing from the
# private history is reachable from the pushed commit.
#
# Usage: scripts/publish-public.sh ["commit message"]
#   PUBLIC_REMOTE overrides the target (default: the `public` remote).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

remote="${PUBLIC_REMOTE:-public}"
msg="${1:-Sync with the private deployment ($(git rev-parse --short HEAD))}"

git diff --quiet && git diff --cached --quiet || { echo "Commit or stash your changes first." >&2; exit 1; }

# Re-check the whole tree against .private-patterns, not just the last diff.
if [ -f .private-patterns ]; then
  patterns=$(grep -vE '^\s*(#|$)' .private-patterns || true)
  if [ -n "$patterns" ]; then
    hits=$(git grep -n -i -E -f <(printf '%s\n' "$patterns") HEAD -- . ':!package-lock.json' ':!README.md' || true)
    if [ -n "$hits" ]; then
      echo "✗ The tree still matches .private-patterns:" >&2
      printf '%s\n' "$hits" | cut -c1-160 | sed 's/^/    /' >&2
      exit 1
    fi
  fi
fi

git fetch -q "$remote" main
parent=$(git rev-parse FETCH_HEAD)
tree=$(git rev-parse 'HEAD^{tree}')
if [ "$(git rev-parse "$parent^{tree}")" = "$tree" ]; then
  echo "Public main already matches HEAD."; exit 0
fi

commit=$(git commit-tree "$tree" -p "$parent" -m "$msg")
git push "$remote" "$commit:refs/heads/main"
echo "Published $(git rev-parse --short "$commit") to $remote/main."
