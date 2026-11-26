# Control: orders and scripts

- **Order:** an instruction a player gives through the UI (e.g. "work this mine"). It requests
  the same actions a script could. A one-off step (walk there, pick up, attack) is a single
  action; a **task** that repeats or decides (work, build, haul, tear down) runs its default
  script.
- **Script:** a program in the game's own language that requests actions automatically, every
  tick. A Player keeps a library of named scripts, with their history, also across Leader deaths.
  **Running a script** is an order for a resident or an army: the script runs once a tick for
  each of them, with its own memory, and can request only what that resident or army could. Any
  other order ends it. A script can hand over to a built-in order for a while and take control
  back. **Waiting:** a script may call `wait()`: it is not run again until its current order ends,
  is replaced, or the resident is struck (Defence script); then it runs every tick again. The
  game's defaults wait after every walk, store and fetch, so a resident on the move costs no
  script run; an edited copy of a default behaves like the default. A script ends itself by
  calling `end()`: the resident stands idle, and in a queue its next
  step starts. `end(reason)` also notes the short reason in the realm log ("Ana stopped Work: no
  workplace on her tile"). The defaults end that way when their target is missing or gone; the
  Build, Tear down and Breed horses defaults also end once the site is finished, the building is
  gone or the foal is born. A script's own runtime error stops it for the tick and it runs again
  next tick; an error of the game's own while running it ends the script like `end()`, noted
  once in the realm log, and the rest of the tick goes on for everyone else. A saved change is
  picked up on the next tick: each save is a new version, and the
  newest one without syntax errors is the **active version** that runs. A version with syntax
  errors stays in the history but never becomes active; the Player can make an earlier version
  active again. **Deleting versions:** any version but the active one can be deleted for good,
  one at a time or all those older than the active one at once; the others keep their numbers.
- **Library cap:** a Player's library holds at most so many scripts, and each script so many versions,
  the defaults' versions included. A save past either cap is refused and says to delete versions or
  scripts first. The caps are listed in the Wiki.
- **Script parameter:** a value the Player picks for whoever runs a script, declared by a
  `param name: type` line at the top of the script and read there as `params.name`; a `param`
  line anywhere else is a syntax error. A `building` param holds a building the Player knows: a workplace or construction site
  anywhere in sight or last seen, whoever built it (a workplace has no owner), or any other
  building of the realm's own; a `storage` param one of its storages, stables or carriages; a `number`
  param a whole number of zero or more, typed into a number field; a `choice` param one of the
  words its line lists (`param toward: choice(north, east, south, west)`), picked from a list;
  a `waypoint` param one of the Player's waypoints. A `number` or `choice` param may declare a
  **default** (`param foodAt: number = 3`); `building`, `storage` and `waypoint` params can't. The values
  are kept for each resident and each script (at a workplace, see Workplace settings): giving the task again keeps them, a param removed
  from the script is dropped, a new one starts unset. Unset, or once the one picked is gone (or no
  longer the realm's), it reads its default, or `null` without one; clearing a field goes back to
  the default. **Starting at once:** giving a task or Run script starts it at once with the kept values or
  the defaults. **Before it starts:** a Customise button beside the order opens the form with those
  params, filled the same way, and Start gives the order with them; it opens by itself only when a
  param has no default and no `none:` in its comment, since the script has nothing to go on without
  it. The form fits a phone screen. The resident card shows one field
  for each param of the script the resident runs, picked on the map and cleared with a button;
  picking one doesn't end the script. **Param comment:** the `//` comment at the end of a `param`
  line says what the param is for and, after `none:`, what the script uses while none is picked;
  each field shows it and the value the script uses: the one picked, else a `number` param's
  default, a default script's target the one on the resident's tile, or what the comment says
  after `none:`. The Work default declares `storage`, its main storage, and three `storage` params
  that, when set, take its place for one use: `output` (where the output goes, Carrying the
  output), `input` (where a smelter's, mint's or smithy's inputs come from, Fetching inputs) and
  `food` (where Food comes from, Getting food and Crew food). The Build default declares `source`
  (where materials come from, a carriage too); a source picked that holds none of what the site
  lacks is left alone, and they just build. Unset, each falls back to the main one, then to the
  nearest storage. Work, Build, Build line and Tear down also declare `food` and the `number`
  params `foodAt` and `foodTake` (Getting food).
- **Store:** a built-in order a script can hand over to: the resident walks to a storage,
  stable or carriage of their own (by default the nearest storage of their realm), puts down the
  chosen goods there (Food only beyond their own food, unless asked for exact units) and, at a
  storage with Food, tops up their own food. Then it is done. It ends early when there is no way
  there or the place is gone, and the script can read how it ended.
- **Fetch:** a built-in order a script can hand over to: the resident walks to a storage, stable
  or carriage of their own (by default the nearest storage or carriage of their realm holding the
  goods) and takes the chosen goods there, as much as is there and fits. Then it is done; it ends
  early like Store. Who stores or fetches, and when, stays in the script.
- **Default script:** the script behind a task the UI can give (working a workplace, building,
  hauling, …). The game ships one per task; giving a resident that task from the UI runs it.
  Each Player has their own version of every default script in their library, one per task,
  for all their residents doing that task; editing it changes how they all do it, with history
  like any script. **Resetting** it makes the game's current default its newest version again.
  Until the Player edits it, their version follows the game's default as the game improves it;
  once edited it stays theirs, and they are told when the game's default has changed since.
  Default scripts can't be renamed or deleted. NPC cities always run the game's defaults. Each
  default reads top-down: a short main block first saying what happens in order, then a named
  `fn` for each step, with plain names and no tricks (the game API's `floor` and `pickRandom`
  help there). Shared pieces such as Getting food are copied into each default that needs them.
  **Started directly:** a default script's target is a param: Work's `workplace`, Tear down's
  `building`, Feed the stable's and Breed horses' `stable` (Breed horses then picks the pair as
  Breeding says, a paused pair first). Giving the task from the UI fills
  it; unset, it is the one on the resident's tile when the script starts, kept until it ends. So
  running the same script with Run script or as a queue step works like giving the task.
  Build's is `site`, a construction site to join; laying out a new one (its kind and place)
  stays the Build order's. Haul's is `carriage`; its route (where to, which goods) comes only
  from the Haul order, so Haul started without one ends ("no route given"). Build line has no
  target param: its line comes only from the order, so it ends without one too. The target param is
  never kept: each start fills it (the task order, or what the Player picks before it starts) or
  leaves it unset; the script's other params are kept as usual.
- **Working a site:** Work's `workplace` may also be a construction site of a workplace kind
  (farm, mine, smelter, …), so Work can be given or queued for a workplace still being built.
  At a site the Work default first builds it as the Build default would (fetching materials from
  the nearest storage of the realm holding them), then works it once it is finished, with no new
  order. The planner's Work step can be picked on such a site.
- **Workplace settings:** for each workplace, or construction site of a workplace kind, it knows,
  a realm keeps its own settings, set on the building's card and never seen by other realms: the
  **work script** (the Work default, or one of the Player's scripts that declares
  `param workplace: building`) and values for that script's params. Giving a resident Work there
  (card, group card, queue step) runs the work script; Customise (Before it starts) shows its params
  filled with the workplace's values, and a value the Player changes there becomes that
  resident's **override**; their earlier kept values for that script don't carry over. While they
  work there, a param reads the resident's override, else the workplace's setting, else the
  script's default. Changing a workplace's setting changes it at once for everyone working there
  without an override; clearing an override goes back to the workplace's value. Changing the work
  script switches everyone working there by it to the new one, as if given Work again. A script
  given by hand with Run script stays the resident's own choice. NPC cities keep no settings and
  run the game's defaults.
- **Explore:** a task (default script "Explore") for a grown resident, on foot or riding, to go
  into the unknown. Its params: `find`, a `choice` of a resource node kind (forest, stone, iron
  ore, gold ore) or none to just explore; `toward`, a `choice` of compass direction, and
  `waypoint`, a waypoint to head for instead, both unset meaning the nearest unexplored tiles
  first; and `food`, where to refill (else the nearest storage of the realm with Food). They set
  out with as much Food as they can carry and walk toward unexplored tiles that way. They turn
  back when the Food on them, a rider's horse's included (Horses have no inventory), just covers
  the way back to that storage plus a margin (a balance number), refill there and go back out to
  where they turned. Once a node of the kind `find` asks for comes into sight that none of the
  Player's waypoints marks, they put a waypoint on it named after it ("Gold ore node"), note it in
  the realm log, walk back to the storage and end; holding the most waypoints already, they still
  walk back and end, saying no waypoint was added. In sight means the Player's sight, checked
  each tick on the way out. Without `find` they go on until stopped. With
  no unexplored tile left in reach, they walk back to the storage and end saying so.
- **Defence script:** the script a resident runs when struck: the game's **Defend** default (armed,
  attack the attacker until they are dead, gone or out of sight; unarmed, walk home to the town
  hall; it ends once no blow has landed for a while) unless the Player picked one of their own
  scripts for that resident, on the card's Script tab or the group card; cleared, it is Defend
  again. Kept per resident like any script. Being struck interrupts what the resident was doing;
  when the defence script calls `end()`, the interrupted script goes on with its memory, the
  queue step continues, or the plain order resumes. A struck resident whose defence script is
  already running isn't interrupted again; a Player order given meanwhile ends both. NPC
  residents, and residents with no Player, run the game's Defend default.
  **A Player's order under attack:** what the Player gives a resident while they are under attack
  (their defence script runs, or a blow landed within the calm time Defend waits for) isn't
  interrupted by further blows. An order that ends by itself (a walk, a drive to a target, and
  the like) stands until it is done or replaced, however long that takes. What goes on until
  stopped (a haul route, working, a task, a script, a queue) holds until no blow has landed for
  the calm time; after that the next blow runs the defence script as usual. What a script or
  queue requests itself doesn't count as given by the Player.
  **On a carriage under attack (Defend default):** an unarmed driver drives on where they were
  going instead of leaving the carriage, and an armed one fights back and then goes on. An unarmed
  passenger stays aboard while the carriage is being driven; on one standing still (no driver
  driving it, its horse Down or dead) they get off and walk home. An armed passenger fights back.
  A Player's own defence script decides for itself: a driver's drive or haul route goes on until it
  gives them another order. Residents with no Player follow the same rule, and a caravan's driver
  under attack doesn't wait for their escort.
- **Alarm:** something happening in a City area that residents at home can react to (ADR 0028). Four
  kinds: **outsider**, someone of another realm, not allied, entering the area, raised once on
  entering, and again if they leave and come back (Trade Org caravans and wandering traders, with
  their crews, don't count); **theft**, someone stealing from the realm (goods, a carriage or a
  horse); **occupied**, an occupation of the city's town hall starting (Occupying a town hall);
  **attacked**, someone attacking a wall or gate of the city, or striking a resident of the realm
  standing in its area, a blow struck in fighting back aside. It is raised once per attacker, the
  first time someone at home sees them at it, and again only once no blow has come from them for the
  calm time Defend waits for; it doesn't interrupt those already fighting, and the one struck runs
  their Defence script. An alarm reaches the residents standing in that city's area who see it
  (Sight); an occupation reaches all of them, and in an NPC city also those who come home or get armed
  while it lasts. It runs their Alarm script. Army members, those hired out and those driving a carriage
  get no alarm, nor do an NPC city's founding party, and someone already attacking gets no outsider
  alarm. Someone of an NPC city or of the Trade Organization counts as of another realm here.
- **Alarm script:** the script a resident runs when an alarm reaches them: for an armed resident the
  game's **Alarm** default, unless the Player picked one of their own scripts or None for that
  resident, on the card's Script tab or the group card; an unarmed resident runs one only if the
  Player picked it. It interrupts and hands back like a Defence script: when it calls `end()`, what
  they were doing goes on. A blow still runs the Defence script, and once that ends the Alarm script
  goes on. One alarm doesn't interrupt another, with two exceptions: a theft or an attack takes over
  from an outsider alarm, unless they are already attacking someone, and an occupation takes over
  from any other. The script goes on with its memory, `me.alarm` now the new one. When it calls
  `end()`, an outsider alarm it took over from goes on: those holding the hall go after the thief or
  attacker, then back to holding while armed outsiders remain. An armed outsider who lures them away
  and steps onto the hall raises the occupied alarm, and they all come back. While a Defence script
  runs or a Player's order given under attack holds, an alarm doesn't reach them. A Player's order
  given meanwhile ends both.
  Scripts read `me.alarm`: its kind, who it is about and their realm, the city and tile, and when;
  `inCityArea(cityId, x, y)` says whether a tile lies in a City area, for a city of their realm or a
  tile in sight, `cityAreaAt(x, y)` which city's area it lies in, and `outsidersIn(cityId)` lists the
  outsiders they see in a City area. **The Alarm default:** a thief, an occupier or an attacker it goes after
  until they are dead or have left the area or sight, and then the nearest other attacker still
  attacking the city in sight, if any; for an armed outsider it walks to the town
  hall and stands there until no armed outsider is left in the area, which blocks an occupation
  before it starts; an unarmed outsider it only logs. NPC villages, towns and self-managed cities
  run this default for their armed residents, and nothing else: no Player picks theirs, and a blow
  has them fight back first as under the Defend default, then the script goes on. Trading posts and
  the HQ keep their own rules.
- **Doing:** the line on a resident's card and in the resident list that says what they are
  doing, shown to the owning Player only. It is derived from their task and current order
  ("Building a house: fetching 10 wood from the storage", "Working the farm"); the script they
  run is named on a small line of its own, left out when it is their task's own default script
  ("Working the farm" alone). Breeding names the two horses. Long lines wrap rather than being cut off. A script can say it
  itself with `doing(text)`: short
  text, kept in its memory, that shows instead until the script says something else or stops.
  **Estimates:** the Doing line and every meter or countdown that shows progress also say about
  how long is left, in real time with game time in brackets ("about 3 min (half a game day)"),
  from the current pace (terrain, horse, hunger, skill), rounded to one coarse unit: walking,
  driving and riding say when they arrive, and so do the orders that walk: to a siege machine to
  crew it, to a road or wall line's next tile, and after a target to attack; rowing, sailing,
  pushing a siege machine and a haul route by water say only the tiles to go until they have a
  pace of their own (Daniel, 2026-11-25); breeding, building, tearing down, carrying a child,
  pairing and growing up say how long is left.
- **Memory:** the small store a running script or order keeps between ticks. Roles are just
  something a script keeps there. A script can read, never change, the memory of its own
  Player's residents and armies, so residents doing the same task can agree on who does what;
  other Players' memory stays hidden.
- **Script log:** a resident's last lines of `log(text)` (short text, each with its game time),
  shown to the owning Player only and never in the realm log; `end(reason)` adds its reason too.
  Kept with the resident across scripts, so it still shows why the last one ended; once full,
  the oldest line goes. The game's defaults log their decisions and turns (carrying a load off,
  getting Food, fetching materials), never every tick.
- **Debugging a script:** the Script tab of a resident card shows, for the script they run,
  read-only and live: its memory and params, the script log, its last runtime error with the
  line (a click opens that line in the Library), and the steps it used last tick against its
  step budget.
- **Step budget:** how much work a script may do each tick, for each resident or army. Out of
  budget, the script stops for that tick; what it already requested still counts. Default
  scripts count like any other. Declaring a function costs no step; calling it does (Daniel,
  2026-11-10). A realm has no budget for all its scripts together, so a large realm's default
  scripts are never cut off (Daniel, 2026-11-17). A script sees only what its Player sees: their sight, explored terrain and
  what they last saw (Last seen), told apart from what is in sight now.
- **Value limits:** a single value a script holds is bounded: a string's length, a list's items and an
  object's keys each have a cap. Past it the script fails with a runtime error, like a call too
  deep. The caps are listed in the Wiki.
- **Script view:** what a script gets of each kind of thing (a resident, a building, a city, …):
  a fixed set of fields, the same for every Player and listed in the Wiki. A field the Player
  isn't allowed to see is always there and `null`, never missing. A script sees no field beyond
  these. The game may add fields at any time; renaming or removing one tells each Player whose
  scripts read it in their realm log, naming the field and the scripts.
- **Action:** a request (move, pick up, attack, …) that the world resolves at the end of a tick.
  The world only checks whether it's physically possible.
- **Tick:** one step of the world, one per second.
