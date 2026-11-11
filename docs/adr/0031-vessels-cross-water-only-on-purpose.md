# Vessels cross water only on purpose

Status: decided (2026-11-11, with Daniel). Rules in `CONTEXT.md` under **Water**; built in Epics
90 (Havens and boats) and 91 (Ships).

Lake and Sea have been impassable walls in the world since the start, and all land is joined, so
water only ever made walks longer. Havens, boats and ships turn it into a way to travel and haul.

## Decisions

- **Two kinds of vessel.** A boat is small, rowed by one resident, goes on Lake and Sea and lands at
  any shore. A ship is big, needs a minimum crew, sails only on Sea and docks only at a haven.
  Both are built at a haven, the stable of the water.
- **Crossing water is always an order.** Walking never uses a vessel: residents board, someone rows
  or sails, they get off. Path finding on land stays as it is; scripts and the Player decide when
  water is worth it.
- **A vessel is a carriage on water.** Boarding, loading, passengers, refilling, stealing and the
  haul route work as for carriages, with "beside the vessel" (a ship: at its haven) in place of
  "on its tile".
- **Out on the water nobody fights.** Those aboard can be struck only from beside the vessel; there
  are no fights between vessels yet.
- **Residents and goods only.** No horses or carriages aboard, and NPC cities don't use the water,
  for now.

## Alternatives

- **Ferrying by itself:** walks plan over water and use any boat nearby. Shorter walks for
  everyone, but path finding over two kinds of ground and whose boat waits where makes every walk
  dearer and harder to predict, against ADR 0016's cheap ticks.
- **One kind of vessel.** Simpler, but either lakes stay useless (a ship only) or hauling over sea
  is no better than a carriage round the coast (a boat only).
- **Ships land anywhere.** Fewer buildings, but then a haven is only a boatyard, and havens as
  the ports where goods change hands is what makes sea trade a place on the map.

## Consequences

- World state gains vessels (a new kind of thing on the map), so `WORLD_FORMAT_VERSION` goes up
  with a migration step (ADR 0006).
- A boat away from every shore is a refuge from fighting, which Bandits (Epic 16) must respect.
- Carrying horses, NPC havens and naval fights are later epics if they are wanted.
