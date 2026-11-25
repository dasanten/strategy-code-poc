# Residents

- **Resident:** a person living in the world. Has stats, skills, health, hunger and an age.
  Needs food or dies; dies of old age eventually. Lives in one city, wherever they are standing.
  _Avoid:_ unit (old code term).
- **Homeless:** a resident who lives in no city (their town hall was torn down, or they were
  left behind when their city changed hands). They have no home to refill at and can't pair
  until they Relocate.
- **Relocate:** a Player order (UI, queue step or script, `relocate(cityId)`) for any resident of
  their realm, the Leader, children and homeless ones included, naming another city of the same
  realm. The resident walks there and becomes its resident on stepping into its area, at once if
  already in it; like any order it replaces the current one. It can be given only while the city
  has free housing for them, counting residents already relocating there; a group needs room
  for all of them. A partner who is Carrying can't be told to relocate until the child is born.
  On arrival, the city must still have free housing and still be the realm's: if not, the order
  ends, they keep their old city and the realm log says why (in a group, each moves in while room
  lasts). Moving to another city ends a pair (Pairing needs one city). NPC cities don't relocate
  residents, besides sending a founding party to a daughter city.
- **Renaming a resident:** the Player can rename any resident of their realm, their Leader
  included, by hand or from a script: free, instant, from anywhere. Names need not be unique.
  Renaming the Leader never renames the realm (see Realm name). The realm log keeps the names
  things had when they happened.
- **Game-given names:** a name the game gives a resident (a starting city, a birth, a founding
  party, integration) is one no living resident of that realm has, an NPC city counting as a
  realm; a name the game gives a city is one no city in the world has. When the game's list of
  names runs dry it adds a numeral ("Edda II") rather than repeating one. Renaming stays free and
  may make duplicates. Names given before this rule stay as they are; a list that holds two
  residents of one name tells them apart by age and, with several cities, by city.
- **Stats:** Strength, Endurance, Agility, Intellect. Each has a **base value** and a
  **trained bonus**; the effective value is both together.
  - Strength: carry capacity, mining output, melee damage.
  - Endurance: health, how much food the resident needs, resistance to hard terrain.
  - Agility: walking speed, dodging.
  - Intellect: how fast the resident learns and trains.
- **Base value:** what a resident is born with. The only part children inherit.
- **Trained bonus:** what training adds on top of the base value. Capped relative to the base,
  so birth still matters. Never inherited.
- **Skill:** something learned by doing or training (Mining, Woodcutting, Smelting, Smithing, Construction, Farming, Combat, Driving, Seafaring, …). Starts at 0,
  never inherited. Not a stat. Work skills (Mining, Woodcutting, Smelting, Smithing, Farming)
  and Construction run from 0 to 100: each point adds 1 % to output or building work, so a
  skilled resident does at most twice what an unskilled one does; an average learner takes about
  a game year to get there.
- **Training ground:** a building where residents train (`Training`). 3×3, on any passable terrain
  except Mountain, built like any building. Like a workplace, it has no owner: whoever teaches
  there holds it. One ground teaches one **subject** at a time: a stat (Strength, Endurance,
  Agility, Intellect) or a skill (Combat, Driving, Mining, …), the one its teacher set.
- **Teacher:** a grown resident at a training ground with the **Teach** order, which names the
  subject. A ground has one teacher at a time; a second Teach there fails. Leaving the ground or
  taking another order ends the teaching, and the ground teaches nothing until someone teaches
  again.
- **Trainee:** a grown resident at a training ground with the **Train** task (default script
  "Train"), up to a maximum per ground (a balance number). Trainees learn only while a teacher is
  there; without one they wait.
- **Training:** a trainee gains in the ground's subject each tick a teacher is there, only while
  below the teacher's own effective value in it: nobody learns past their teacher. A stat's
  trained bonus never passes its cap (Trained bonus); a skill trains toward the teacher's skill,
  up to the skill's maximum. A trainee at the ceiling waits. The trainee's Intellect sets the
  pace, as for learning by doing; training a skill goes faster than learning it by doing. The
  teacher's level is only the ceiling, never the pace. The teacher gains nothing and needs no
  skill to teach. Training costs nothing but time and food: teacher and trainees eat as usual and
  refill at the ground as at a workplace (Refilling at a workplace); the Train default has the
  usual food params. Nothing trained decays; only old age lowers stats.
- **Who trains:** Players' residents, by order, queue step or script, and the soldiers of a big NPC
  city with a training ground (Bigger projects): its soldier with the most Combat teaches, among
  equals the strongest, and others train in turns of a balance number of days, Combat while any of them
  is below the teacher in it, else Strength, with the posts on its hall and gates still held. A ground
  sits empty with too few soldiers left over for a teacher and a trainee, or with nothing anyone can
  learn from the teacher. A city's ground is the one in its area. The Trade Organization trains nobody for now. Scripts have
  `teach(subject)` and `train()`; a building's script view shows its teacher, subject and trainees.
- **Carry capacity:** the most weight a resident can carry, set by Strength. Everything has weight,
  including money, so nobody walks around with a fortune in their pocket.
- **Pairing:** two adult residents of the same city set to have children (a Player order, or on
  its own in NPC cities). Each pair has one child at most. The only way, besides integrating,
  that residents come into being. Once 5 game days (2 real hours) have passed since they paired
  (Daniel, 2026-11-19, Epic 113), and their city
  has free housing and a food surplus, one partner, chosen at random,
  starts **Carrying** the child; the other keeps working as before.
- **Carrying:** a partner carrying a child can't work for 10 game days (4 real hours); then the
  child is born and the pair ends. For another child the Player pairs them again (NPC cities do
  it on their own).
- **Child:** a resident born to a pair. Each base stat is the parents' average plus a small
  random amount. Born where a parent stands, into their city and realm. Grows up for a while
  before it can work: until grown, a child can walk, but can't work, build, tear down, drive,
  pair, or pick up and put down goods other than Food. Food they may pick up, put down, Fetch
  and Store like anyone, so they can carry their meals. In their own city's area, a child with
  less than their own food on them tops up to it from the city's storage (Refilling at home,
  but to their own food and not only when running low), so a child leaving the city has food
  on them.
- **Drifter** (Epic 115, settled with Daniel on 2026-11-19): a grown resident who comes to a small
  realm on their own; beside pairing and integrating, the one other way a realm gets residents.
  While a Player's realm has fewer residents than a cap (a balance number, about 16), its Leader
  lives, and the city the Leader lives in has free housing and a food surplus, a drifter sets out
  for that city every few game days (a balance number), one at a time. They come into being on a
  passable tile a few minutes' walk from the city that no Player has in sight (as a new vein
  does), with stats and an age drawn as in a starting city, Food for the walk and nothing else,
  and walk to its town hall. On the way they belong to no Organization: they take no orders,
  anyone with them in sight sees a drifter, and whatever is done to them is no crime. Stepping
  into the city's area they become a resident of that city and its realm, standing idle, and the
  realm log names them. Founding more cities brings no more drifters. NPC cities (self-managed
  ones too), trading posts and the HQ draw none. Decided while planning, Daniel to confirm: when
  on arrival the city has no free housing, is no longer that realm's, or the realm has reached
  the cap, the drifter turns round and is gone once out of every Player's sight.
- **Drifters on the city card:** the card of the city the Leader lives in has a line saying
  whether drifters are coming, with about how long until the next (Estimates), or why none
  comes: no free housing, no food surplus, or the realm is too big. Only the owning Player sees
  it.
- **Aging:** residents grow old; their stats decline late in life, and they die of old age at
  around 60 game years. Children age faster: each year of age up to 14 takes 4 game days
  (about 1.6 real hours), so a child is grown after about 56 game days (~22 real hours); from 14
  on, a year of age is a game year (Daniel, 2026-11-19, Epic 113).
- **Hunger:** each resident eats a fixed amount of Food per game day, more on hard terrain and
  less with high Endurance. An empty hunger meter costs health; without food a resident goes
  Down after about 5 game days (2 real hours), and dies if nobody revives them. While the meter
  isn't empty, lost health slowly comes back.
- **Down:** a resident whose health hunger has used up doesn't die at once but lies unconscious
  on their tile for a while (a balance number, about one real day). Down, they do nothing: their
  order, script and queue end, they take no orders (the card says Down and how long is left),
  don't eat and lose no more health. Anyone in sight sees that they are Down. Anyone on their
  tile can take the goods they carry, as from a pile; from another realm's resident that is
  theft. Attacked, they die like anyone. When the time is up and nobody has revived them, they
  die of hunger. Only hunger puts a resident Down: wounds kill as before. A Leader who is Down is
  not a Leader death. The realm log says when one of its residents goes Down, wakes or dies.
- **Reviving:** any grown resident of any realm on or next to a Down resident's tile can **Feed**
  them (an order, queue step or script `feed(targetId, units)`), putting Food from their own
  hands into the Down resident's. Once their hunger meter isn't empty they wake at low health
  and stand idle. A Down horse wakes the same way once it has eaten, from Food in reach (Horses
  have no inventory) or when a resident Feeds it (Feeding a horse). An NPC city revives its own: while
  a Down resident of the city lies in or near its area and its storage holds Food, one of its grown
  residents, never a soldier and a spare hand first, takes Food to them and Feeds them, one at a time
  per Down resident. It doesn't go far out for one (a balance number). This comes ahead of building,
  road crews, scouts and work for surplus, and of what is short, except Food for those who aren't Down:
  its farmers stay while Food is short. The Trade Organization's cities do the same.
- **Eating:** a resident eats only food they carry, everywhere, also at home. Nobody eats
  straight from a storage.
- **Own food:** the Food a resident keeps on them for their own meals, about four game days of
  eating. Putting goods away (storing, dropping, loading, delivering) leaves it in their hands
  unless the Player asks for an exact amount; NPC residents always keep it.
- **Refilling at home:** a resident in their own city's area who is running low on food takes a
  meal from the city's storage into their hands, without an order.
- **Refilling at a workplace:** a resident working at a workplace who is running low on food
  takes a meal the same way from Food lying on the workplace's tile, or else from a carriage
  standing there. Anywhere else (travelling, building) there is no refill: they need food on
  them or a delivery.
- **Refilling from a carriage:** any resident of a realm running low on food takes a meal from a
  carriage of their own realm on or next to their tile, like refilling at home: the driver while
  driving, and after the drive, passengers, army members, and anyone working or waiting beside a
  parked carriage. The Food a haul route keeps on board is left for its horse and driver.
- **Getting food:** in the Work, Build, Build line and Tear down defaults, a resident whose
  `foodAt` param is set and who carries less Food than that many units stops, walks to their
  `food` param, else their `storage` (Work) or `source` (Build, Build line, Tear down) param, or
  else the nearest storage of their realm with Food, takes
  Food there up to `foodTake` units on them, and goes back. Whenever they are at a storage anyway
  (carrying the output, fetching materials), their own food is topped up to `foodTake` instead of
  the usual own food. The game's defaults give both params a default (about a day of Food for
  `foodAt`, a few days for `foodTake`), so residents get food on their own unless the Player
  changes them; `foodAt` set to 0 turns it off, and they rely on refilling. NPC cities run the
  defaults with these defaults.
