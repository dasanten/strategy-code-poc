# Transport

- **Horse:** an animal that pulls a carriage. Eats Food and goes hungry like a resident: an empty
  hunger meter costs health, and a horse without food goes Down after about 5 game days (Down,
  Reviving) and dies if it eats nothing before its time is up. Bred by a
  resident at a stable, or bought from an NPC city (Horse market). The Trade Organization doesn't
  sell horses for now.
- **Horse grant:** a one-time gift, given once when it ships: every Player realm with a living
  Leader and no horse at all (in a stable, hitched or ridden) gets two new horses with stats drawn
  as in a starting city. They appear in the realm's finished stable nearest the Leader's city;
  with no stable, on free tiles next to the storage of the Leader's city (or the realm's oldest
  city; with no city, next to the Leader), each with a few days of Food on the ground by it. The
  realm log says where they arrived. Realms that still have a horse get none.
- **Horse offer:** every Player may claim two new horses once, when they choose, whether
  or not they have horses. Until claimed, the HUD shows a notice with a Claim button; claiming
  places them as the Horse grant does (stats, stable or storage, Food by them, realm log) and
  the notice is gone, also across Leader deaths. A Player with no living Leader can't
  claim until they have one again. **Offering horses again:** an admin can re-open the offer in
  the admin panel, for every Player at once or for one by name, as often as needed. Each Player
  who had claimed may then claim once more, whether or not they still have horses, and sees the
  notice at once; a Player who hadn't claimed still has just the one claim.
- **Horse name:** every horse has a name, given by the game when it comes into being (starting
  city, Trade Organization, foal, Horse grant) from a pool of horse names apart from the
  residents' pool. **Renaming a horse:** the Player can rename any horse of their realm, by hand
  or from a script, like renaming a resident: free, instant, from anywhere; names need not be
  unique. The name shows wherever the horse shows: the tile card, the stable, the carriage it
  pulls, its rider's card and the realm log. Scripts see it.
- **Horses tab:** a tab of the sidebar (People), like the Residents tab, listing the realm's
  horses grouped by where they stand: each stable by name, hitched to a carriage, ridden, loose.
  A row shows name, stats, age, health and hunger; tapping it centres the map on the horse and
  picks it.
- **Horse stats:** every horse has Speed, Strength and Endurance, and an age. Speed is how fast
  it pulls its carriage or carries a rider (`Riding`); Strength is how much the carriage it pulls
  can hold; Endurance is how much Food it needs, as a resident's Endurance is for them. New
  horses (in a starting city, at the Trade Organization, in an NPC city) get stats drawn in a
  range. A horse's stats never change; they show with its age, health and hunger on the tile card
  and in the stable.
- **Horses have no inventory:** a horse eats only what is in reach. At a stable it eats from the
  stable's storage; pulling a carriage, from the carriage's load; anywhere, from Food lying on the
  ground on its tile or right next to it, so Players can also feed a horse by putting food down
  by it (or Feed it directly, Feeding a horse).
  A ridden horse also eats from the Food its rider carries beyond the rider's own food, after
  Food in reach on the ground: the rider never goes without for the horse, and the realm log says
  when a ridden horse is hungry with nothing to spare.
- **Stable:** a building on Plains where horses are kept. It has a storage for their Food, which
  residents fill and empty like any storage. Horses don't breed there on their own: a resident
  breeds them (**Breeding**). Like a workplace, a stable has no owner: any horse standing in it
  eats from it.
- **Breeding:** an order (as a script could do it) for a grown resident at a finished stable: they
  pick two fed horses of their realm standing in it (wherever the Player picks them, each shows its
  name and stats) and tend them for a while; then a foal of
  their realm is born in the stable, with its parents' average stats plus a little noise. It
  pauses when the resident leaves or is given another order, or while the stable has no room for
  another horse. Like a construction site's work, the progress belongs to the two horses in that
  stable, not to the resident: any grown resident who breeds there later carries on with that
  pair first, where it stopped. The progress is lost only when one of the two leaves the stable
  or dies. Before starting, the default takes Food for the resident's meals from the stable. NPC
  cities breed their horses the same way, with one of their residents.
- **Feeding the stable:** a task (default script "Feed the stable") given to a grown-up resident
  standing in a stable, from their card. They keep Food in the stable for about 10 game days for
  the horses standing in it: below that they fetch what is missing from a storage and store it in
  the stable; otherwise they wait there. Its params: `stable`, the stable to feed (by default the
  one they stand in when it starts), and `source`, where the Food comes from (by default the nearest
  storage of their realm with Food). With no Food to fetch they wait. **Once:** the same task can
  run a single round: fetch what is missing, store it, and end once the stable is full (a queue
  step).
- **NPC horses:** a new NPC village or town starts with two horses, with some Food by them; one from
  before this got two when it shipped. It wants a stable once it has any and lays it out where they
  stand, so they are in it when it is finished; it keeps it fed as Feeding
  the stable says, with one of its residents at a time, and breeds up to the horses it wants for its
  size (a balance number), while Food isn't short. The Food comes from what is above the reserve for its people, or below
  that a little while its horses are hungry or Down: a short city feeds its people first. The
  resident goes when the stable runs low and fills it, and works for the city in between. Self-managed
  cities with horses do the same. A founding party takes none: a daughter with none wants a stable too once nothing
  is short of its reserve, and gets its first horses when a Player sells it some. Trading posts and
  the HQ don't take part.
- **Horse market:** buying and selling a horse with an NPC city, only in person: a grown resident
  at its finished stable. **Buying** takes a horse standing in it that the city can spare (any beyond a
  breeding pair it keeps), with the Coins in the buyer's hands; the Coins go into its storage and the horse joins
  their realm where it stands. **Selling** takes a horse of their realm standing in it, pulling no
  carriage, not ridden and not Down, while the city has fewer than it wants and the Coins in its
  storage; the Coins go into the resident's hands, and it doesn't go if they can't carry them. The
  price comes from the horse's stats and age and how many the city has against how many it wants, dearer as it nears the pair it keeps,
  and its standing toward them moves it like its trade prices. It pays less than it asks. At low standing it refuses (NPC city
  reaction). A sale raises standing like any trade. The trade section lists its horses, and the
  realm's standing in the stable, with name, stats and price.
- **Carriage:** a horse-drawn cart driven by a resident with Driving skill. Carries far more than
  any resident and is fast on plains and roads, slower in forest and hills, and cannot enter
  mountains except on a road. Built at a stable (Building a carriage).
- **Building a carriage:** a resident at a finished stable lays out a **carriage site** on their
  tile of the stable, or on a tile right next to it, where a carriage can stand, off resource nodes
  and other buildings; it shares the tile with the stable, one carriage site per tile. It is a
  construction site like any other (materials, mostly wood and some iron, and work; fetching
  materials, no owner, finished by anyone, torn down leaving all its materials). Once finished it
  is gone, and an empty carriage of the realm of the resident who finished it stands on its tile,
  with no horse hitched until it is first driven.
- **Driving:** a grown-up resident on a carriage's tile drives it to another tile; the driver,
  the carriage and its horse move together. Driving teaches the Driving skill, and a more
  skilled driver goes faster. Driving off in another organization's carriage steals it (Stealing
  a carriage or horse).
- **Feeding a horse:** a grown resident of any realm on or next to a horse's tile can **Feed** it
  (an order, queue step or script), any horse that isn't full, Down or not. Full means its hunger
  meter has no room for a whole unit, as when it eats on its own, so no Food is wasted. It eats
  Food from their hands until then, up to the units asked for; the rest stays with them. A Down
  horse wakes as under Reviving.
- **Hitched horse:** the one horse that pulls a carriage. A horse of the carriage's realm standing
  with it is hitched when the carriage is first driven (another's is stolen by that: Stealing a
  carriage or horse), and stays hitched until **unhitched**: a grown resident of the carriage's realm standing on its
  tile unhitches it (an order, as a script could do it); the horse stands free on the tile, and
  the carriage stands where it is until it is next driven. A carriage
  whose horse dies stands where it is until another horse is hitched.
  **Hitching:** a grown resident of the carriage's realm on its tile hitches the horse they choose
  (an order, as a script could do it): any horse of the realm on that tile that pulls no carriage,
  nobody rides and isn't Down, listed on the card with name, stats and age. It happens at once; a
  horse already hitched stands free on the tile. Driving with none hitched still takes the first
  free horse there.
- **Riding:** a resident on a tile with a horse that pulls no carriage and nobody rides mounts
  it (another organization's is stolen by that: Stealing a carriage or horse), and dismounts
  anywhere; the horse stays on that tile. Riding is not an order:
  the rider goes on with what they do, and their walking goes at the horse's pace, as fast as it
  would pull a carriage there (fast on plains and roads, slower in forest and hills, never into
  mountains off a road or onto walls), slower while the horse is hungry. Gates and walls stop a rider as
  anyone. The rider carries what they could on foot; the horse eats Food in reach as usual.
  Riding teaches Driving, and Driving makes riding faster. A horse has at most one rider and is
  never hitched while ridden; a rider doesn't drive. A rider whose horse dies, or who leaves it
  behind (climbing a wall), is on foot again. On the map a rider's token sits on a horse token,
  so riders stand out from walkers; their Doing line says "Riding" where it would say
  "Walking", and their card shows the horse they ride with its stats, age, health and hunger.
- **Loading a carriage:** residents on a carriage's tile put goods on it and take goods off it
  like at a storage, up to what the carriage holds.
- **Passenger:** a resident aboard a carriage of their realm, children too. Any carriage takes
  passengers: each counts as a fixed weight against what it holds, so it carries goods, people
  or a mix. A resident on the carriage's tile **boards** it (card, group card, queue step,
  script); aboard, they move with the carriage and don't walk on their own, and **get off** on
  its tile or right next to it. Giving a passenger a walk or an order that acts on a tile gets
  them off first. Being aboard isn't an order, like Riding. The driver isn't a passenger.
  Passengers eat their own food and, running low, take a meal from the carriage's Food
  (Refilling from a carriage). A carriage whose horse dies stands still with its passengers
  aboard until they get off.
- **Haul route:** an order (as a script could do it) for a resident to drive a carriage between
  two stops again and again: they load the chosen goods at the first stop, drive them to the
  second, unload them, and come back for more, until stopped. Goods can go both ways: others
  chosen to come back are loaded at the second stop and unloaded at the first (e.g. ore home,
  Food out to the mine); no good goes both ways. A stop with a storage loads and
  unloads there, else on the ground; the driver loads by hand like anyone. Some Food stays on
  board for the horse, topped up at any stop that has Food. The carriage leaves the first stop
  once it has goods on board and nothing more to load; with no goods there yet it waits.
