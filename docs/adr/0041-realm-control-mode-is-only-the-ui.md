# Realm control mode is only the UI

Status: decided (2026-11-18, with Daniel). Rules in `CONTEXT.md` under **Control mode**, **Realm
order** and **Who-list**; built in Epic 112.

## Context

Until now every order starts from a picked resident or group: who first, then what and where
(unit control mode). Daniel wants a second way to play: say what is to be done and where (build a
house here, a storage there), then who does it, picked from a list if he wants.

## Decisions

- **Two control modes, one switch.** Unit | Realm on the HUD, kept per browser, starting in unit
  control mode. In realm control mode a map click picks buildings and tiles, never residents, so
  the two modes don't fight over a click.
- **A realm order is a group order whose group is picked last.** After what and where, the
  who-list suggests the nearest idle residents, already ticked; confirming sends each of them the
  same order request the group card sends. Nothing new is kept in the world: no format bump, no
  backend work, nothing new for scripts (ADR 0002) and nothing an NPC city needs.
- **Far residents walk first.** For an order bound to the target's tile, a ticked resident who is
  elsewhere gets a queue (walk there, then the order) instead of being skipped as on a group
  card. The queue is the one that exists (ADR 0032).
- **Busy residents choose Now or After**: replace what they do, or append to their queue.
- **Every order with a target** can be a realm order, from the realm bar (those that begin with a
  kind or a place) or from the card of what was picked (those about it). Orders without a target,
  fighting and armies stay in unit control mode.

## Considered

- **Realm jobs kept in the world** (a site or task belongs to the realm, and idle residents take
  it up by themselves, now or later). Closer to a city builder, but it is a new simulation rule:
  a format bump, work in the Rust backend, invariants, and a second planner beside scripts and
  queues deciding what residents do. Not now; the who-list's suggestion gets most of the feel
  for none of that. If it comes later, it replaces the suggestion, not the mode.
- **The Player must always pick who.** Then realm mode is only the same steps in another order,
  and the common case (anyone nearby will do) costs clicks.
- **No switch: the mode follows what is picked.** Residents would still win the click on a
  crowded tile, which is what makes placing buildings in a city fiddly today.
