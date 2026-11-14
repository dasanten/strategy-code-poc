# One reset for a world with scarce land

Status: decided (2026-11-14, with Daniel). Sets ADR 0006 aside once. Rules in `CONTEXT.md` under
**The land**, **Region**, **Heartland**, **Frontier**, **Island**, **Richness**, **Rare goods**,
**Running dry** and **Starting site**; built in Epics 100 (A new world), 101 (Rich and poor land)
and 102 (Veins run dry).

Daniel, 2026-11-14: the game loop ends fast and then gets boring. The rules say why. Resource nodes
never run out and every kind lies near everyone, so nothing is scarce. Starting cities stand at
least 1,200 tiles apart on a map that takes 12 real hours to walk round, so Players never meet.
Territory is shown only. Games that are played for years (EVE Online, Albion Online, Screeps,
Travian) put the best resources where they have to be fought for, keep the starting areas poor and
safe, and keep the valuable land moving.

## Decisions

- **The world is generated again, once, with nothing carried over.** Daniel: "see this as a full
  game reset so no migration for anything needed". The new map can't be reached by migrating the
  old one: every city, road and explored tile stands on land that is no longer there. ADR 0006
  holds again from the reset on.
- **What the reset keeps** belongs to the Player, not the world: accounts, admin rights, unused
  invite codes and each Player's script library with its history. Everything in the world goes:
  the map, realms, cities, residents, horses, goods, standing, contracts, alliances, demands,
  explored terrain, Last seen and realm logs. The Horse offer and the First day card are given
  again. On their next login every Player founds a new realm, as after a Leader death.
- **Epics 100 to 102 ship with the reset and write no migration.** They change the shape of the
  map and of resource nodes. Each still bumps `WORLD_FORMAT_VERSION`, so a save from before the
  reset is refused, never loaded half-right. The reset is run on the live game by Daniel, at the
  release that carries all three.
- **One joined mainland, islands only by vessel.** Regions of the mainland are parted by Mountain
  ranges and arms of the Sea and joined by a few passes and land bridges. The richest nodes are on
  islands.
- **Players start together.** Heartlands have starting sites 20 to 40 real minutes apart, and a
  new Player goes to the open heartland with the most Players.
- **No rule protects a heartland.** It holds only poor nodes; the game still forbids nothing, and
  the Trade Organization stays no police.
- **Richness scales output.** Poor, normal, rich; farms the same everywhere.
- **Two rare goods:** Coal (new, for Steel and better weapons and armour) and Gold ore, neither in
  a heartland.
- **Only normal and rich ore nodes run dry.** A dry node is gone and a new one appears elsewhere,
  unseen.

## Alternatives

- **Every cluster of Players on its own island.** Stronger isolation, but horses and carriages
  can't go aboard a vessel and NPC cities build no havens (ADR 0031), so caravans, wandering
  traders and NPC traders could reach nobody. It would need at least one more epic before the
  reset.
- **Spread new Players evenly over all heartlands.** More room each, but with few Players it is
  today's problem again.
- **The trading post's soldiers defend young starting cities.** Safer, but it makes the Trade
  Organization a police force and needs a rule for when a city stops being young.
- **Richness as more worker slots.** Rewards only realms that already have residents to spare.
- **Salt as a second new good** (salted Food that keeps). A good fit for armies and ships; left for
  a later epic to keep this one thin.
- **Every node runs dry.** More consistent, but a heartland Player could be left with nothing in
  reach, and forests would need a rule for growing back.
- **Migrate the old world onto the new map.** Not possible in any honest way, and nobody asked for
  it.

## Consequences

- Fixture comparisons of generated terrain and of worlds generated on it (the frozen output of the
  TypeScript server) no longer hold. Each is replaced by a Rust test of the new rule, as
  `CLAUDE.md` says, and the PR says so.
- "All land is joined" is now true of the mainland only. Path finding to or from an island finds no
  way on foot, as it finds none onto water today.
- NPC cities, the Trade Org HQ, trading posts, caravans and wandering traders all stand and move on
  the mainland.
- "NPC cities fight for what they lack" is not part of these epics. It is an open question of
  Epic 98 (NPC cities with intent), which scarce land gives a reason to answer.
