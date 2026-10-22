---
description: Pick the next GitHub ticket and work it into a pull request
---

Work the next ticket of this repo (dasanten/strategy-code-poc) into a ready-for-review PR,
following `docs/tasks.md` and `CLAUDE.md`. `$ARGUMENTS` may name a ticket number to take instead.

## 1. Pick

1. Fetch (`git fetch origin`); stop if the tree is dirty.
2. Open `bug` issues come first.
3. Otherwise take the lowest open epic (label `epic`, by its number in the title) that has open
   sub-issues (`gh api repos/dasanten/strategy-code-poc/issues/<epic>/sub_issues`), and in it the
   first ticket in order that:
   - has none of the labels `in progress`, `needs Daniel`, `blocked`, and
   - whose "Depends on" tickets are all closed. A dependency that is only in an open PR does not
     count: skip the ticket.
4. If nothing qualifies, say what is blocking (open PRs waiting for review, `needs Daniel`
   tickets) and stop. Never work a `needs Daniel` ticket.

## 2. Claim

Add the label `in progress`, assign yourself (`--add-assignee @me`), and comment the branch name.
The branch is `t<issue number>-<short-slug>`, cut from the epic branch `origin/epic/<n>-<slug>`
(ADR 0009). If the epic has no branch yet, create it from `origin/main` and push it. A `bug`
branches from `origin/main` instead.

## 3. Build

- Read the ticket, its epic, `CONTEXT.md` and the ADRs it touches.
- A missing **rule** (what happens) is not yours to invent: comment the question on the ticket,
  swap `in progress` for `needs Daniel`, and pick the next ticket.
- A missing **number** is yours: pick a sensible value in the balance file
  (`packages/shared/src/balance.ts`, one commented constant each) and list it in the PR.
- New simulation rules come with invariants and tests (ADR 0004); a change to world state shape
  bumps `WORLD_FORMAT_VERSION` with a migration and a test (ADR 0006); actions and queries go
  through the game API, orders only request actions (ADR 0002).
- If the next ticket cannot ship without this one (or the reverse), do both in this PR.
- Tick the ticket's "Done when" boxes as they become true (edit the issue body).
- Before committing: `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## 4. Pull request

- Merge the latest epic branch into yours and run `pnpm lint`, `pnpm typecheck`, `pnpm test`
  again: ticket PRs get no CI, so this run is what lets the PR merge. Say in the PR body that it
  passed.
- Push and open a ready-for-review PR (not a draft) against the epic branch (a `bug` against
  `main`).
- Title: what changed. Body: what and why, balance values chosen, anything to check, then one
  `Closes #<ticket>` line per ticket and `Part of #<epic>`.
- Turn on Auto-fix for the PR.
- Leave `in progress` on the ticket until the PR merges. Never merge yourself: the coordinating
  session merges into the epic branch after its own local run and closes the tickets by hand
  (GitHub only closes them on merges into `main`).

## 5. Keep going

If asked to keep going, pick the next ticket that does not depend on an unmerged PR. Finish with
a short list: PRs opened, tickets waiting for review, and anything `needs Daniel`.
