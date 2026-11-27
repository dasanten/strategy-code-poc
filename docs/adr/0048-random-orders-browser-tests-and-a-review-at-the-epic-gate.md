# Random orders, browser tests and a review at the epic gate

Status: decided (2026-11-27, with Daniel). Amends ADR 0009 (what is checked before an epic goes
into `dev`) and ADR 0040 (what runs each night). Built in Epics 125, 126 and 130.

## Context

On `dev` (2e7f080e) every one of the 3,474 Rust tests is a scenario someone wrote, the client's 132
test files are all logic, and a ticket PR merges when its checks are green without anyone reading
it. Of the 26 bugs closed between 2026-11-13 and 2026-11-27, 8 were a rule that did not cover a
newer order kind, and every screen bug was found by Daniel playing. Three kinds of check are
missing: orders nobody thought of, the screens themselves, and a second reader. Each costs time,
and checks already share one machine (ADR 0040) and scarce CI minutes (ADR 0009), so where each
one runs is the decision.

## Decisions

- **Random orders: short in every check, long each night.** A test gives random orders to a small
  world and runs the invariants (ADR 0004) after every tick. A few fixed seeds run in the default
  suite, under 5 s together. A long run on fresh seeds is ignored for time, so it runs with every
  other ignored test each night on `dev` and reports into the same file. A failure names its seed
  and replays from it.
- **Browser tests: at the epic gate and on the release PR.** `pnpm test:browser` plays the main
  flows in a real browser on a small creative world (ADR 0043). It runs before an epic goes into
  `dev`, beside `pnpm test:slow`, and in CI only on the PR `dev` → `main`. It is not part of
  `pnpm check`: ticket PRs stay as fast as they are.
- **An epic is reviewed before it goes into `dev`.** The coordinator runs a code review on the
  epic's diff. A finding confirmed as a bug is fixed on the epic branch before the merge. Cleanups
  and uncertain findings are listed in the epic PR and do not block.
- **A mutation report each night, blocking nothing.** `cargo mutants` on what reached `dev` since
  the night before lists the changed lines no test would have noticed, in the nightly report. The
  coordinator reads it and files a ticket where a rule is held by no test.

## Considered

- **Everything nightly only:** tickets and gates as fast as today, but a broken screen or a missed
  order kind reaches `dev` first and is found a day later, after other epics built on it.
- **Everything at the epic gate:** the long random run and the mutation report take tens of
  minutes each; the gate is already about 8 minutes of slow tests.
- **Browser tests in every `pnpm check`:** a server, a world and a browser for each ticket, on a
  machine several sessions share.
- **Every review finding fixed before the merge:** the cleanest code, and an epic that waits on
  matters of taste.
- **A review of every ticket PR:** a ticket is a slice; what a second reader finds shows on the
  whole epic, in one review instead of one per ticket.

## Consequences

- The epic gate grows by the browser tests (aimed at under 5 minutes) and the review.
- The nightly run grows by the long random run (about 10 minutes) and the mutation report (capped).
- A violation the random run finds is a bug with its seed; a seed that fails on a known bug is left
  out by name until the bug is fixed, never silently.
- CI on the release PR needs a browser; ticket and epic PRs need none.
