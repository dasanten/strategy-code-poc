# Coordinating linked ticket sessions

This session never works a ticket itself. It starts ticket sessions, merges their PRs and starts
the next ones. Never stop an app running on Daniel's computer.

## Workable ticket

Open, in an open epic, no `in progress` / `needs Daniel` / `blocked` label, and every
`Depends on` ticket closed. A dependency that is only in an open PR does not count. Bugs come
first, then epics in the order of `docs/tasks.md`.

## Start sessions

For every workable ticket at once, without asking Daniel first:

- `start_session` with initiation `user_asked`, context `fresh`, a worktree, title
  `#<n> <ticket title>`, and the prompt `/next-ticket <n>`.
- Before the calls: one bold line naming the batch and a `mark_chapter`.
- Never start two sessions for the same ticket. A ticket session stops once its PR is open with
  Auto-fix on and starts no sessions of its own.
- If the app refuses a start (this turn came from a session note or an event), propose the same
  session with initiation `own_initiative` instead and say so in one line.

## When a ticket session reports

Check the PR itself, not just the note.

1. **Ticket PR into the epic branch:** check it out, merge `origin/epic/<n>-<slug>` into it,
   run `pnpm lint`, `pnpm typecheck` and `pnpm test`. Green: merge the PR, close its tickets
   by hand and remove `in progress`. Red: send the failure to that session with `SendMessage`.
2. **`WORLD_FORMAT_VERSION`:** several open PRs that bump it merge one at a time. After each,
   tell the next one which number to take.
3. **Questions:** a session asking about a rule goes to Daniel. Quote Daniel word for word when you
   forward the answer. Write the rule into `CONTEXT.md` on the epic branch.
4. **Next tickets:** after each merge, look for tickets that just became workable and start them.
5. **Epic done:** when an epic's last ticket is merged, open one PR `epic/<n>-…` → `dev` with
   `Closes #<epic>`. Merge it once all CI checks are green, then close the epic by hand.

## Don't

- poll CI or sessions (the app wakes you when a session ends its turn);
- merge anything into `main`;
- archive sessions unless Daniel says yes.
