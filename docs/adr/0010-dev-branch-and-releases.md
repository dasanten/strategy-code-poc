# A dev branch, and releases into main

Status: decided (2026-10-23, with Daniel). Amends ADR 0009.

Every merge into `main` deploys the live game (ADR 0007). With epic PRs and bug fixes going
straight into `main`, each small fix meant a full deployment Daniel didn't want. He wants to ship
in bigger releases instead.

## Decisions

- **`dev` collects finished work.** Epic PRs (`epic/<n>-<slug>` → `dev`) and bug PRs go into
  `dev`, run CI (lint, typecheck, tests) and are merged once green. Nothing deploys.
- **Epic branches and bug branches are cut from `dev`,** and open epic branches merge `dev` in
  locally after a bug fix lands there.
- **A release is one PR `dev` → `main`,** opened when Daniel asks for one. It runs CI with the
  image build and, merged, deploys. Its body lists the epics and bugs it ships.
- **CI** runs for PRs into `dev` (checks only, no image build), PRs into `main` (checks and image
  build) and pushes to `main` (checks, image push, deploy). Pushes to `dev` run nothing, since
  their PR already did.
- **Closing issues:** GitHub only closes issues on merges into the default branch (`main`), so
  whoever merges an epic or bug PR into `dev` closes its issues by hand, as with ticket PRs.

## Consequences

- The live game changes only when Daniel releases; a release can carry several epics and fixes.
- A release PR runs CI a second time over work `dev` already checked: one run per release, and
  the only place the Docker image is built before `main`.
- An urgent fix can still ship on its own as a small release `dev` → `main`.
