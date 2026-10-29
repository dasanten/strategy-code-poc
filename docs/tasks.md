# Backlog

Work lives in [GitHub Issues](https://github.com/dasanten/strategy-code-poc/issues): each slice
is an **epic** (label `epic`) with its **tickets** as sub-issues, in order. `/next-ticket` picks
the next one and works it into a PR (`.claude/commands/next-ticket.md`).

**Priority rule:** bugs first, then epics in order, so the game becomes playable sooner:
survive → produce → transport → grow → trade → fight → alliances → scripts → roads. Exception:
the UI redesign (Epic 17, ADR 0008), then the livelier pace and default scripts (Epic 18, ADR
0009), go ahead of the remaining gameplay epics. The admin map (Epic 19) runs in parallel with
Epic 18, ahead of Bandits. Agreed with Daniel on 2026-10-28: Quick wins 2 (Epic 30), Food pickup
(31), Outpost storage (32) and UI overhaul and mobile (33), in that order, go ahead of Bandits.
Agreed with Daniel on 2026-10-29: Faster checks (Epic 34, ADR 0013) first, since every other
ticket waits on checks; then Riding and horses (35), Script params (36), Queue planner and
groups (37), Children and food (38) and Passenger carriages (39), in that order, all ahead of
Bandits. The tickets of 35–39 wait for Epic 34's T34.1 and T34.2.

**PoC done** = Epic 6 closed: my residents mine iron far away, and a carriage brings it home while
I sleep.

## Epics

| #   | Epic                                                                                            | State                   |
| --- | ----------------------------------------------------------------------------------------------- | ----------------------- |
| 0   | [Project setup](https://github.com/dasanten/strategy-code-poc/issues/4)                         | code done; needs Daniel |
| 1   | [World map](https://github.com/dasanten/strategy-code-poc/issues/8)                             | ticketed                |
| 2   | [Residents and the starting city](https://github.com/dasanten/strategy-code-poc/issues/14)      | ticketed                |
| 3   | [Survive](https://github.com/dasanten/strategy-code-poc/issues/19)                              | ticketed                |
| 4   | [Move and carry](https://github.com/dasanten/strategy-code-poc/issues/26)                       | ticketed                |
| 5   | [Workplaces on resource nodes](https://github.com/dasanten/strategy-code-poc/issues/32)         | ticketed                |
| 6   | [Carriages and supply routes](https://github.com/dasanten/strategy-code-poc/issues/38)          | ticketed, PoC done      |
| 7   | [Pairing and children](https://github.com/dasanten/strategy-code-poc/issues/43)                 | ticketed                |
| 8   | [NPC cities and integrating](https://github.com/dasanten/strategy-code-poc/issues/46)           | ticketed                |
| 9   | [Trade Organization](https://github.com/dasanten/strategy-code-poc/issues/47)                   | ticketed                |
| 10  | [Combat and armies](https://github.com/dasanten/strategy-code-poc/issues/48)                    | ticketed                |
| 11  | [Crime and reputation](https://github.com/dasanten/strategy-code-poc/issues/49)                 | ticketed                |
| 12  | [Alliances and territory](https://github.com/dasanten/strategy-code-poc/issues/50)              | ticketed                |
| 13  | [Leader death and self-managed cities](https://github.com/dasanten/strategy-code-poc/issues/51) | ticketed                |
| 14  | [Scripting](https://github.com/dasanten/strategy-code-poc/issues/52)                            | ticketed                |
| 15  | [Roads and admin directive](https://github.com/dasanten/strategy-code-poc/issues/53)            | ticketed                |
| 16  | [Bandits](https://github.com/dasanten/strategy-code-poc/issues/144)                             | scope only              |
| 17  | [Game UI redesign](https://github.com/dasanten/strategy-code-poc/issues/202)                    | ticketed                |
| 18  | [Livelier pace and default scripts](https://github.com/dasanten/strategy-code-poc/issues/220)   | ticketed                |
| 19  | [Admin map](https://github.com/dasanten/strategy-code-poc/issues/232)                           | ticketed                |
| 20  | [Leader handover](https://github.com/dasanten/strategy-code-poc/issues/244)                     | ticketed                |
| 21  | [Tile card info](https://github.com/dasanten/strategy-code-poc/issues/269)                      | ticketed                |
| 22  | [Wiki](https://github.com/dasanten/strategy-code-poc/issues/276)                                | ticketed                |
| 23  | [Names](https://github.com/dasanten/strategy-code-poc/issues/288)                               | ticketed                |
| 25  | [Quick wins](https://github.com/dasanten/strategy-code-poc/issues/320)                          | ticketed                |
| 30  | [Quick wins 2](https://github.com/dasanten/strategy-code-poc/issues/375)                        | ticketed                |
| 31  | [Food pickup](https://github.com/dasanten/strategy-code-poc/issues/376)                         | ticketed                |
| 32  | [Outpost storage](https://github.com/dasanten/strategy-code-poc/issues/377)                     | ticketed                |
| 33  | [UI overhaul and mobile](https://github.com/dasanten/strategy-code-poc/issues/378)              | ticketed                |
| 34  | [Faster checks](https://github.com/dasanten/strategy-code-poc/issues/414)                       | ticketed                |
| 35  | [Riding and horses](https://github.com/dasanten/strategy-code-poc/issues/418)                   | ticketed                |
| 36  | [Script params](https://github.com/dasanten/strategy-code-poc/issues/423)                       | ticketed                |
| 37  | [Queue planner and groups](https://github.com/dasanten/strategy-code-poc/issues/427)            | ticketed                |
| 38  | [Children and food](https://github.com/dasanten/strategy-code-poc/issues/431)                   | ticketed                |
| 39  | [Passenger carriages](https://github.com/dasanten/strategy-code-poc/issues/434)                 | ticketed                |

Live progress is on each epic (sub-issue progress bar); this table only changes when an epic gets
its tickets or closes.

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
  with the epic branch. PR bodies say "Checked: `pnpm check` against …" with what it ran. Merging into a
  non-default branch doesn't close the ticket, so whoever merges closes its tickets by hand.
- **Epic PR:** when an epic's last ticket is on its branch, one PR `epic/<n>-…` → `dev` with
  `Closes #<epic>` runs CI and is merged once green; whoever merges closes the epic by hand.
- **Release:** when Daniel asks, one PR `dev` → `main` lists the epics and bugs it ships, runs CI
  and is merged once green. Only merges into `main` deploy.
- **Rules vs numbers:** a missing game rule becomes a `needs Daniel` question and lands in
  `CONTEXT.md`. Balance numbers are picked in `packages/shared/src/balance.ts` and listed in the
  PR for review.
- **Scope-only epics:** an epic without tickets lists its open rule questions. When the epic
  before it is nearly done, settle those questions with Daniel, then write its tickets.
- **Every ticket:** use the terms in `CONTEXT.md`; keep scripting cheap (ADR 0002); new
  simulation rules come with invariants and tests (ADR 0004); each epic ends visible in the
  browser.
