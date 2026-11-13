# Queues hold blocks

Status: decided (2026-11-12, with Daniel). Rules in `CONTEXT.md` under **Repeat block**, **If
block**, **Wait until** and **Condition**; built in Epic 95 (Queue conditions).

A queue has been a flat list of steps since Epic 37. Repeat blocks (Epic 51) were a planner thing
only: giving the queue made each block that many copies of its steps. Daniel wants queues to
decide things (wait until the cart is full, fetch food only if hungry) without writing a script,
and "repeat 100 times" should not cost 100 steps.

## Decisions

- **The queue is a tree.** Its items are steps, repeat blocks and If blocks, nested. The server
  stores and runs blocks; nothing is unrolled when a queue is given.
- **Repeat runs a count, forever, or until a condition.** The whole-queue loop stays the queue's
  own switch.
- **If is checked once, when its turn comes,** and may have an Else part.
- **Wait until is a step,** ending when its condition holds or its duration is up.
- **Conditions come from a fixed list** about the resident themself or one place of their own
  realm. They are plain data in the queue, checked by the server, so they cost one look-up and
  leak nothing a Player couldn't know.
- **A block never spins.** A repeat round in which no step could start ends the block, and a
  queue moves through at most one block boundary per tick.
- **Scripts see what they saw:** the current step and its number among the steps top to bottom.
  Blocks, rounds and conditions are not in the scripting API.
- **Limits count what is written:** steps and blocks in the tree, and how deep blocks nest (balance
  numbers).

## Alternatives

- **If as a skip step in a flat list** ("when false, skip the next N steps"). No world format
  change and repeats keep unrolling, but a long repeat still costs its copies, repeat forever and
  repeat until are impossible, and a live edit inside a skipped range is hard to get right.
- **Wait until only, no If.** The smallest change, but every branch still needs a script.
- **Leave it to scripts.** Nothing to build, but the step from queue to script stays steep, which
  is what the planner is meant to soften.

## Consequences

- Queue state changes shape, so `WORLD_FORMAT_VERSION` goes up with a migration step and a test
  (ADR 0006): a saved queue becomes a tree of the same steps with no blocks.
- Queue state stays plain serialisable data and blocks only pick which step requests its action
  next (ADR 0002).
- New invariants (ADR 0004): `current` names a step in the tree, round counters stay within their
  counts, the limits hold.
- Saved queues in the browser that hold repeat blocks load as real blocks; the planner no longer
  unrolls.
- The Wiki's queue section explains blocks and conditions.
