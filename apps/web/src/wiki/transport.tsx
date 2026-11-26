import {
  BUILD_MATERIALS,
  CARAVAN_ESCORTS,
  CARAVAN_ESCORTS_MAX,
  CARAVAN_GUARD_RANGE,
  CARAVAN_ROBBERIES_PER_ESCORT,
  TRADERS,
  TRADER_ESCORTS,
  TRADER_STOP_REACH,
  TRADER_STOP_TICKS,
  CARRIAGE_CAPACITY,
  PASSENGER_WEIGHT,
  CARRIAGE_MAX_CAPACITY,
  CARRY_BASE,
  CARRY_PER_STRENGTH,
  DELIVERY_FEE_BASE,
  DELIVERY_FEE_PER_KG_TILE,
  DELIVERY_LOAD,
  DRIVING_SKILL_EFFECT,
  DRIVING_SKILL_LIMIT,
  DRIVING_SKILL_PER_DAY,
  STARVE_DAYS,
  DOWN_DAYS,
  FEED_UNITS,
  GOOD_WEIGHT,
  HAUL_HORSE_FOOD,
  HAUL_KEEP_FOOD,
  HORSE_FOOD_PER_DAY,
  HQ_PEOPLE_FOOD_DAYS,
  WAITING_HORSE_FOOD,
  HORSE_WAKE_HEALTH,
  HORSE_GRANT_FOOD,
  HORSE_GRANT_HORSES,
  HORSE_HUNGRY_SHARE,
  HORSE_NAME_MAX_LENGTH,
  HUNGRY_HORSE_PACE,
  HORSE_ENDURANCE_EFFECT,
  HORSE_ENDURANCE_LIMIT,
  HORSE_SPEED_EFFECT,
  HORSE_SPEED_LIMIT,
  HORSE_START_AGE_MAX,
  HORSE_START_AGE_MIN,
  HORSE_STAT_AVERAGE,
  HORSE_STAT_MAX,
  HORSE_STAT_MIN,
  HORSE_STRENGTH_EFFECT,
  HORSE_STRENGTH_LIMIT,
  HUNGER_DAYS,
  MAX_HEALTH,
  OWN_FOOD,
  ROAD_LINE_MAX_TILES,
  MOUNTAIN_ROAD_WORK_FACTOR,
  STABLE_BREED_DAYS,
  STABLE_CAPACITY,
  FOAL_STAT_SPREAD,
  BREED_FOOD,
  STABLE_FEED_DAYS,
  TICKS_PER_GAME_DAY,
  TRANSFER_FEE_FACTOR,
  WORK_SKILL_MAX,
  carryCapacity,
} from '@csp/balance'
import type { Good } from '@csp/shared-types'
import { GoodIcon } from '../ui/GoodsGrid.js'
import { goods, goodName } from './names.js'
import { Table } from './parts.js'
import {
  AVERAGE_CARRY,
  AVERAGE_STATS,
  buildCosts,
  carriageCost,
  days,
  duration,
  feeExamples,
  num,
  pct,
  transport,
  horseRow,
  wikiResident,
} from './wiki-view.js'

export function TransportSection() {
  const avg = AVERAGE_STATS.strength
  const strong = wikiResident({ strength: avg * 1.5 }, { mining: WORK_SKILL_MAX / 10 })
  const loads: [number, number][] = [
    [100, 100],
    [100, 400],
    [DELIVERY_LOAD, 1000],
  ]
  return (
    <>
      <p>
        A resident carries {num(CARRY_BASE)} kg plus {num(CARRY_PER_STRENGTH)} kg for each point of
        Strength: {num(AVERAGE_CARRY)} kg at average, {num(carryCapacity(strong, 0))} kg with
        Strength {num(strong.stats.strength.base)}. A carriage behind an average horse carries{' '}
        {num(CARRIAGE_CAPACITY)} kg; each point of its driver's Driving skill makes it{' '}
        {pct(DRIVING_SKILL_EFFECT)} faster, at most {pct(DRIVING_SKILL_LIMIT)}, learned at{' '}
        {num(DRIVING_SKILL_PER_DAY)} a game day of driving. Carriages enter mountains only along a
        finished road, so a road over a ridge opens a pass for them.
      </p>
      <p>
        A carriage is built at a finished stable: a resident there lays out a carriage site on a
        tile of the stable, or right next to it, that has no carriage site yet. It takes{' '}
        {goods(carriageCost().materials)} and {duration(carriageCost().buildTicks)} of one builder's
        work, fetched and built like any construction site, and whoever finishes it gets an empty
        carriage of their realm, with no horse hitched until it is first driven. Torn down before it
        is finished, it leaves all the materials delivered to it.
      </p>
      <p>
        The first time a carriage is driven, a free horse of its realm standing with it is hitched,
        and it stays hitched until <strong>Unhitch horse</strong>: any grown resident of the
        carriage's realm standing on its tile can unhitch it, from their card, the carriage's tile
        card, the group card, as a queue step or with a script's <code>unhitch(carriage)</code>. The
        horse then stands free on the tile, to be ridden or led into a stable, and a carriage being
        driven stops where it is. The carriage stands there until it is next driven, when a free
        horse of the realm standing with it is hitched again. A carriage whose horse dies waits the
        same way.
      </p>
      <p>
        To choose the horse, use <strong>Hitch horse</strong>: any grown resident of the carriage's
        realm standing on its tile can hitch a horse of the realm there that pulls no carriage,
        nobody rides and isn't Down. Their card lists those horses with name, stats and age, also
        when only one stands there; it is a queue step too, and a script's{' '}
        <code>hitch(carriage, horse)</code>. It happens at once, and a horse already hitched stands
        free on the tile. A carriage being driven goes on with the new horse. Hitching only takes
        your realm's own horses; stealing one stays with driving and mounting.
      </p>
      <p>
        A grown resident on the tile of another realm's or city's carriage can steal it: its card,
        or the resident's, offers <strong>Drive off (theft)</strong>, and a script's{' '}
        <code>drive</code> naming that carriage does the same. The carriage joins your realm at
        once, with its load and hitched horse; with no horse hitched, a free horse of yours on the
        tile pulls it, or else a free horse of someone else's there, stolen with it. It can't be
        taken while someone drives it or anyone is aboard, nor while an armed resident of its owner
        stands on the tile and none of your realm does. A caravan's carriage also can't be driven
        off while its crew hold it (see Deliveries and transfers). Nothing that picks a carriage by
        itself ever does this, and a queue step keeps to your own carriages, as do hauling and group
        orders. Its owner's realm log says at once that it is gone and where it was last; who took
        it they learn only from a witness (see Standing). One that belongs to nobody is simply
        yours. A carriage handed over to an alliance army is its commander's to drive, which is no
        theft. A boat is stolen the same way, by rowing it off from beside it (see Water &amp;
        havens).
      </p>
      <p>
        A carriage's card shows its load as a bar against what it holds (its passengers counted in)
        over its goods, its driver and passengers by name, the haul route it drives as “first stop →
        second stop” with the leg it is on and about when it arrives, and its horse with its health
        and hunger and how long the Food on board feeds it. Another realm's carriage shows only how
        heavily it is loaded, and its horse without how it fares.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Goods</th>
            {(Object.keys(GOOD_WEIGHT) as Good[]).map((g) => (
              <th key={g}>
                <span className="good-label">
                  <GoodIcon good={g} />
                  {goodName(g)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>kg a unit</td>
            {(Object.keys(GOOD_WEIGHT) as Good[]).map((g) => (
              <td key={g}>{num(GOOD_WEIGHT[g])}</td>
            ))}
          </tr>
        </tbody>
      </Table>
      <p>
        Cards show goods as these icons, each with its amount; hover over one, or press and hold it
        on a phone, for its name. That goes for every inventory: what a resident carries, a
        carriage's load, a storage's or stable's goods and a pile; a trade's prices name each good
        beside its icon. On a resident's card their own food (up to {num(OWN_FOOD)} Food) shows
        apart at the end, marked <em>own</em>. A construction site's card shows its work done as a
        bar with about how long is left at the pace of those building it, then a row per material:
        what was delivered against what it needs, with a small bar. A workplace's card shows its
        pile and its crew, one row each with what they are doing: working, carrying a load,
        fetching, or on the way.
      </p>
      <h3>Moving goods, per game hour</h3>
      <Table>
        <thead>
          <tr>
            <th>Terrain</th>
            <th>On foot, tiles</th>
            <th>On foot, kg × tiles</th>
            <th>Carriage, tiles</th>
            <th>Carriage, kg × tiles</th>
          </tr>
        </thead>
        <tbody>
          {transport().map((t) => (
            <tr key={t.terrain}>
              <td>{t.terrain}</td>
              <td>{num(t.footTiles, 1)}</td>
              <td>{num(t.footKgTiles, 0)}</td>
              <td>
                {t.carriageTiles
                  ? num(t.carriageTiles, 1)
                  : t.terrain === 'Mountain'
                    ? 'only on a road'
                    : 'can’t enter'}
              </td>
              <td>{t.carriageTiles ? num(t.carriageKgTiles, 0) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        A road tile takes {goods(BUILD_MATERIALS.road ?? {})} and{' '}
        {duration(buildCosts().find((b) => b.kind === 'road')!.buildTicks)} of one builder's work.
        It goes on any land a resident can walk, mountains too: there it takes the same materials
        but {num(MOUNTAIN_ROAD_WORK_FACTOR)} times the work, to build and to tear down (the road
        work column above). Roads are built along a line with <strong>Build line</strong> (see{' '}
        <a href="#building">Building</a>): at most {num(ROAD_LINE_MAX_TILES)} tiles, straight or
        diagonal. A wall is built along a line the same way, past tiles with a wall or gate already;
        a diagonal wall line closes the way like a straight one.
      </p>
      <p>
        A wall or gate is of <strong>wood</strong> or <strong>stone</strong>: pick which in the
        Build menu, or on the banner while picking a wall line's ends (wood unless you pick stone).
        Stone takes Stone instead of Wood and more work (the stone rows above), and it holds out
        several times longer against blows (see <a href="#combat">Combat</a>); it is no higher, with
        the same wall walk and cover. On the map a stone tile shows a grey block in its colour, and
        its card says what it is of. Scripts pass <code>"stone"</code> to <code>build</code> and{' '}
        <code>wallLine</code>.
      </p>
      <p>
        <strong>Upgrading to stone.</strong> A stone wall or gate can be laid out on a wooden one of
        its kind: stand on it, pick Stone in the Build menu and Build. The wooden one stands, with
        its wall walk, and can be defended until the stone one is finished and takes its place;
        whoever is up on it stays up, and its Wood goes into the new one. A stone wall line upgrades
        the wooden walls and gates on its way, a gate to a stone gate, and passes only those already
        of stone; a wooden line passes both. Breaking the wooden one while the stone site stands
        leaves the site.
      </p>
      <p>
        {' '}
        The tiles your residents' road and wall lines still have to build, running or waiting in
        their queues, show faintly on your map, the picked residents' stronger; only you see them.
      </p>
      <p>
        An average horse eats {num(HORSE_FOOD_PER_DAY)} Food a game day, from a stable, the
        carriage's load or food on the ground next to them, and a ridden horse after that from the
        Food its rider carries beyond their own {num(OWN_FOOD)}. A stable holds up to{' '}
        {num(STABLE_CAPACITY)} horses. A haul route keeps {num(HAUL_KEEP_FOOD)} Food on board for
        its horse and its driver, {num(HAUL_HORSE_FOOD)} of it the horse's share.
      </p>
      <p>
        The route (where to, which goods) comes only from the Haul order, which also fills the Haul
        default's <code>carriage</code> param. Run directly, with Run script or as a queue step,
        Haul has no route: it ends at once and your realm log says “no route given”.
      </p>
      <h3>A horse going Down</h3>
      <p>
        A horse goes hungry like a resident: with nothing in reach it goes <b>Down</b>{' '}
        {days(HUNGER_DAYS + STARVE_DAYS)} after its last meal and lies there for {days(DOWN_DAYS)}.
        Down, it doesn't move: its rider is on foot again, and the carriage it pulls stands where it
        is, its drive or haul route ending; nobody can mount or drive it. It still eats Food in
        reach, so put Food down on its tile or right next to it, or Feed it (below). Once it has
        eaten, it gets up with {num(HORSE_WAKE_HEALTH)} health of {num(MAX_HEALTH)} and heals from
        there. When the time is up first, it dies. Its token lies on its side, the Horses tab, the
        stable and the tile card say it is Down and how long is left, and your realm log says when
        one of your horses goes Down and when one dies.
      </p>
      <h3>Feeding a horse</h3>
      <p>
        Any grown resident of any realm on or next to a horse's tile can <b>Feed</b> it, whoever's
        it is and Down or not, as long as it isn't full: the Feed row on their card (or on the
        horse's tile card), a queue step, or <code>feed(targetId, units)</code> in a script. Horses
        have no inventory, so it eats from their hands at once, a whole unit at a time, until its
        hunger meter has no room for another whole unit, which is what full means here, so no Food
        is wasted. It eats up to the units asked for ({num(FEED_UNITS)} unless set); the rest stays
        with them. A full meter holds {num(HUNGER_DAYS * HORSE_FOOD_PER_DAY)} units. Feeding another
        realm's horse is no crime. Another realm's horse doesn't show how it fares, so the card
        offers it unless it is known to be full, and the order says so if it is. With more than one
        to choose from, those Down come first and say so, then those known to be hungry.
      </p>
      <h3>Breeding</h3>
      <p>
        Horses don't breed on their own. A grown resident standing at a finished stable is given
        Breed horses and picks two fed horses of their realm in it, each shown with its name and
        stats; they tend them for {days(STABLE_BREED_DAYS)}, and then a foal of their realm is born
        in the stable. Each of its stats is its parents' average, give or take{' '}
        {num(FOAL_STAT_SPREAD)}. The progress belongs to the two horses, and the stable keeps it:
        breeding pauses when the resident leaves or is given another order, or while the stable has
        no room left for the foal, and any grown resident who breeds there later carries on with
        that pair first, where it stopped, if both are still fed. The stable's card shows a paused
        breeding and how far along it is, and the resident's Doing line names the two they tend. The
        progress is lost only when one of the two leaves the stable or dies. The Breed horses
        default first takes {num(BREED_FOOD)} Food from the stable for the resident's meals, if they
        carry less. NPC cities have one of their residents breed their horses the same way.
      </p>
      <p>
        Breed horses can be run directly too, with Run script or as a queue step: they breed in the
        stable in its <code>stable</code> param, walking there first, or with none picked the one
        they stand in when it starts. They pick the pair themselves, a paused pair in that stable
        first, else two fed horses of your realm in it. Giving Breed horses in a stable fills the
        param; it is never kept between starts. With no stable there, or no two fed horses in it,
        Breed horses ends and your realm log says why.
      </p>
      <h3>Horse names</h3>
      <p>
        Every horse has a name, given by the game when it comes into being: in a starting city, at
        the Trade Organization, as a foal, or from the Horse grant or offer. You can rename any
        horse of your realm, free and at once, from anywhere: with <strong>Rename</strong> on the
        card of the tile it stands on, or a script's <code>renameHorse(horse, name)</code>. A name
        takes up to {num(HORSE_NAME_MAX_LENGTH)} characters and need not be unique. The name shows
        on the tile card, the stable, the carriage it pulls, its rider's card and the realm log, and
        scripts see it as <code>horse.name</code>.
      </p>
      <h3>Horses tab</h3>
      <p>
        The <strong>Horses</strong> tab of the sidebar (in the menu on a phone) opens a list of your
        realm's horses, like the Residents tab does for residents. They are grouped by where they
        stand: under each stable they are in (by its city), then Hitched to a carriage, Ridden and
        Loose. Each row shows the horse's name and where it is (“Pulling the carriage Ann drives”),
        its Speed, Strength and Endurance, its age, and its health and hunger. Click a row to centre
        the map on the horse and open the card of its tile, or of its rider.
      </p>
      <h3>Horse stats</h3>
      <p>
        Every horse has Speed, Strength and Endurance, and an age. A new horse's stats are whole
        numbers from {num(HORSE_STAT_MIN)} to {num(HORSE_STAT_MAX)}, and it is{' '}
        {num(HORSE_START_AGE_MIN)} to {num(HORSE_START_AGE_MAX)} game years old; a horse's stats
        never change. Away from the average of {num(HORSE_STAT_AVERAGE)}, each point of Speed makes
        its carriage {pct(HORSE_SPEED_EFFECT)} faster (slower below), at most{' '}
        {pct(HORSE_SPEED_LIMIT)}; each point of Strength lets its carriage hold{' '}
        {pct(HORSE_STRENGTH_EFFECT)} more (less below), at most {pct(HORSE_STRENGTH_LIMIT)}, so up
        to {num(CARRIAGE_MAX_CAPACITY)} kg; each point of Endurance means{' '}
        {pct(HORSE_ENDURANCE_EFFECT)} less Food (more below), at most {pct(HORSE_ENDURANCE_LIMIT)}.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Stat</th>
            <th>Carriage on plains, tiles a game hour</th>
            <th>Carriage holds, kg</th>
            <th>Food a game day</th>
          </tr>
        </thead>
        <tbody>
          {[HORSE_STAT_MIN, HORSE_STAT_AVERAGE, HORSE_STAT_MAX].map((v) => (
            <tr key={v}>
              <td>{num(v)}</td>
              <td>{num(horseRow(v).plainsTiles, 1)}</td>
              <td>{num(horseRow(v).capacity, 0)}</td>
              <td>{num(horseRow(v).food, 2)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <h3>Riding</h3>
      <p>
        A resident on a tile with a free horse can mount it, and dismount anywhere; the horse stays
        where they get off. Another realm's or city's is stolen by that (below). A rider goes
        wherever they walk at the speed the horse would pull a carriage there (the carriage column
        above), never up onto walls, and into mountains only along a finished road, like a carriage.
        A horse with less than {pct(HORSE_HUNGRY_SHARE)} of its hunger meter left goes at{' '}
        {pct(HUNGRY_HORSE_PACE)} of its pace. Riding trains Driving like driving does, and Driving
        makes riding faster. A rider carries no more than on foot, and can't drive a carriage; a
        ridden horse is never hitched. A hungry ridden horse eats Food on the ground in reach first,
        then what its rider carries beyond their own {num(OWN_FOOD)} Food: the rider never goes
        without for the horse, so give a rider extra Food for a long ride. When a ridden horse goes
        hungry with nothing to spare, your realm log says so. On the map a rider sits on a horse
        token, and up close their activity icon is a horseshoe while they ride somewhere.
      </p>
      <p>
        A rider’s Doing line says <em>Riding to …</em> where it would say <em>Walking to …</em>, and
        their card shows the horse they ride: its stats, age, health and hunger, and that it eats
        from their spare Food, with <strong>Dismount</strong> under Orders.
      </p>
      <p>
        A grown resident on the tile of another realm's or city's free horse can steal it: its card,
        or the resident's, offers <strong>Mount their horse (theft)</strong>, and a script's{' '}
        <code>mount</code> naming that horse does the same. A carriage of yours with no horse of
        yours there can take it too: <strong>Drive with their horse (theft)</strong> hitches it, and
        a script's <code>drive</code> does so if it names the horse. A horse of yours on the tile
        always goes first and nothing is stolen. Either way the horse joins your realm at once. It
        can't be taken while someone rides it or it pulls a carriage, nor while an armed resident of
        its owner stands on the tile and none of your realm does; a stable doesn't protect it. A
        Down horse can't be ridden or hitched, so Feed it first. Nothing that picks a horse by
        itself ever does this: default scripts, Breed horses, group orders and queue steps keep to
        your own. Its owner's realm log says at once that it is gone and where it was last; who took
        it they learn only from a witness (see Standing). One that belongs to nobody is simply
        yours. Someone on loan to your realm steals none to ride.
      </p>
      <h3>Passengers</h3>
      <p>
        A resident standing on a carriage of their realm can <strong>Board</strong> it from their
        card, children too; a rider dismounts first, and the driver can't board. Each passenger
        counts as {num(PASSENGER_WEIGHT)} kg against what the carriage holds, so it carries goods,
        people or a mix: a full carriage takes nobody more, and no goods while people fill it.
        Aboard, they stop what they were doing, ride along wherever the carriage is driven, and
        don't walk on their own. <strong>Get off</strong> puts them on the carriage's tile, or a
        script's <code>getOff(x, y)</code> on a tile right next to it. Giving a passenger a walk, or
        an order that acts on a tile (work, build, goods, fight and so on), gets them off first and
        then goes on. On the map passengers ride inside the carriage, which shows how many it
        carries; clicking it opens its card, which lists them under its load with how much of its
        weight is people and picks one when you click their name (a box drag takes them in too). A
        passenger's Doing line says "Aboard a carriage" and where it is heading while it is driven,
        and picking them shows the carriage's way ahead. Struck, an unarmed passenger stays aboard
        while it is driven (see Under attack). Scripts see a resident's <code>aboard</code> and a
        carriage's <code>passengerIds</code> and <code>standsStill</code>.
      </p>
      <p>
        In realm control mode a carriage’s or vessel’s own card gives these orders the other way
        round: Haul with this carriage, Drive this to, Row this to or Board first, then who, from
        the who-list, with anyone far off walking there first (see Controls, Control modes).
      </p>
      <p>
        <strong>Refilling from a carriage:</strong> any of your residents on or next to a carriage
        of your realm, the driver, passengers, or someone waiting or working beside it after the
        drive, eats the food they carry, and when they run low takes a meal from the carriage's
        Food, as at home, so a carriage with Food on board keeps them fed on a long drive and
        wherever it is parked. The Food a haul route keeps on board is left for the horse and the
        driver: others don't touch it, and the driver leaves the horse's share of{' '}
        {num(HAUL_HORSE_FOOD)}. Beside a carriage without Food they go hungry like anyone away from
        home.
      </p>
      <p>
        The group card boards everyone of the group standing on the carriage at once, until it is
        full, and a notice says who was skipped and why; its Get off gets them all off. Board and
        Get off are queue steps too: Board ends once they are aboard and Get off once they are off,
        so put a step that waits for the stop between them (a script that calls <code>end()</code>{' '}
        once they are there), e.g. board, wait, get off, work. A Board step whose carriage has left
        their tile by its turn is skipped.
      </p>
      <p>
        A resident given <strong>Feed the stable</strong> in a stable keeps Food there for{' '}
        {days(STABLE_FEED_DAYS)} for the horses in it ({num(HORSE_FOOD_PER_DAY)} a horse a day):
        below that they fetch what is missing from the nearest storage of your realm with Food, or
        from the one picked as <code>source</code> on their card, and store it in the stable;
        otherwise they wait there. Feed the stable can be run directly too, with Run script or as a
        queue step: they feed the stable in its <code>stable</code> param, or with none picked the
        one they stand in when it starts. Giving Feed the stable in a stable fills it; it is never
        kept between starts. With no stable there, or once theirs is gone, Feed the stable ends and
        your realm log says why.
      </p>
      <p>
        It can also run <strong>once</strong>: the queue step <strong>Feed the stable once</strong>{' '}
        (or its <code>once</code> param set to 1) fetches what the stable is missing, stores it, and
        ends once the stable is full, so the queue goes on to its next step. With no Food to fetch
        it ends too, and your realm log says why. A start without it keeps the stable fed as before.
      </p>
      <h3>Horse offer</h3>
      <p>
        Every Player may claim {num(HORSE_GRANT_HORSES)} new horses once, whenever they choose and
        whether or not they have horses: a notice at the top of the screen has a Claim button until
        they do. The horses get new stats and ages and go in your finished stable nearest your
        Leader's city; with no stable, they stand next to that city's storage (or next to your
        Leader), each with {num(HORSE_GRANT_FOOD)} Food on the ground by it. The realm log says
        where they are. Once claimed the offer is gone, also after your Leader dies and you found a
        new realm; while you have no living Leader you can't claim it. An admin can offer horses
        again, to every Player or to one: if you had claimed, the notice comes back and you may
        claim once more, whether or not you still have horses. If you hadn't, you still have just
        the one claim.
      </p>
      <h3>Deliveries and transfers</h3>
      <p>
        A Trade Org caravan brings what you buy to your city's storage, at most {num(DELIVERY_LOAD)}{' '}
        kg at a time, for {num(DELIVERY_FEE_BASE)} coins plus {num(DELIVERY_FEE_PER_KG_TILE, 5)}{' '}
        coins for each kg and tile. A transfer to another realm costs {num(TRANSFER_FEE_FACTOR)}{' '}
        times a delivery's fee over the caravan's whole way.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Load</th>
            <th>Distance</th>
            <th>Delivery fee</th>
            <th>Transfer fee</th>
          </tr>
        </thead>
        <tbody>
          {feeExamples(loads).map((f) => (
            <tr key={`${f.kg}-${f.tiles}`}>
              <td>{num(f.kg)} kg</td>
              <td>{num(f.tiles)} tiles</td>
              <td>{num(f.delivery)} coins</td>
              <td>{num(f.transfer)} coins</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        Caravans walk with {num(CARAVAN_ESCORTS)} escorts, one more for every{' '}
        {num(CARAVAN_ROBBERIES_PER_ESCORT)} robberies of their route, at most{' '}
        {num(CARAVAN_ESCORTS_MAX)}.
      </p>
      <p>
        A caravan outlives its crew. When its driver dies a surviving escort takes over driving.
        With no crew left its carriage stands where it is, and the HQ sends a new driver on foot
        once it has an adult free. Stealing a caravan's carriage takes beating its crew first: it
        can't be driven off while its driver or an armed escort is up and within{' '}
        {num(CARAVAN_GUARD_RANGE)} tiles of it, so one still walking out doesn't stop you. It is one
        theft from the Trade Organization, worth the carriage, horse and load, and robs the caravan:
        its route counts the robbery and the delivery or transfer goes again. The same caravan gets
        a new carriage and horse at the HQ, and any surviving crew walk back to it.
      </p>
      <p>
        The HQ also sends out up to {num(TRADERS)} wandering traders, each a carriage with a driver
        and {num(TRADER_ESCORTS)} escorts, round a fixed loop of the trading posts and the HQ. At
        each stop a trader evens out its load with the warehouse, every good including Food and
        Coins: it leaves what that place has less of and takes what it has more of, as far as the
        carriage holds, every good cut alike when it can't hold it all. That is how a post comes to
        hold goods it doesn't produce, and caravans carry no Food or Coins, so a post gets those
        only from traders. The HQ is a stop like a post, its Coins going through its coin warehouse
        and its other goods through its goods warehouse, so new Food and Coins reach the posts, and
        a trader's lost escorts are made up there each time round. Its crew and a lost carriage go
        as for a caravan, and robbing one is a theft from the Trade Organization, but it owes nobody
        a delivery, so nothing is sent again.
      </p>
      <p>
        A caravan or trader leaves the HQ only with enough Food for its crew and horse to reach its
        next stop, so when the HQ is short, as in a new world, its carriages stand and wait. They
        leave the storage what the HQ's own people eat in {num(HQ_PEOPLE_FOOD_DAYS)} days, but may
        always take {num(WAITING_HORSE_FOOD)} Food for the horse. Short of Food, they top up from
        the goods warehouse, which the stock floor fills each day, so buying Food there can keep
        them waiting a little longer. A caravan with a delivery or transfer waiting wants all it
        keeps on board, as there is no Food on that way. A caravan away from the HQ takes what a
        post's storage has and drives on. A wandering trader waits at a post as at the HQ: it leaves
        only with enough Food to reach its next stop, topping up from the post's goods warehouse,
        and stands there until that has some.
      </p>
      <p>
        On its way a wandering trader stops at each NPC or Player city whose town hall lies within{' '}
        {num(TRADER_STOP_REACH)} tiles of its route, for{' '}
        {days(TRADER_STOP_TICKS / TICKS_PER_GAME_DAY)}. It stands on a free tile as near the town
        hall as it gets outside the walls, so closed gates don't stop it. You get a notice with the
        place while one stands at one of your cities; see <a href="#how-to-trade">How to trade</a>.
      </p>
      <p>
        A captured post leaves the Trade Organization at once, but it learns who took it only by
        news. A trader that reaches the post drops it from its loop and carries the news on, and
        anyone of the Trade Organization who saw the capture and gets away carries it too. Once one
        of them stands at another post or the HQ, the capture is a crime it knows of (see Standing),
        and it demands the city back with a debt for its worth. If they are killed on the way and no
        trader ever gets there, it never reacts.
      </p>
    </>
  )
}
