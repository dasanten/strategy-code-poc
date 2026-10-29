# Epic branches, local checks, CI only into main

Status: decided (2026-10-22, with Daniel). Amended by ADR 0010: epic PRs and bugs go into `dev`,
and `main` changes only with a release.

GitHub Actions minutes for this private repo ran out within days: every push ran CI twice (`push`
and `pull_request`) plus a Docker build, and with several ticket PRs open at once, each merge of
`main` into a branch ran it all again (about 80 runs a day against a budget of about 65 minutes a
day). Daniel won't raise the billing limit, so we run CI far less often.

## Decisions

- **One branch per epic:** `epic/<n>-<slug>`, cut from `main` when the epic's first ticket
  starts. Ticket PRs target the epic branch, not `main`.
- **Local checks decide whether a ticket merges.** The ticket session runs the local checks
  before opening its PR. Before merging a ticket PR into the epic branch, the coordinating
  session brings it up to date with the epic branch and runs them again on the merged result; it
  merges only when they pass. Since ADR 0013 the local checks are `pnpm check <epic branch>`:
  lint, typecheck and only the tests the change affects.
- **One PR per epic into `main`,** opened when the epic's last ticket has landed on the epic
  branch. It closes the epic, runs CI, and is merged once CI is green. `main` (and with it the
  live game) changes once per epic.
- **Bugs** go straight to `main` as small PRs with CI, so fixes don't wait for an epic. Open epic
  branches then merge `main` in locally.
- **CI** (`.github/workflows/ci.yml`) runs only for PRs into `main` and pushes to `main`, skips
  docs-only changes, cancels a superseded run on a PR, and builds the image only on PRs into
  `main` and pushes to `main`.

## Consequences

- Deploys happen once per epic, which matches "each epic ends visible in the browser".
- A CI failure on an epic PR can come from any of its tickets; the full local run after every
  ticket merge keeps that rare.
- Epics run one after another, as the priority rule in `docs/tasks.md` already orders them; two
  open epic branches would conflict with each other.
- Several `WORLD_FORMAT_VERSION` bumps can pile up on one epic branch; its tickets merge one at
  a time, so each takes the next number.
