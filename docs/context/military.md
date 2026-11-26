# Military

- **Soldier:** a resident with a weapon equipped; Combat skill makes them better. Not a separate
  kind of being; soldiers eat, carry, age and die like everyone. **Armed** means having a weapon
  equipped: a spare Sword in the pack doesn't make a soldier.
- **Weapons and armour:** goods like any other, with weight: **Spear** and **Sword** (attack),
  **Bow** and **Crossbow** (ranged), **Shield** and **Armour** (defence), the Sword, Shield and
  Armour also of **steel**, each better than the iron one and as heavy (the Spear is iron only).
  **Arrows** are a good too, used by bows and crossbows alike.
- **Equipment** (ADR 0038): each resident has three slots: **weapon**, **shield** and **armour**, one item
  each. Only what is equipped counts in combat; equipped goods still weigh what they weigh, so
  heavy gear leaves less room for food. A resident with an empty slot equips the best fitting
  item at once when they pick one up; swapping or taking one off is done from their card or by
  script, takes a few ticks, and they can't strike meanwhile. A Bow or Crossbow takes both hands:
  with one equipped the shield slot stays empty. **Seeing it:** anyone who sees a resident (Sight)
  sees what they have equipped, its kind and whether iron or steel, on the map and on their card;
  what they carry unequipped stays hidden like any goods carried, except from anyone with a resident
  on their tile (as a carriage's load).
- **Smithy:** a workplace that turns Iron and Wood, or Steel and Wood for the steel ones, into
  weapons and armour, at fixed recipes: a Bow from Wood, a Crossbow from Wood and Iron, Arrows
  from Wood and a little Iron,
  from what its workers carry and the pile on its tile. Each worker's work order says which of
  them they make; they can switch. Teaches Smithing.
- **Ranged combat:** an armed resident with a Bow or Crossbow shoots anyone they may strike whom
  they see (Sight) within their weapon's **reach**, in tiles, contact included; each shot uses up
  one Arrow they carry, and out of Arrows they fight with their fists. A Bow shoots faster and
  further and gets much better with Combat skill; a Crossbow shoots slower and less far but hard,
  through part of the target's armour, and needs little skill. Nothing blocks a shot for now. Up
  on a wall walk an archer's reach grows, and up on a tower more (Walls in combat). The Defence and
  Alarm defaults have an archer shoot from where they stand rather than walk into contact. Scripts
  see each weapon's reach and the Arrows a resident carries. NPC cities with a smithy arm some of
  their soldiers with bows and keep Arrows in their reserve; their archers take wall and tower
  posts first.
- **Wear** (Epic 97): weapons, armour and Tools don't last for ever. A weapon wears with each blow
  it strikes or shot it looses, a shield or armour with each blow it takes, and all of them a
  little in training; Tools with each day's work (Tools). Worn out, a piece **breaks** and is gone. It fights as well as new until then. Its
  **condition** reads in words: good, worn, nearly broken. Only the realm carrying it (and its
  scripts) sees that; anyone else sees just its kind and metal. A worn piece sells and buys for
  less, a nearly broken one for much less.
- **Mending:** a smithy worker mends a worn weapon, piece of armour or set of Tools back to good, for a share of
  its recipe and in less time than forging it. An NPC city counts only pieces in good condition
  towards its reserve and mends the rest. A smith set to mend takes the most worn piece at the smithy: on its pile,
  carried by its workers, or carried by anyone of their side standing on it, so a soldier brings
  their worn sword there. An NPC city's soldier with worn gear takes it to the city's smithy with
  what mending it takes and waits there; one of its smiths mends, or with none, an idle hand, else
  a worker from another of its workplaces (a farm's last). (Decided overnight, Daniel to confirm.)
- **Army:** a named group of a realm's residents moving and fighting together under one order or
  script, at the pace of the slowest. A resident leaves it when given an order of their own.
  Needs a supply line or it starves far from home.
- **Supply line:** a carriage that follows an army is its supply wagon: army members refill from
  it like at home (Refilling from a carriage). A haul route can have an army as its second
  stop, so food keeps coming to wherever the army is. Cut the route and the army starves.
  At its army stop the carriage unloads nothing: it stays with the army, which refills from it,
  until the hauled goods are gone, then goes back for more. Nothing comes back from an army.
  A supply wagon's driver, not being of the army, refills from the carriage like anyone aboard
  (Refilling from a carriage).
- **Combat:** resolved between residents in contact (the same or a neighbouring tile). Attack
  from Strength, weapon and Combat skill; Agility dodges, armour and shields take off damage.
  Fighting teaches Combat. **Under attack:** a resident who is struck runs their Defence script
  (Control): by default they fight back when armed and go home when not, and then go on with
  what they were doing. Scripts see who last struck a resident and when (`struckBy`, `struckAt`),
  as far as the Player may see how that resident fares.
  A trading post's and the HQ's soldiers fight attackers in its area on their own; every other city's
  armed residents go by the Alarm script (Alarm).
- **Walls in combat:** nobody walks through a wall. A **gate** lets the city's realm and its allies through always, everyone else
  only while it is open; the city's realm opens and closes it. A wall or gate can be **broken**
  (attacked until it falls, leaving part of its materials) or **climbed** (slow, and a climber
  can't defend themselves, so a defended wall is costly to climb). Climbing a city's wall attacks
  it: it raises the alarm there as a blow at it does.
  - **Wall walk** (ADR 0036): every wall, gate and tower tile has a walk on top, unbroken round the ring
    (people pass under a gate on the ground). A resident on it is **up**. Only the city's realm
    and its allies get up, from the ground next to the wall, and getting up or down is slow (a
    balance number each way); along the walk is walking. They come down only to the side they
    came up from, so the walk is never a way through the wall. A path that ends on the wall or
    runs along it counts the time to get up and down, so people go up only when sent: a wall or
    tower post, an order or a Move to a wall tile.
  - **High ground:** someone up strikes down at anyone on the ground next to the wall; nobody on
    the ground can strike anyone up, only the wall, gate or tower itself, or climb it. Archers on
    the ground can shoot those up (Ranged combat). Up against up (a climber who made it, two walls
    touching) fights as anywhere. Whoever is up on their own city's wall takes only a share of
    every blow and shot (the wall's cover).
  - **A tile breaks:** whoever is up on it falls to the ground on its inside and takes a fall's
    damage.
  - **Siege machines:** a ram's crew under its roof can't be struck from above nor shot (Siege
    machine).
- **Siege machine:** a machine of a realm built in the field as a construction site from goods
  carried there (ADR 0037). Once finished its **crew** of a few residents pushes it, slowly, like
  a carriage with no horse. It can be broken by blows, leaving part of its materials. Scripts can
  order a crew to push, aim and shoot. NPC cities and the Trade Organization don't build them, for
  now.
  - **Ram:** of Wood and some Iron. Next to a wall, gate or tower it strikes it many times harder
    than a blow. Its crew under its roof can't be struck from above nor shot; defenders who come
    down and out can attack the ram, or its crew in contact.
  - **Catapult:** of Wood, Iron and Stone. It throws one Stone a shot at a wall, gate or tower
    within a long reach, beyond a bow's from a wall. It hits buildings only, not people. Its crew
    stands in the open. The Stone it throws is what its crew on its tile carry, then what lies in
    the pile on its tile (the machine itself holds no goods); out of Stone it stops. It is aimed
    at a building or at a tile of one. *(Decided overnight, Daniel to confirm.)*
  - **Ramming and throwing attack:** swinging a ram or throwing with a catapult at a city's wall,
    gate or tower strikes its owner, as a blow or a climb does: striking its crew there is no
    aggression, an NPC city counts them as attackers, and residents lent by an NPC city never ram
    or throw at its walls. Pushing the machine up is no attack: nothing is struck yet.
- **Loot:** when a resident dies, everything they carried drops on the ground for anyone to take.
- **Capturing a city:** only by occupying its town hall for a set number of game days without a
  break (Occupying a town hall; ADR 0017). When the time is up, the city and its residents join
  the occupier's realm, loyal at once (for now). Beating its defenders is not enough on its own.
  Every city is captured this way: NPC cities, Players' cities, trading posts and the HQ (Fall of
  the HQ).
- **Occupying a town hall:** armed residents of one realm stand on a city's town hall (any of its
  tiles), no armed resident of any other realm stands there, and no defender of the city does
  (one on its side: its realm, an ally, or for an NPC city its own residents). An ally of the
  occupier on the hall counts as another realm, so nobody occupies it. The occupation starts the
  tick that holds and runs as long as it keeps holding; the first tick it doesn't, it is broken
  and its days are lost: the next one starts again from nothing. The city goes on as before
  meanwhile; its soldiers fight the occupiers (Alarm; a trading post's and the HQ's on their own),
  which is no crime. Its realm's log says when its town hall is occupied, by whom, and when the occupation is broken. Anyone
  with the town hall in sight sees who occupies it and how long is left; scripts see it too.
- **Mercenary contract:** one Organization rents residents to another for coins over a period.
  One side offers (residents, game days, price per game week, a storage of the lender to pay
  into), the other accepts. The residents stay in the lender's realm but take only the hirer's
  orders; they always obey (for now). Each week is paid in advance: the hirer's residents put the
  coins into that storage with a pay order, or a Trade Org transfer brings them. A week left
  unpaid breaks the contract and costs standing; at the end, or when it breaks, they walk home.
- **Hiring from an NPC city:** an NPC city never offers on its own. Like the Trade Org army, a
  Player asks it for a number of its residents for some game days, paid into its storage. It
  accepts at once when the price per resident and week is at least its asking price (moved by
  its standing like its trade prices) and it can spare them, and declines otherwise. It lends
  only its spare hands (Spare hands' work): adults idle, on a road crew, scouting or working for
  surplus. Its farmers, those working for a good short of its reserve and its builders with a
  project stay, and so does a share of its adults at home to defend it. Its lent residents take
  weapons and armour along only from its surplus, what its storages hold above its reserve (NPC
  reserve), the best of the surplus first, so steel before iron; with none spare they go unarmed.
  It lends nobody while it feels threatened: while it
  weighs a demand (Demand), while its town hall is occupied, or while armed residents of the
  hirer stand in its area or in sight of it. Those it lends never act against it: they refuse an
  order to attack its residents, walls or gates, to climb, ram or throw at its walls or to tear down its buildings,
  they can't occupy its town hall, and they never count as the hirer's fighters toward it
  (Respect). Paying
  and ending go as in any mercenary contract: each week in advance into that storage, an unpaid
  week breaks it and costs standing, a paid one raises it, and at the end they walk home.
- **Trade Org army:** a large army of normal residents of the Trade Org HQ, for hire like any
  mercenaries. The HQ builds it itself: it arms its own adults with weapons from its goods
  warehouse, steel as far as it holds it (its soldiers fetch the steel Sword, Armour and Shield and
  put back what these outdo), iron otherwise (a trading post arms its soldiers the same way from
  its warehouse), until it has its army's size, keeping enough of them at work. Its warehouses refill
  goods, never people, so lost soldiers come back only as new adults grow up, or as mercenaries.
  - **Hiring it:** in mercenary contracts the Trade Organization is a side like a realm. A Player
    asks for a number of its soldiers, paid into a Trade Org warehouse they name; it accepts at
    once when the price is at least its price per soldier and week and it can spare them, and
    declines otherwise. It never hires out so many that fewer than its guard stay at the HQ.
    Hired soldiers take the hirer's orders where they stand; getting them where they are needed
    is the hirer's business.
  - **Guarding the inner ring:** anyone not of the HQ on or inside its inner ring is an
    outsider: Players' residents, unarmed ones and its own hirers' included. The HQ's soldiers
    attack every outsider there until they are dead or gone; that is never a crime. The inner
    gates stay closed; the HQ's own residents pass them.
  - **Hiring mercenaries:** when its soldiers, the adults it could still arm and the mercenaries
    it has hired fall below a share of its army's size, it has lost too many: once a game day it
    asks Players' realms for their armed residents nearest the HQ (never a Leader), as many as
    it lacks, at its own price and length, paid into a storage of theirs. The Player accepts or
    declines like any offer. It pays each week in advance from its coin warehouse straight into
    that storage, like a transfer. Its mercenaries walk to the HQ and stand guard outside the
    inner gates, fighting whoever attacks the HQ; while in its area they eat from its storage.
