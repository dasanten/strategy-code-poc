#!/usr/bin/env bash
# T128.1 (#1704): time install / check:rust / check in fresh and reused worktrees.
# Usage: measure.sh <phase> <n>   phase = fresh | age | reuse | edit ; n = run number (1, 2)
# The whole run, from this folder, each timed phase after 60 s with no cargo/rustc on the machine:
#   for n in 1 2; do bash waitquiet.sh 60 bash measure.sh fresh $n; bash measure.sh age $n;
#     bash waitquiet.sh 60 bash measure.sh reuse $n; bash waitquiet.sh 60 bash measure.sh edit $n; done
# Results: $LOG/results.tsv (seconds, exit code, cargo+rustc count before/after, CPU % before).
set -u
HERE=$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)
REPO=$(cd "$HERE" && git rev-parse --path-format=absolute --git-common-dir)/..
WT=$REPO/.claude/worktrees/m1704-$2
OLD=${OLD:-e290d85e} # dev on 2026-11-25, two days behind the tip when measured
LOG=${LOG:-$REPO/.claude/worktrees/m1704-logs}
mkdir -p "$LOG"
RES=$LOG/results.tsv
cd "$HERE" && eval "$(fnm env --shell bash)" && fnm use >/dev/null

load() { powershell -NoProfile -Command "(Get-Process cargo,rustc -ErrorAction SilentlyContinue | Measure-Object).Count"; }
cpu() { powershell -NoProfile -Command "[int](Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average"; }

step() { # step <label> <command...>
  local label=$1; shift
  local l0 l1 c0 t0 t1 st
  l0=$(load | tr -d '\r'); c0=$(cpu | tr -d '\r')
  t0=$(date +%s.%N)
  "$@" >"$LOG/run$N-$label.log" 2>&1
  st=$?
  t1=$(date +%s.%N)
  l1=$(load | tr -d '')
  printf '%s\t%s\t%s\t%.0f\t%s\t%s\t%s\n' "$(date +%H:%M:%S)" "run$N" "$label" "$(awk "BEGIN{print $t1-$t0}")" "$st" "procs=$l0/$l1" "cpu=$c0%" | tee -a "$RES"
}
size() { printf '%s\trun%s\t%s\ttarget=%s\tnode_modules=%s\n' "$(date +%H:%M:%S)" "$N" "$1" \
  "$(du -sm "$WT/target" 2>/dev/null | cut -f1)MB" "$(du -sm "$WT/node_modules" 2>/dev/null | cut -f1)MB" | tee -a "$RES"; }

N=$2
inst() { corepack pnpm install --frozen-lockfile --prefer-offline; }
rust() { corepack pnpm check:rust; }
chk() { corepack pnpm check origin/dev; }
x() { "$@"; } # gives step a second word for the log name

case $1 in
  fresh)
    git fetch -q origin
    step worktree-add x git worktree add -q -b m1704-a-$N "$WT" origin/dev
    cd "$WT" || exit 1
    step a-install x inst
    step a-check-rust x rust
    step a-check x chk
    size a ;;
  age) # untimed: build the same worktree on an older dev commit, as a slot left by a past ticket
    cd "$WT" || exit 1
    git switch -q -c m1704-old-$N $OLD
    step age-install x inst
    step age-check-rust x rust
    size age ;;
  reuse)
    cd "$WT" || exit 1
    git fetch -q origin
    step switch x git switch -q -c m1704-b-$N origin/dev
    step b-install x inst
    step b-check-rust x rust
    step b-check x chk
    size b ;;
  edit)
    cd "$WT" || exit 1
    sed -i '0,/^pub mod /s//\/\/ T128.1: one changed line.\npub mod /' crates/csp-sim/src/lib.rs
    git commit -q -am "T128.1 measure: one line in csp-sim (local only)"
    step c-check-rust x rust
    step c-check x chk
    size c ;;
esac
