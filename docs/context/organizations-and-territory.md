# Organizations and territory

- **Organization:** anything with its own interests and standing: a Realm, an NPC city, the
  Trade Organization.
- **Realm:** everything one Player controls through their Leader: cities, residents, workplaces,
  carriages. Breaks up into self-managed cities when the Leader dies.
- **Realm name:** what others know a realm by. The Player gives it when the realm is founded (their
  first spawn, and each respawn after a Leader death, since that founds a new realm) and it never
  changes; a Leader handover keeps it. Not the Leader's name. A realm from before realm names
  existed goes by its Leader's name until the Player names it, which they must do the first time
  they rename their Leader.
- **City:** a settlement with residents, buildings and usually a wall. Sizes range from
  **village** to large town. Every city has exactly one town hall; without it there is no city.
  Its shape is derived from its buildings, never drawn.
- **Renaming a city:** a new city gets a name from the game; the Player can rename any city of
  their realm, by hand or from a script: free, instant, from anywhere. Names need not be unique.
  NPC cities keep their names. A city that changes hands keeps its name until its new owner
  renames it. Others learn a new name only by sight (see Last seen).
- **Town hall:** the building that makes a city. Building one founds a new city, belonging to the
  realm whose residents finished it. Tearing it down dissolves the city: its buildings and
  residents stay where they are, and its residents are homeless (a Player can Relocate
  theirs).
- **City building:** a town hall, house, storage, wall, gate or tower (and later ones of their kind;
  a tower since T109.3, decided overnight, Daniel to confirm);
  not farms, workplaces or stables. It is part of a city when it lies within a short distance of
  the city's town hall or of another building already part of that city, so a city grows outward
  in a chain. A building belongs to at most one city: the one whose town hall is nearer (the
  older city on a tie). A building cut off from the chain no longer belongs to the city.
- **City area:** the tiles right around a city's buildings. Building on its edge grows the city;
  tearing down shrinks it.
- **Wall / Gate:** buildings of one tile each, built on any passable tile except Mountain, in
  any shape: a closed ring, an inner ring or a single stretch. Nothing forces a closed ring.
  Walls count as city buildings, so they grow the area like houses do. A wall can be built along
  a line like a road (Build line), skipping tiles that have a wall or gate; a diagonal line closes the way,
  since two wall tiles touching at a corner do (see Step). The map draws each wall and gate tile
  as the whole tile.
  - **Wood or stone:** a wall or gate is of **wood** (from Wood) or **stone** (from Stone, more
    work), and so is a tower. Stone holds out several times longer against blows; it is no
    higher, with the same wall walk. A stone wall can be built on a wooden wall tile: the wooden
    one stands, and can be defended, until the stone one is finished and replaces it. A Build line
    of wall is of wood or stone; a stone line also upgrades the wooden tiles on its way. Starting
    cities' walls are wooden. An NPC city upgrades its wall to stone once it is a town and holds
    a builder's trip of Stone it may spend: the Stone its reserve sets aside for its wall (NPC
    reserve), and beyond that what it holds beyond its reserve (and its founding party's while it
    saves for one: Full city), gate first.
- **Tower:** a 2×2 building, of wood or stone, standing in a wall's line or alone. It closes the
  way like a wall, and its top is part of the wall walk wherever a wall tile touches it. Up on it
  a resident sees further than up on a wall, which grows the Player's Sight, and archers reach
  further still; it gives the wall's cover and holds a few residents up at once (balance numbers).
  It is broken like a wall and holds out longer; those up on it fall when it does. An NPC city
  with a stone wall builds one by each gate, then at its corners; its wall posts fill its towers
  first. While it waits to found a daughter (Full city) it starts no new one, so founding
  comes first (decided overnight, Daniel to confirm).
- **House:** a building in a city's area where a fixed number of residents live (the number is in `crates/csp-shared/src/balance/` and the Wiki). A city's **free housing** is
  its houses' room minus its residents. Houses are the only housing for now; later buildings
  (a palace, a castle) may add room the same way.
- **City layout:** how an NPC city sets out its town: **Grid** (blocks of houses between straight
  streets), **Rings** (houses in circles round the town hall), **Main street** (rows along a road
  from its gate) or **Quarters** (houses, workshops and storages each in their own part). A city
  gets one at random when it comes to be, a self-managed one when its Leader dies, and keeps it. It
  says where houses, storages and workshops (smelter, smithy, mint, stable) go, nearest its home
  first, inside its wall and on outward as the city grows; a spot that doesn't fit is skipped. In Rings only a storage may stand inside the first lane, where a new city's storage stands anyway, so a daughter with just its town hall still finds a spot for it.
  A building whose part of a Quarters city has no room left spills over into another part.
  Streets are real roads, built by its road crew (NPC road) ahead of its other roads, tile by tile
  once its town hall, a house, a storage or a workshop stands beside them. Tiles kept free for streets stay
  free, and a street stops at whatever stands on its line. A stable goes up round the city's horses
  off its streets, unless they already stand on one, as nobody leads them anywhere. Walls, gates, farms and workplaces on
  nodes go where they do anyway. A city from before layouts got one when they shipped: nothing is
  torn down, and new buildings follow it around what stands. Trading posts, the HQ and Players'
  cities have none.
- **Food surplus:** a city has one when its storage holds more Food than all its residents eat
  in a set number of game days. Food that residents carry doesn't count.
- **Storage:** a building where goods are kept. In a city's area it is that city's storage and goes
  with the city.
- **Outpost storage:** a storage that is part of no city. It belongs to the realm whose residents
  finished it, like a town hall does, and counts as a storage of that realm everywhere (Store,
  Fetch, Carrying the output, Fetching materials, carriage stops). It founds no city and has no
  city area; once a city grows to include it, it is that city's storage. Its stock is guarded like
  a workplace: while an armed resident of its realm is at it and none of anyone else's, nobody
  else can take from it; unguarded, anyone at it can, and for another organization that is theft.
  Tearing it down against its realm is a crime too.
- **Refilling at an outpost storage:** a resident of its realm within a short distance of an
  outpost storage who is running low on food takes a meal from it, as at home, without an order.
  A stocked outpost storage next to a remote workplace keeps its workers fed.
- **At home:** a resident standing in the area of a city of their own realm; for a resident of an
  NPC city, in the area of that city.
- **Integrating:** bringing a village or city into your realm, with its residents. Three ways:
  **conquer** it (capture by force), **buy** it, or **persuade** it (with high standing and
  respect it asks to join).
- **What joins with a city:** however a city joins a realm, its horses and carriages come with
  it. An NPC city's are all its own, wherever they stand. A Player's aren't tied to one city, so
  of those the ones in its area or at its stables join. Either way a horse a joining resident
  rides, and a carriage one drives, joins with them, and a carriage's hitched horse with it.
- **Buying a city:** an NPC city names a price in Coins from what it is worth (its residents and
  buildings). The buyer's residents carry the coins to its town hall; once they are all there,
  the city joins the buyer's realm with everything in it, and the coins are gone: they are used
  up by the deal, not kept by anyone. The better its standing toward the buyer, the lower the
  price; at very bad standing it won't sell to them at all.
- **Alliance:** a group of Organizations that agreed to join: Players' realms and NPC cities,
  never the Trade Organization. A realm is in at most one. Members share sight, pass each other's
  gates and stand on each other's walls. Members' armies by default don't attack each other, but
  a direct order can (that counts as a crime). Leaving, or being removed, takes effect after a
  delay. A realm whose Leader dies leaves at once.
- **Alliance leader:** the member who founded the alliance or was handed the role. Invites and
  removes members and commands the alliance army; nothing else. When they leave or die, the
  longest-standing member takes over.
- **NPC city in an alliance:** accepts an invitation when it holds every member in high standing
  and knows of no recent crime by them against it; leaves on its own when its standing toward
  any member falls too low. It keeps its own behaviour. It also invites on its own (Acting first).
- **New realm's shelter:** no NPC city sends a demand to, or marches on, a realm in its first game
  weeks. Players can. Decided overnight 2026-11-17, Daniel to confirm: a realm's weeks count from
  when it began; a realm from before that was kept has none.
- **Alliance army:** soldiers and carriages members hand over to the alliance leader's command.
  They stay in their own realm but take orders only from the alliance leader. Their owner can
  recall them, which takes effect after a real hour; leaving the alliance recalls them.
- **Territory:** the area an Organization controls. Derived, not claimed: cities and guarded
  workplaces project control around them according to their size and garrison; where they
  overlap, the stronger wins. A workplace is **guarded** while an armed resident of whoever
  holds it stands on or next to it. Territory is shown only: no rule depends on it (for now).
- **Region map:** the map view colouring territory by owner. Alliance members show in the
  alliance's colour; details show which member holds each part. Territory is common knowledge:
  it shows live over all explored terrain.
