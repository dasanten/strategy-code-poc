# Backlog

Work lives in [GitHub Issues](https://github.com/dasanten/strategy-code-poc/issues): each slice
is an **epic** (label `epic`) with its **tickets** as sub-issues, in order. `/next-ticket` picks
the next one and works it into a PR (`.claude/commands/next-ticket.md`).

## How tickets work

- **Status:** open = to do, closed = done (closed by the PR that merges). Labels: `in progress`
  (someone is on it), `blocked` (waiting on something outside its Depends-on list), `needs Daniel`
  (a rule decision or manual step only Daniel can do; never picked up automatically).
- **Dependencies:** a ticket's "Depends on #n" line. A ticket is ready when all of them are
  closed.
- **Branches (ADR 0009, 0010):** each epic has a branch `epic/<n>-<slug>`, cut from `dev` when
  its first ticket starts. Ticket branches come from the epic branch and their PRs target it.
  Bugs branch from `dev` and go straight back to it.
- **PRs:** one per ticket; tickets that can't ship apart share one. The body says
  `Closes #<ticket>` for each and `Part of #<epic>`. Ticket PRs get no CI: the ticket session runs
  `pnpm check origin/epic/<n>-<slug>` (lint, typecheck and the tests the change affects, ADR 0013),
  and before merging into the epic branch the coordinating session runs it again on the PR merged
  with the epic branch, unless the PR already contains the epic tip (`docs/coordination.md`). PR bodies say "Checked: `pnpm check` against …" with what it ran. Merging into a
  non-default branch doesn't close the ticket, so whoever merges closes its tickets by hand.
- **Slow tests:** a test that takes more than about 20 s on an idle machine (a long simulation)
  gets `{ tags: ['slow'] }` on its `it` or `describe`, with any timeout in the same object
  (`{ tags: ['slow'], timeout: 120_000 }`: Vitest ignores a trailing timeout next to options).
  `pnpm check` skips them, even when affected, and says how many; `pnpm test` runs them, and CI
  runs `pnpm test`.
- **Epic PR:** when an epic's last ticket is on its branch, one PR `epic/<n>-…` → `dev` with
  `Closes #<epic>` is merged after the local checks and `pnpm test:slow`, without waiting for its
  CI (`docs/coordination.md`); whoever merges closes the epic by hand.
- **Release:** when Daniel asks, one PR `dev` → `main` lists the epics and bugs it ships, runs CI
  and is merged once green. Only merges into `main` deploy.
- **Rules vs numbers:** a missing game rule becomes a `needs Daniel` question and lands in
  its section file under `docs/context/` (a new term also in `CONTEXT.md`, the
  index). Balance numbers are picked in `crates/csp-shared/src/balance/` (one file per domain) and listed in
  the PR for review.
- **Scope-only epics:** an epic without tickets lists its open rule questions. When the epic
  before it is nearly done, settle those questions with Daniel, then write its tickets.
- **Every ticket:** read the index `CONTEXT.md`, then the section files under `docs/context/` the
  ticket names, and use their terms; a ticket names the section files it builds on; keep scripting
  cheap (ADR 0002); new
  simulation rules come with invariants and tests (ADR 0004); each epic ends visible in the
  browser.

## Priority rule

**Priority rule:** bugs first, then epics in order, so the game becomes playable sooner:
survive → produce → transport → grow → trade → fight → alliances → scripts → roads. Daniel moves
epics ahead of that order; each time it is agreed, it is written here with its date. Tickets that
need an earlier epic name it under Depends on, and wait for it to reach `dev`.

The agreements up to 2026-11-25 are in `docs/log.md`, in order. The last of them: the bug #1559
first, then Fewer collisions (Epic 120), Content defined once (121), One copy of the rules (122),
Client tidy (123) and Agent docs (124), in that order; none changes a game rule. Bandits (16)
stays set aside.

## Epics

The open epics. A finished epic's row moves to the table in `docs/log.md`; a new epic takes the
number one above the highest in either table (`docs/coordination.md`: Epic numbers).

| #   | Epic                                                                                            | State                   |
| --- | ----------------------------------------------------------------------------------------------- | ----------------------- |
| 16  | [Bandits](https://github.com/dasanten/strategy-code-poc/issues/144)                             | scope only              |
| 124 | [Agent docs](https://github.com/dasanten/strategy-code-poc/issues/1595) | in progress (`epic/124-agent-docs`) |

Live progress is on each epic (sub-issue progress bar); this table only changes when an epic gets
its tickets or closes.
