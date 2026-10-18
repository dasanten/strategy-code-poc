# Hybrid control: UI orders plus optional scripts

Status: decided (2026-10-18, with Daniel)

Players control the world in two ways: through **UI orders** for common jobs (assign residents
to a mine, set up a supply route, station a guard) and through **scripts** in our own language
as an optional power tool for automation. Both go through the same path: they request actions,
and the simulation resolves them each tick under the same physical rules. A UI order is not
allowed to do anything a script couldn't, and vice versa.

## Why

The world is large and everything moves physically, so a player runs many things at once while
offline. Scripts handle that, but a pure scripting game shuts out players who just want to play
the strategy game. Pure point-and-click would throw away the script language and the automation
it enables.

## Consequences

- The game API is the single source of truth. UI orders are implemented as built-in behaviours
  on top of the same actions scripts use.
- The script language stays in scope (ADR 0001), but the first playable slices can ship with
  UI orders only. Scripting is built last, so everything before it must keep adding it cheap:
  - Every action and world query lives in one game API (in `packages/shared`), with
    plain-data inputs and outputs, no UI or server types.
  - An order is a small piece of logic that each tick reads world queries and requests actions,
    exactly what a script will do. Orders never mutate the world directly.
  - Per-resident order state is kept in a plain, serialisable object, the same shape as a
    script's `memory`.
  - The client never computes outcomes; it only sends orders.
