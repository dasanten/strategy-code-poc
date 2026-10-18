# Working on this repo

- **Game rules and terms:** `CONTEXT.md`. Use its words in code, UI and docs. If a rule you need
  is missing, ask Daniel and add it there before building on it.
- **Decisions:** `docs/adr/`. The game vision in `CONTEXT.md` wins over ADR 0001 where they
  conflict.
- **What to do next:** `docs/tasks.md`, top to bottom. Tick items off and move slices to Done in
  the same commit as the work.
- **Keep scripting cheap to add** (ADR 0002): everything goes through the game API in
  `packages/shared`; orders only request actions; order state is plain serialisable data.
- **Monitoring** (ADR 0004): new simulation rules come with invariants and tests.
- Before finishing: `pnpm lint`, `pnpm typecheck`, `pnpm test`.
