# Sight

- **Sight:** what a Player currently sees: everything within sight range of any of their
  residents, or of any resident of an alliance they belong to. People, goods, buildings,
  horses, carriages and armies are only visible in sight, a Player's own included.
- **Seeing inside a storage:** what a storage, warehouse or stable holds is seen only by its own
  realm and its allies, and by anyone with a resident at it. From further off others see only the
  building (and a warehouse's or NPC city's prices, where those are shown).
  A carriage's load goes the same way, with a resident on its tile; from further off others see
  only how heavily it is loaded.
- **Seeing how someone fares:** a resident's or horse's hunger and health are seen only by its
  own realm and its allies. Others see that it is there.
- **Explored terrain:** tiles a Player has ever had in sight. Their terrain and resource nodes stay
  known, and so do the buildings on them (see Last seen) and the region each lies in, its name
  and kind, and whether it is a pass or land bridge (Region); people, horses, carriages, armies and
  goods on them do not. Where the map shows explored terrain coarser than tile by tile (zoomed far
  out, on the minimap), a square shows the most common terrain among the tiles the Player explored
  in it, and stays unexplored only while they explored none of it: nothing of an unexplored tile
  is ever shown (ADR 0034).
- **Last seen:** a building or construction site a Player has had in sight (their own included)
  stays on their map after it leaves their sight, as it was when they last saw it: where it
  stands, what it is, who held it and which city it belonged to (by that city's name then), along with whatever else they
  were allowed to see then (its prices, what it held). It is marked with when they saw it and
  always shown apart from what is in sight now. It changes only when it comes back into sight:
  once any tile it stood on is in sight again, the Player sees what is there now, and a building
  that is gone is forgotten. A city stays remembered while any of its buildings does. Things that
  move are never remembered. Like explored terrain, it grows only from sight: joining an alliance
  does not hand over what its members saw before, and leaving one keeps what was seen through it.
  Last seen is brought up to date once every few ticks for each realm, staggered across realms
  like NPC planning (ADR 0016), not every tick: a building that leaves sight between two refreshes
  is remembered as it was at the last refresh, up to those few ticks earlier. What is in sight now
  is unaffected.
