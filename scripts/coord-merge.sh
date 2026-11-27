#!/usr/bin/env bash
# The coordinator's merge loop (docs/coordination.md): for each ticket PR, in order, bring it up to
# the epic branch's tip in this checkout, run the checks, and merge it on GitHub when green.
#
#   bash scripts/coord-merge.sh <epic-branch> <pr> [<pr>...]
#
# Run it from the coordinator's own worktree (`.claude/worktrees/coord-<epic>`), never the shared
# main checkout: it checks out each PR there. Per PR:
#
# - A PR whose head already contains the epic tip was checked by its worker on exactly what would
#   be merged: it merges without running the checks again.
# - Otherwise the epic branch is merged into it. A conflict of only `pub mod x;` lines (a crate's
#   module list) is resolved by keeping both sides (`scripts/resolve-modlist.pl`), `Cargo.lock` by
#   taking the epic's and letting cargo settle it; the resolution is pushed to the PR branch. Any
#   other conflict skips the PR for a human: generated files are regenerated, never merged by hand.
# - Then `pnpm check:rust` and `pnpm check origin/<epic>`, each logged to a file. A red check skips
#   the PR; green pushes the merged result to the PR branch and merges the PR.
#
# The loop never force-pushes. Logs go to `$COORD_LOGS` (default: `logs/` beside the worktree).
# `CHECK_ONLY=1` runs everything but the pushes and the merge, to try the loop on a PR.
set -u
if [ $# -lt 2 ]; then
  echo "usage: bash scripts/coord-merge.sh <epic-branch> <pr> [<pr>...]" >&2
  exit 2
fi
EPIC=$1
shift
REPO=${COORD_REPO:-dasanten/strategy-code-poc}
CHECK_ONLY=${CHECK_ONLY:-0}
HERE=$(cd "$(dirname "$0")" && pwd)
WT=$(git rev-parse --show-toplevel) || exit 1
cd "$WT" || exit 1
if command -v gh > /dev/null 2>&1; then GH=gh; else GH="/c/Program Files/GitHub CLI/gh.exe"; fi
if command -v fnm > /dev/null 2>&1; then
  eval "$(fnm env --shell bash)" && fnm use > /dev/null 2>&1
fi
LOGDIR=${COORD_LOGS:-$WT/../logs}
mkdir -p "$LOGDIR"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "the worktree has changes: commit or drop them first" >&2
  exit 1
fi

# Pushes HEAD to the PR's own branch (never forced); returns 1 when the push fails.
push_to_pr() {
  local pr=$1 head
  if [ "$CHECK_ONLY" = 1 ]; then
    echo "CHECK_ONLY: would push the merged result to PR #$pr"
    return 0
  fi
  head=$("$GH" pr view "$pr" --repo "$REPO" --json headRefName -q .headRefName) || return 1
  if ! git push origin "HEAD:refs/heads/$head" > "$LOGDIR/push-$pr.log" 2>&1; then
    cat "$LOGDIR/push-$pr.log"
    return 1
  fi
  echo "pushed the merged result to $head"
  # GitHub needs a moment to see the new head before it merges it.
  sleep 20
}

merge_pr() {
  local pr=$1
  if [ "$CHECK_ONLY" = 1 ]; then
    echo "CHECK_ONLY: would merge PR #$pr"
    return 0
  fi
  if ! "$GH" pr merge "$pr" --merge --repo "$REPO" > "$LOGDIR/ghmerge-$pr.log" 2>&1; then
    cat "$LOGDIR/ghmerge-$pr.log"
    return 1
  fi
  echo "MERGED #$pr"
}

SKIPPED=""
for PR in "$@"; do
  echo "=== PR #$PR"
  git fetch -q origin "$EPIC" "+refs/pull/$PR/head:refs/remotes/pr/$PR" || {
    echo "fetch failed"
    exit 1
  }
  if git merge-base --is-ancestor "origin/$EPIC" "pr/$PR"; then
    echo "already contains origin/$EPIC: merging without a re-check"
    merge_pr "$PR" || SKIPPED="$SKIPPED $PR"
    continue
  fi
  git checkout -q -B "check-$PR" "pr/$PR" || exit 1
  if ! git merge -q --no-edit "origin/$EPIC" > "$LOGDIR/merge-$PR.log" 2>&1; then
    resolved=1
    for f in $(git diff --name-only --diff-filter=U); do
      case "$f" in
        Cargo.lock)
          git checkout --theirs "$f" && cargo metadata --format-version 1 > /dev/null 2>&1 &&
            git add "$f" || resolved=0
          ;;
        *) perl "$HERE/resolve-modlist.pl" "$f" && git add "$f" || resolved=0 ;;
      esac
    done
    if [ "$resolved" = 1 ] && [ -z "$(git diff --name-only --diff-filter=U)" ] &&
      ! git grep -q -E '^(<{7} |>{7} |={7}$)' -- $(git diff --cached --name-only); then
      git commit -q --no-edit || {
        echo "commit of the resolution failed"
        exit 2
      }
      echo "resolved a module-list conflict"
    else
      echo "CONFLICT merging origin/$EPIC into PR #$PR:"
      git diff --name-only --diff-filter=U
      git merge --abort
      SKIPPED="$SKIPPED $PR"
      continue
    fi
  fi
  if ! corepack pnpm install --frozen-lockfile --prefer-offline > "$LOGDIR/install-$PR.log" 2>&1; then
    echo "pnpm install failed (see $LOGDIR/install-$PR.log)"
    exit 1
  fi
  if ! corepack pnpm check:rust > "$LOGDIR/rust-$PR.log" 2>&1; then
    echo "RED check:rust (see $LOGDIR/rust-$PR.log)"
    tail -30 "$LOGDIR/rust-$PR.log"
    SKIPPED="$SKIPPED $PR"
    continue
  fi
  echo "check:rust green"
  if ! corepack pnpm check "origin/$EPIC" > "$LOGDIR/ts-$PR.log" 2>&1; then
    echo "RED pnpm check (see $LOGDIR/ts-$PR.log)"
    grep -E "FAIL|✗|×|Error" "$LOGDIR/ts-$PR.log" | head -20
    SKIPPED="$SKIPPED $PR"
    continue
  fi
  tail -2 "$LOGDIR/ts-$PR.log"
  # GitHub merges the PR's head, not this checkout: push the merge commit there first.
  push_to_pr "$PR" || {
    echo "push to PR #$PR failed"
    SKIPPED="$SKIPPED $PR"
    continue
  }
  merge_pr "$PR" || SKIPPED="$SKIPPED $PR"
done
git fetch -q origin "$EPIC" && git checkout -q --detach "origin/$EPIC" &&
  echo "epic at $(git rev-parse --short HEAD)"
[ -n "$SKIPPED" ] && echo "SKIPPED (conflict or red):$SKIPPED"
echo "ALL DONE"
