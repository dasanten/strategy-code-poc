# Water

Settled with Daniel on 2026-11-11 (Epics 90 and 91).

- **Water:** Lake and Sea tiles. Residents never step onto them; boats and ships move only on
  them.
- **Haven:** a building on the shore where boats and ships are built, the stable of the water.
  Footprint 3×3, on passable land other than Mountain, with at least one footprint tile touching a
  Lake or Sea tile, straight or diagonally. Built of mostly Wood and some Stone. It has a storage,
  so ships load and unload there as a carriage does at a storage. Like a stable it has no owner:
  any boat lands there and anyone at it loads or unloads, and taking goods from its storage is
  judged as at any storage. NPC cities don't build havens, boats or ships (for now).
- **Boat:** a small rowed vessel, built at a haven. It needs no horse: a rower moves it, as a
  driver moves a carriage. It carries a few residents and a little cargo, on Lake and Sea, and
  lands at any shore.
- **Vessel:** a boat or a ship. A vessel always stands on a water tile, one vessel per tile.
- **Building a boat:** a resident at a finished haven lays out a **boat site** on a haven tile
  that touches the water. It is a construction site like any other (materials, mostly Wood, and
  work; fetching materials, no owner, finished by anyone, torn down leaving all its materials).
  Once finished it is gone, and an empty boat of the realm of the resident who finished it floats
  on the nearest free water tile next to that site.
- **Beside a vessel:** on a land tile touching the vessel's water tile, straight or diagonally.
  Residents beside a vessel **board** it (card, group card, queue step, script) and put goods on
  it or take goods off, up to what it holds; passengers count as a fixed weight against that, as
  on a carriage. A passenger **gets off** onto a free land tile beside it. A boat does this at
  any shore; a ship only at a haven (Ship).
- **Seafaring:** the skill of moving a vessel. Rowing (and later sailing) teaches it; a more
  skilled rower goes faster, and so does a stronger one.
- **Rowing:** an order (as a script could do it) for a grown resident aboard a boat of their
  realm, or beside it (they board first), to row it to a water tile; given a land tile, it goes to
  the nearest free water tile beside it. The boat moves a Step at a time over water, and a
  diagonal Step can't squeeze between two land tiles. The rower isn't a passenger and doesn't
  count against the load, like a carriage's driver. A boat nobody rows stays where it is; it
  never drifts. Rowing costs food as walking on Plains does. The rower and passengers eat their
  own food and, running low, take a meal from the boat's Food (Refilling from a carriage).
  Rowing off in another organization's boat steals it (Stealing a carriage or horse).
- **No ferrying by itself:** walking never uses a vessel; a walk still goes round on land.
  Crossing water is always boarding, rowing (or sailing) and getting off, by the Player or a
  script. Giving a passenger a walk or an order that acts on a tile gets them off first, as on a
  carriage.
- **Vessels in sight:** a vessel shows to whoever has its tile in sight, like a carriage; those
  aboard see from its tile as usual, so rowing along a coast explores it.
- **Fighting at a vessel:** those aboard can be attacked by anyone beside it, as if the vessel
  were the next land tile, and fight back; Down or dead, they stay aboard. There are no fights
  between vessels and none from open water (for now), so a vessel away from every shore is out of
  reach.
- **Haul route by water:** the Haul route with a vessel: a ship between two havens, its captain
  loading at the first, sailing, unloading at the second and coming back while the rest of the
  crew stays aboard; a boat with havens or shore tiles as stops, loading at a shore from the pile
  beside it. Boats have haul routes now (T91.5): the rower starts on the shore beside the boat,
  gets off at each stop to load and unload it by hand from beside it, then boards and rows on.
  A ship's haul route comes with T91.4.
- **Ship:** a big sailed vessel, built at a haven, carrying far more than a carriage. It sails
  only on Sea, needs a crew of several residents, and docks only at a haven: loading, unloading,
  boarding and getting off happen there. A haul route runs between two havens.
- **Building a ship:** as Building a boat, with a **ship site** at a haven touching Sea, on a
  haven tile that touches Sea. It takes Wood and some Iron and far more work than a boat. The ship
  floats on the nearest free Sea tile next to the site.
- **Docked:** a ship on a water tile touching a haven's footprint. Only docked, and only from
  that haven, do residents board it, get off it or load it; those at the haven move goods
  straight between the haven's storage and the ship. Beside a vessel means, for a ship, at the
  haven it is docked at.
- **Crew:** residents of the ship's realm aboard as crew rather than as passengers (boarding as
  crew is its own choice on the card, queue step or script). Crew don't count against the load. A
  ship sails only with at least a minimum crew aboard (a balance number). The crew's Seafaring
  makes it faster, and sailing teaches Seafaring to the whole crew. Crew and passengers eat as on
  a boat.
- **Sailing:** an order (as a script could do it) for one of the crew, the **captain**, to sail
  the ship to a haven (docking there) or a Sea tile, a Step at a time over Sea only, never onto
  Lake. Stealing a ship takes sailing it off with a minimum crew of the thief's realm aboard.
- **What vessels carry:** residents and goods only. No horse or carriage goes aboard (for now);
  residents a ship brings to a far coast arrive on foot.
