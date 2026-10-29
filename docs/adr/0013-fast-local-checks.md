# Fast local checks, the full suite only in CI

Status: decided (2026-10-29, with Daniel). Amends ADR 0009: local checks no longer run the whole
test suite.

`pnpm test` takes about 4 minutes on an idle machine (142 files, about 1,700 tests). With several
ticket sessions checking at once it takes close to 10, and it runs twice per ticket: once in the
ticket session and again in the coordinating session after merging the epic branch in. Most of
the time goes to a few long simulations (an NPC village or the Trade Organization left alone for
game weeks), each taking one to three minutes. Waiting that long after resolving a merge
conflict slows every PR.

## Decisions

- **Local checks run only the affected tests.** Ticket sessions and the coordinating session's
  check before merging a ticket PR run lint, typecheck and the tests affected by the change
  against the epic branch (Vitest's module graph), not the whole suite.
- **Slow tests run only in CI.** Tests that take more than about 20 seconds (long simulations)
  are marked slow. Local checks skip them, even when affected.
- **The full suite runs in CI** on the epic PR into `dev`, on bug PRs and on the release PR. A
  failure found there is fixed on the epic branch before it merges.
- **Same tests.** The tests themselves stay as they are. Only where and when they run changes,
  plus setup work that makes them faster without changing what they check.

## Consequences

- A ticket can break a slow test or an unaffected test and only CI on the epic PR finds out. That
  costs one fix on the epic branch, which is rarer and cheaper than waiting minutes on every
  ticket.
- Each check names what it ran (affected tests, slow tests skipped), so a PR says what was and
  wasn't checked.
- `CLAUDE.md`, `docs/tasks.md`, `/next-ticket` and the coordinating skill name the new check
  command instead of the three separate commands.
