---
name: plan-features
description: Runs a feature prioritisation and planning session for this game, then coordinates the work. Ranks candidate features with Daniel, settles their rules against CONTEXT.md and the ADRs, writes each one as an epic with ordered tickets on GitHub, and then stays as the coordinating session, starting one linked session per workable ticket, merging green PRs and starting tickets as they unblock. Use when Daniel wants to plan or prioritise features, decide what to build next, turn an idea into an epic, or run ticket sessions in parallel.
---

# Plan features, then coordinate

One session does both jobs: first plan with Daniel, then hand the tickets out to linked sessions
and keep them moving. Follow `CLAUDE.md` and `docs/tasks.md`; use the words in `CONTEXT.md`.

## 1. Survey

Run `git fetch origin`, then show Daniel a short state, no more than a screen:

- open `bug` issues and open `needs Daniel` tickets (these questions come first);
- open epics with their sub-issue progress, and scope-only epics with their open questions;
- open PRs and their targets, and the linked sessions still running
  (`list_sessions {"linked": true}`).

## 2. Prioritise

1. Collect candidates: Daniel's new ideas, scope-only epics, open feature issues.
2. Propose an order with one line of reasoning each. Default to the rule in `docs/tasks.md`
   (bugs, then whatever makes the game playable sooner). Daniel decides. Don't argue past one
   round.
3. Write the agreed order into the priority rule and epic table in `docs/tasks.md`.

## 3. Plan each picked feature, in order

1. **Grill** (as in the `grill-with-docs` skill): one question at a time, each with your
   recommended answer, until every rule is settled. Rules go into `CONTEXT.md` as they settle; a
   real decision with alternatives gets an ADR. Numbers are not questions: they are picked later
   in `balance.ts`.
2. **Epic:** an issue labelled `epic`, titled `Epic <n>: <name>`, saying what Daniel can do at the
   end and how it shows in the browser.
3. **Tickets:** thin vertical slices (as in the `to-issues` skill), added as sub-issues in work
   order. Each has a `Depends on #n` line (left out when it has none), `Done when` checkboxes, and
   the rules it builds on. A rule still open becomes a ticket labelled `needs Daniel`.
4. **Branch:** cut `epic/<n>-<slug>` from `origin/dev`, commit the `CONTEXT.md`, ADR and
   `docs/tasks.md` changes onto it ("Rules: …"), and push. This keeps the doc change off CI.
5. Show Daniel the ticket list with its dependencies and wait for an OK before step 4.

Plan everything Daniel picked before coordinating, unless Daniel says to start the first epic now.

## 4. Coordinate

Follow [COORDINATE.md](COORDINATE.md) until no ticket is workable and no linked session is
running, or Daniel stops you.

## 5. Finish

List the epics planned, PRs merged, tickets still open or `needs Daniel`, and epic PRs into `dev`
waiting on CI. Never open the `dev` → `main` release unless Daniel asks (ADR 0010).
