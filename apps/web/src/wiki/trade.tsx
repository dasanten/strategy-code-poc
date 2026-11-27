import {
  BUY_SHARE,
  TRADER_FLOOR_SHARE,
  TRADER_STOP_REACH,
  CITY_GRID_BLOCK,
  CITY_RING_STEP,
  CITY_SIDE_LANE_GAP,
  CITY_QUARTER_ROWS,
  HQ_FLOOR_FACTOR,
  HQ_FOOD_FLOOR_FACTOR,
  HOUSING_ROOM,
  FOOD_PER_DAY,
  NPC_BUILDERS,
  NPC_INNER_WALL_REACH,
  NPC_STONE_WALL_RESIDENTS,
  NPC_WALL_STONE_SET_ASIDE_TILES,
  NPC_ROAD_CREW,
  NPC_ROAD_LONGEST,
  NPC_CITY_MIN_DISTANCE,
  NPC_FOUND_FOOD_DAYS,
  NPC_FOUND_GIVE_UP_DAYS,
  NPC_FOUND_PARTY_MOST,
  NPC_FOUND_ESCORT_SHARE,
  NPC_ESCORT_TOWN_RESIDENTS,
  NPC_TRADER_ESCORTS,
  NPC_FOUND_REACH,
  NPC_FOUND_RESIDENTS_PER_MEMBER,
  NPC_FOUND_STANDING,
  NPC_FOUND_VILLAGE_RESIDENTS,
  NPC_FULL_DAYS,
  NPC_FULL_DAYS_LEAST,
  NPC_STARTING_SITE_CLEARANCE,
  NPC_TOWNS_PER_FRONTIER,
  NPC_VILLAGES_PER_FRONTIER,
  NPC_VILLAGES_PER_HEARTLAND,
  NPC_WAY_CLEARANCE,
  TRADING_POST_REGION,
  NPC_FULL_DIP_DAYS,
  NPC_FOUND_FOOD_SURPLUS_SHARE,
  NPC_FULL_RESIDENTS_PER_DAY,
  NPC_VILLAGE,
  NPC_NODE_REACH,
  NPC_RESIDENTS_PER_NEEDS_STEP,
  NPC_RESIDENTS_PER_SCOUT,
  NPC_SCOUT_LIMIT,
  NPC_TRADER_GIVE_UP_DAYS,
  NPC_OFFER_REACH,
  NPC_RESIDENTS_PER_TRADER,
  NPC_TRADER_REACH,
  NPC_PLAN_TICKS,
  NPC_SURPLUS_CAP,
  NPC_SURPLUS_PAST_CAP,
  NPC_SOLDIER_SHARE,
  NPC_WAR_CHEST_PER_RESIDENT,
  NPC_TOOLS_SPARE,
  NPC_TRADE,
  PRICE_ELASTICITY,
  PRICE_RANGE,
  PRICE_REFERENCE_FLOORS,
  MOUNTAIN_ROAD_WORK_FACTOR,
  STABLE_CAPACITY,
  NPC_HORSES_BASE,
  NPC_RESIDENTS_PER_HORSE,
  NPC_STABLE_HUNGRY_DAYS,
  NPC_STABLE_REFILL_DAYS,
  NPC_START_HORSE_FOOD_DAYS,
  NPC_START_HORSES,
  STABLE_FEED_DAYS,
  NPC_JOB_WEIGHTS,
  WAREHOUSE_BASE_PRICE,
  WAREHOUSE_FLOOR,
  WORKPLACE_MAX_WORKERS,
  WORK_OUTPUT_PER_DAY,
  NPC_FOOD_REFILL_DAYS,
} from '@csp/balance'
import { NPC_SMITHY_WEAPON } from '@csp/shared-types'
import { GOOD_LABELS } from '../residents/Residents.js'
import { Table } from './parts.js'
import { goodName } from './names.js'
import { days, num, pct, priceAt, realTimeOf } from './wiki-view.js'
import type { PricedGood } from './wiki-view.js'
import { TradeNpcTemperPart } from './trade-npc-temper.js'

export function TradeSection() {
  return (
    <>
      <p>
        A Trade Org warehouse, at the HQ or a trading post, trades in person with whoever stands on
        it: a Player's resident or carriage, or an NPC city's trader.
      </p>
      <p>
        Each warehouse prices every good from its own stock. At {num(PRICE_REFERENCE_FLOORS)} times
        its stock floor it sells at the base price; less stock costs more (to the power{' '}
        {num(PRICE_ELASTICITY)}), between {pct(PRICE_RANGE.min)} and {pct(PRICE_RANGE.max)} of the
        base price. It buys at {pct(BUY_SHARE)} of its selling price. Each unit is priced as it
        moves, so a big trade moves the price as it goes. A swap goes at these same prices (see{' '}
        <a href="#how-to-trade">How to trade</a>).
      </p>
      <p>
        A wandering trader at a stop prices the same way from what it carries, as if its floor were{' '}
        {pct(TRADER_FLOOR_SHARE)} of a warehouse's, buying lower than it sells. An NPC city treats
        it as its visiting trader: a spare hand brings over its surplus and buys what the city is
        short of, Food included but never a weapon.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Good</th>
            <th>Base price</th>
            <th>Warehouse pays</th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(WAREHOUSE_BASE_PRICE) as PricedGood[]).map((g) => {
            const p = priceAt(g, PRICE_REFERENCE_FLOORS)
            return (
              <tr key={g}>
                <td>{goodName(g)}</td>
                <td>{num(p.sell)}</td>
                <td>{num(p.buy)}</td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <h3>How Iron's price follows stock</h3>
      <Table>
        <thead>
          <tr>
            <th>Stock, in floors</th>
            <th>Sells at</th>
            <th>Pays</th>
          </tr>
        </thead>
        <tbody>
          {[
            0.5,
            1,
            2,
            PRICE_REFERENCE_FLOORS,
            PRICE_REFERENCE_FLOORS * 2,
            PRICE_REFERENCE_FLOORS * 8,
          ].map((f) => {
            const p = priceAt('iron', f)
            return (
              <tr key={f}>
                <td>{num(f)}</td>
                <td>{num(p.sell)}</td>
                <td>{num(p.buy)}</td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <h3>NPC cities</h3>
      <p>
        When the world is made, NPC cities are placed region by region, wherever there is room: in
        each frontier region {num(NPC_TOWNS_PER_FRONTIER)} town(s) and{' '}
        {num(NPC_VILLAGES_PER_FRONTIER)} village(s), in each heartland{' '}
        {num(NPC_VILLAGES_PER_HEARTLAND)} village(s). They stand on the mainland only: none on an
        island, none within {num(NPC_STARTING_SITE_CLEARANCE)} tiles of a starting site, and none
        within {num(NPC_WAY_CLEARANCE)} tiles of a pass or land bridge, with its farms. A full
        city's new village stays on land its people can walk to, never across the sea, and as far
        from the starting sites.
      </p>
      <p>
        An NPC city thinks over what its people do once a game hour ({realTimeOf(NPC_PLAN_TICKS)}
        of real time) and keeps to that plan in between: a worker stays where the city put them
        until it moves them, and a builder picks up the next piece of a project as soon as one is
        finished. Only its defence acts at once.
      </p>
      <p>
        An NPC city keeps a reserve: {days(NPC_TRADE.reserveFoodDays)} of Food for everyone; the
        materials for a house and {num(NPC_TRADE.reserveWallStretches)} tiles of wall; a{' '}
        {GOOD_LABELS[NPC_SMITHY_WEAPON].toLowerCase()} for each soldier it keeps and hasn't armed
        yet ({pct(NPC_SOLDIER_SHARE)} of its adults), with the Iron and Wood to forge them (a city
        that knows of a coal node keeps the steel gear instead, under Coal); and{' '}
        {num(NPC_WAR_CHEST_PER_RESIDENT)} coins a resident as its war chest. Coins below the war
        chest count as short only for a city that can earn them: one with a mint or gold mine, Gold
        ore in its storage, a gold node it knows of, a Trade Org warehouse within{' '}
        {num(NPC_TRADER_REACH)} tiles, or a wandering trader passing within {num(TRADER_STOP_REACH)}{' '}
        tiles on its loop. A city with none of these still keeps its war chest out of what it sells,
        but never waits on Coins it can't earn. A stable is wanted once it has a horse, or with none
        once nothing else is short, and what the stable lacks of {days(STABLE_FEED_DAYS)} of Food
        for its horses is in the reserve too; what the stable holds counts.
      </p>
      <p>
        A city with a smithy of its own, finished or begun, also keeps a set of{' '}
        <a href="#work">Tools</a> for each of its workers and builders who carries none (its adults
        beyond the soldiers it keeps) and {num(NPC_TOOLS_SPARE)} spare. It never sells them, but
        they never count as short either: its spare hands forge them, first of all surplus work
        while it holds fewer, from Iron and Wood above its reserve, and up to{' '}
        {num(NPC_SURPLUS_CAP.tools ?? 0)} more a step of its needs; its smithy forges them only once
        its soldiers are armed. So a city forging a set for every worker still founds, lays roads
        and trains. One grown, unarmed resident at a time who carries none, idle or at work, fetches
        a set from its storage, as soldiers fetch their weapons, and one whose set breaks fetches
        the next. Soldiers carry none. A trading post's and the HQ's workers fetch theirs from their
        warehouse, only what it holds above its floor of Tools.
      </p>
      <p>
        A city's needs grow in steps, one for every {num(NPC_RESIDENTS_PER_NEEDS_STEP)} residents. A
        village or town under {num(2 * NPC_RESIDENTS_PER_NEEDS_STEP)} residents counts as one step;
        from there on it is a big city. Each step keeps another house's and those wall tiles' Wood
        in its reserve, and each past the first {num(NPC_TRADE.reserveStonePerStep)} Stone. Its
        surplus caps, its builders and its road crew below are per step too.
      </p>
      <p>
        A new NPC village or town starts with {num(NPC_START_HORSES)} horses, with{' '}
        {days(NPC_START_HORSE_FOOD_DAYS)} of Food for each on the ground by them, and lays its
        stable out where they stand, so they are in it once it is finished. It breeds them up to{' '}
        {num(NPC_HORSES_BASE)} horses and one more for every {num(NPC_RESIDENTS_PER_HORSE)}{' '}
        residents, at most what a stable holds ({num(STABLE_CAPACITY)}), while Food isn't short. A
        founding party takes no horses, and a daughter gets its first when a Player sells it some.
        Trading posts and the HQ have none of this.
      </p>
      <p>
        One of its residents at a time feeds its stable, by the Feed the stable default: when the
        stable holds less than {days(NPC_STABLE_REFILL_DAYS)} of Food for its horses they fill it
        up, and work for the city in between. The Food comes from what is above the{' '}
        {days(NPC_TRADE.reserveFoodDays)} kept for its people. Below that only while a horse is
        hungry or Down, and then only {days(NPC_STABLE_HUNGRY_DAYS)} of Food for each such horse: a
        short city feeds its people first. Trading posts and the HQ don't do this.
      </p>
      <p>
        It shares out its adults in this order: soldiers; farmers, as many as feed everyone (each
        eats {num(FOOD_PER_DAY)} Food a day, a farmer makes {num(WORK_OUTPUT_PER_DAY.food ?? 0)})
        and one more while it has no food surplus; with its Food below its reserve but not yet
        running short, as many more as win back what it lacks in {days(NPC_FOOD_REFILL_DAYS)}, if
        that is more; a new farm when they don't fit; up to {num(NPC_BUILDERS)} builders a step
        while it has a project; everyone else is a spare hand. A farm is otherwise built only when
        Food is short of its reserve ({days(NPC_TRADE.reserveFoodDays)} of Food for everyone), or,
        with nothing else keeping it from being full, short of the Food surplus its founding waits
        on (below), with every farm at its full crew of {num(WORKPLACE_MAX_WORKERS.farm ?? 0)};
        never because spare hands filled the farms working for surplus. It needs nobody idle for
        that: the new farm's farmers come from those working for surplus and from its scouts first,
        and from other work only after them. A farm already begun is finished before another, and
        that new farm comes before anything else it has begun. Spare hands go to the good the
        reserve is shortest of, as a share of what it wants of it, filling one workplace's crew
        before the next. A workplace by a way where the city lost people (Threat) is worth less to
        it: each person lost there takes {num(NPC_JOB_WEIGHTS.danger)} from the work's score, at
        most {num(NPC_JOB_WEIGHTS.most)}. Of several workplaces of a good it picks the safest, and a
        worker leaves a dangerous camp for a safe one of the same good; a dangerous mine can lose to
        safe work on another good. Farming while Food is short is never weighed down. Without a
        workplace for that good, the city builds one: on the nearest fitting resource node it knows
        of, or a smelter, smithy or mint in its area like a house. With every workplace of another
        short good at its full crew and someone idle, it opens another of them, however many it has.
        It doesn't begin a building whose materials it has no way to get: a material it holds too
        little of must come from a workplace of its own, a node it knows of, or a Trade Org
        warehouse within its trader's reach. A town with no iron in reach builds no smithy, however
        much Iron its first stock held, and a building it can't finish waits, begun, without holding
        up its other building.
      </p>
      <p>
        Those with nothing to do, those carrying a child and its children stand at a house of the
        city rather than on its storage, each at their own one, and stay there: they eat where they
        stand, as anyone does in their own city's area, and leave when the city has work for them. A
        city with no house has them at home. Its soldiers stand apart from this, and trading posts
        and the HQ don't do it.
      </p>
      <p>
        An NPC city sets out its town by a layout, picked at random when it comes to be (a
        self-managed city when its Leader dies) and kept. In Grid, square blocks{' '}
        {num(CITY_GRID_BLOCK)} tiles along each side lie between straight lanes a tile wide, left
        free for streets, with a lane through each gate. In Rings, houses stand in circles round the
        town hall, with a circular lane every {num(CITY_RING_STEP)} tiles between them and a lane
        from each gate to the middle; only a storage goes inside the first lane. In Main street, one
        straight street runs from the gate past the town hall, with buildings in rows along it; side
        lanes cross it every {num(CITY_SIDE_LANE_GAP)} tiles, and once the rows on the street are
        full, buildings go further back along those. In Quarters, two streets cross at the town
        hall, with houses north of them, workshops (smelter, smithy, mint, stable) south-west and
        storages south-east, each part in long rows in bands {num(CITY_QUARTER_ROWS)} tiles deep
        between lanes; a building whose part has no room left spills over into another. Houses,
        storages, smelters, smithies, mints and stables take the next spot of the layout that fits,
        nearest home first, inside its wall and on outward as the city grows; a lake or a rock only
        leaves a gap in a block, a circle or a row. Walls, gates, farms and workplaces on nodes go
        where they do anyway. A city from before layouts got one when they shipped: nothing was torn
        down, and new buildings follow it around what stands. Trading posts, the HQ and Players'
        cities have none.
      </p>
      <p>
        Its streets are real roads. Its road crew lays them ahead of its other roads, nearest home
        first, once its town hall, a house, a storage or a workshop stands beside a tile, and only
        from materials above its reserve. Tiles kept free for streets stay free, and a street stops
        at whatever already stands on its line. Like any road they belong to nobody.
      </p>
      <p>
        So it builds the whole chain its land allows, from the node up: weapons short wants a
        smithy, which wants Iron, so a smelter, which wants Iron ore, so a mine first, and the Wood
        and Stone the mine is built of before that. A smelter or smithy is worked only while the
        storage holds the input for a batch, which its workers take with them, and one of them
        fetches more when it runs out, as yours do. A good it knows no node of stays short: a
        village that knows no ore forges no weapons, and a mint is built only with Gold ore it knows
        of. What it stays short of, its trader buys.
      </p>
      <p>
        A spare hand with nothing short to work for doesn't stand idle. A few at a time, one for
        every {num(NPC_RESIDENTS_PER_SCOUT)} residents, go scouting: they explore with as much Food
        as they can carry, and turn back when it only just covers the way home. A new scout sets out
        only while that Food comes from above the city's reserve. A city knows every node within{' '}
        {num(NPC_NODE_REACH)} tiles; what a scout saw, out to {num(NPC_SCOUT_LIMIT)} tiles, it knows
        only once they step back into its area alive. A scout killed on the way brings nothing, and
        nothing protects them. What is short calls them home, with what they saw. Once a city knows
        its limit it stops scouting.
      </p>
      <p>
        What a scout brought home it can build on. Short of a good it knows no nearer node of, it
        puts up the workplace on a far one, and the crew works it like any other, its carrier
        bringing their Food on the way back from the storage. Knowing such a node, it no longer buys
        that good from its trader or founds a daughter for it. A place a scout or a builder finds no
        way to is given up, and it counts on no node there.
      </p>
      <p>
        The others stay at or go to one of the city's workplaces and work for surplus, past its
        reserve, the good furthest below its cap first. Each step of its needs caps it at{' '}
        {num(NPC_SURPLUS_CAP.food ?? 0)} Food, {num(NPC_SURPLUS_CAP.wood ?? 0)} Wood,{' '}
        {num(NPC_SURPLUS_CAP.stone ?? 0)} Stone, {num(NPC_SURPLUS_CAP.ironOre ?? 0)} each of Iron
        ore, Iron and Gold ore, {num(NPC_SURPLUS_CAP.coins ?? 0)} coins and{' '}
        {num(NPC_SURPLUS_CAP[NPC_SMITHY_WEAPON] ?? 0)}{' '}
        {GOOD_LABELS[NPC_SMITHY_WEAPON].toLowerCase()}s above what it keeps. A smelter, smithy or
        mint is worked for surplus only from input above the reserve. Once every good they could
        work for is at its cap they work on past it, the good least far past first, up to{' '}
        {num(NPC_SURPLUS_PAST_CAP)} times its cap, farms aside; only past that are they idle. What
        is short, its trader and a founding party still take them first, the next time it thinks. So
        its workplaces stay busy, and its trader has more to sell.
      </p>
      <p>
        With nothing short, a big city whose one lumber camp, quarry or mine has its crew full and
        its good below the cap opens a second of that kind, on the nearest node it knows. For
        surplus it opens no third, and none for a good at its cap.
      </p>
      <p>
        Ahead of scouting and that work comes its road crew: up to {num(NPC_ROAD_CREW)} spare hands
        a step, apart from its builders, build its streets, then road from its home to each of its
        workplaces outside its area, farms too, the nearest first. They follow the way a resident
        would walk, tile by tile, so a road goes round a lake, and they skip tiles that already have
        a road. One of them out on a way with a tile's materials and Food in hand lays the tiles
        nearest them before walking home to a street owed meanwhile. They only use materials above
        its reserve and what its project still needs; with none to spare, or with something short
        that they can work for, they go back to other work and bring back what they carry. Once its
        full wait is under way, they also leave a town hall's and a storage's materials untouched,
        so founding comes before roads. Like any road it belongs to nobody, and anyone can use it or
        tear it down; a tile torn down is laid again in time.
      </p>
      <p>
        With its workplaces joined the crew goes on: to the nearest Trade Organization warehouse
        within {num(NPC_TRADER_REACH)} tiles, its trader's reach, leaving out those of the HQ's
        inner ring, which keeps everyone out, and then to the edge of the area of its nearest
        neighbour, any city but the Trade Organization's. A big city, of{' '}
        {num(2 * NPC_RESIDENTS_PER_NEEDS_STEP)} residents or more, doesn't stop there: while it has
        materials to spare it goes on to its further warehouses within that reach and its further
        neighbours, one road at a time, the nearest first. A road two neighbours would each build is
        built by only one of them. A road on Mountain takes {num(MOUNTAIN_ROAD_WORK_FACTOR)} times
        the work here as anywhere. The crew takes Food along for the walk, goes back for more before
        a tile it couldn't walk home from on what it has, and fetches more when it runs low, as any
        builder does. A way longer than {num(NPC_ROAD_LONGEST)} tiles, or with no way through, is
        given up.
      </p>
      <p>
        A big city, from {num(2 * NPC_RESIDENTS_PER_NEEDS_STEP)} residents, builds beyond its needs.
        With nothing short, its outer wall standing with its gate, and materials above its reserve,
        it puts up an <strong>inner ring</strong> of wall round its town hall and storage, up to{' '}
        {num(NPC_INNER_WALL_REACH)} tiles from the hall's middle, tile by tile as it does its outer
        wall. It takes the shape that leaves fewest gaps, along its layout's streets where it can: a
        square on the lanes round the town hall in Grid, a circle on the first lane in Rings. What
        stands on its line leaves a gap, and a street it crosses stops at it. Its one gate stands in
        line with the outer gate and goes up last, so its people never lose the way to the storage;
        its own pass through the gate as they do any of its gates. It waits whenever something runs
        short or the outer wall is moving out, and it stays when the outer wall moves. Before that,
        with nothing short and materials above its reserve, it builds one{' '}
        <a href="#training">training ground</a> in its area, and its soldiers train there.
      </p>
      <p>
        Once it is a <strong>town</strong>, {num(NPC_STONE_WALL_RESIDENTS)} residents or more, an
        NPC city upgrades its wall to <strong>stone</strong> (see{' '}
        <a href="#transport">Upgrading to stone</a>): its outer gate first, then that wall tile by
        tile, nearest the gate first, and its inner ring once the outer one is all stone. It does
        this last of all its projects. While it does, its reserve sets aside the Stone of{' '}
        {num(NPC_WALL_STONE_SET_ASIDE_TILES)} tiles of stone wall for it: its roads, repairs and
        trade leave that Stone, a founding party's Stone counts only above it, and only its walls
        spend it. It never counts as short: its spare hands refill it working for surplus, so the
        wall doesn't pull them off other work. It upgrades a tile at a time once it holds a
        builder's trip of Stone it may spend, from what it sets aside or beyond its reserve, while
        its road crew is in and its wall is not moving out. A town with none builds a quarry for it,
        and its spare hands work it. A new outer wall it puts up when it grows is of stone once its
        old one was. Villages, starting cities and the Trade Organization's cities stay wooden.
      </p>
      <h3>Trading posts and the HQ</h3>
      <p>
        Every heartland has a trading post near its middle; the frontier gets one more in each
        stretch of about {num(TRADING_POST_REGION)} tiles across that has room. The HQ stands in a
        frontier region, as far from the starting sites as the mainland allows. None of them stands
        on an island, a pass or a land bridge, or within {num(NPC_STARTING_SITE_CLEARANCE)} tiles of
        a starting site, and the caravans and wandering traders drive from the HQ to every post over
        the passes and land bridges.
      </p>
      <p>
        The Trade Organization runs its own chain the same way. A trading post's reserve is its
        warehouse's stock floor ({num(WAREHOUSE_FLOOR.ironOre)} Iron ore,{' '}
        {num(WAREHOUSE_FLOOR.wood)} Wood, {num(WAREHOUSE_FLOOR.coins)} coins and so on), the HQ's{' '}
        {num(HQ_FLOOR_FACTOR)} times that, and {num(HQ_FOOD_FLOOR_FACTOR)} times its{' '}
        {num(WAREHOUSE_FLOOR.food)} Food for the traders to carry; their Food is their storage's,
        kept by their farmers. Their spare hands work and build for whatever their warehouses are
        short of, on the nearest node within {num(NPC_NODE_REACH)} tiles, and carry the output into
        the warehouse. A post never grows in people; the HQ grows only while it is too weak. Neither
        sends a trader or founds a city.
      </p>
      <p>
        Only the HQ's warehouses top up to their floor at the end of each game day, so the world
        always has a market of last resort. Nothing tops up a trading post's warehouse: its floor
        only says what its spare hands, caravan and wandering traders go for, and all it holds came
        by them or from people selling to it. A post can run dry, even of Food and Coins, and its
        prices climb as it does, so prices differ with what reached each post. Rob a trader or raid
        a post and you empty a real market. Its people and soldiers eat from its storage, which its
        farm fills, not from the Food on sale in the warehouse.
      </p>
      <p>
        The Trade Organization lives on in its trading posts should its HQ ever fall: they keep
        their warehouses, prices and soldiers and go on trading in person, but with no caravans and
        no traders their warehouses hold only what they had and what their own hands bring. What
        only the HQ gave it is gone for good: no deliveries or transfers, no army to hire and nobody
        sent out to punish. See "The fall of the HQ" for what that costs.
      </p>
      <p>
        Once one good's surplus makes a full load for one of its spare hands (beside the Food for
        the walk) and a Trade Org warehouse lies within {num(NPC_TRADER_REACH)} tiles, an NPC city
        sends that spare hand, never a soldier, as its trader: they carry the load and the coins
        above its war chest there, sell the load, buy the good shortest of its reserve that it has
        no node for (never Food or a weapon) as far as their coins and arms allow, and walk home to
        the storage. A city has one trader out for each {num(NPC_RESIDENTS_PER_TRADER)} of its
        residents, and a village keeps one; they spread over the goods with surplus, and only with
        no other good to sell does one take a second load of a good already on the road. None go
        while Food runs short or armed outsiders stand in its area. A city of{' '}
        {num(NPC_ESCORT_TOWN_RESIDENTS)} residents or more, a town, sends {num(NPC_TRADER_ESCORTS)}{' '}
        soldier with each trader as their escort, of the soldiers beyond those on its town hall and
        at its gates; a village's trader goes alone. The escort keeps pace with the trader: the
        trader waits for an escort fallen behind, and one gone ahead waits for the trader. It fights
        whoever goes for them and comes home with them. Nothing else protects them on the way; a
        trader not back after {days(NPC_TRADER_GIVE_UP_DAYS)} is given up, and the city may send
        another.
      </p>
      <p>
        The same trader goes to a Player's offer within {num(NPC_OFFER_REACH)} tiles, ahead of any
        warehouse run, when it gives what the city is short of and wants what it has spare or Coins,
        at a rate at least as good as its own prices, and the city doesn't refuse that realm. A
        direct offer is left to the realm it is for. They take as many times over as make up what it
        lacks and fit in their arms, never a weapon either way, and walk home with it. It looks once
        a game hour; while Food runs short only an offer that gives Food will send them. If the
        offer is gone or cut down when they get there, or there is no way in, they carry what they
        didn't spend back home. The Trade Organization never accepts offers.
      </p>
      <p>
        A city is full once it has had spare hands, idle, on a road crew, scouting or working for
        surplus, and none of Food, Wood and Stone short of its reserve for {days(NPC_FULL_DAYS)},
        with a food surplus and its founding party's materials above its reserve. Its war chest and
        its soldiers' gear and what that is made from (weapons, armour, bows, arrows, Steel, Iron,
        Iron ore, Coal) don't keep it from being full: it still works and buys them. Once it lacks
        nothing but its founding party's materials, those count as short: its spare hands gather
        them, it builds a workplace for one it has none of, and they are still spare hands while
        they do. Food, Wood and Stone come first, Food its surplus too: only once it holds{' '}
        {pct(NPC_FOUND_FOOD_SURPLUS_SHARE)} of its Food surplus cap past its reserve, and while full
        its farmers work to win that back as they do its reserve. While it saves for its party, none
        of its building spends the party's Wood and Stone: walls, repairs and other buildings wait
        until it holds what they need above its reserve and the party's, but its farms, lumber camps
        and quarries go ahead, and meanwhile it builds whatever else it wants that doesn't wait. The
        same holds once its daughter stands, for the Wood and Stone the daughter still lacks of the
        party's load, until its storage stands. Its walls may spend the Stone its reserve sets aside
        for them. Its workplaces come first as well: its spare hands go on a road crew, scout and
        work at its workplaces for surplus, and only those left over gather for the party. Past{' '}
        {num(NPC_FOUND_VILLAGE_RESIDENTS)} residents it waits a game day less for each{' '}
        {num(NPC_FULL_RESIDENTS_PER_DAY)} more, but at least {days(NPC_FULL_DAYS_LEAST)}. A dip
        below its reserve only restarts that wait if it lasts longer than {days(NPC_FULL_DIP_DAYS)},
        though nobody sets out during one. A full city founds a daughter. Once a game day it looks
        for a free Plains site {num(NPC_CITY_MIN_DISTANCE)} to {num(NPC_FOUND_REACH)} tiles away,
        with room for a village and on no realm's territory, nearest a node of a material it has
        none of in reach. A founding party of {num(NPC_VILLAGE.residents)} adults, one more for each{' '}
        {num(NPC_FOUND_RESIDENTS_PER_MEMBER)} residents past {num(NPC_FOUND_VILLAGE_RESIDENTS)} up
        to {num(NPC_FOUND_PARTY_MOST)}, sets out. One in{' '}
        {num(Math.round(1 / NPC_FOUND_ESCORT_SHARE))} of them, rounded down and at least one, is a
        soldier of its escort, as far as the city has soldiers beyond those on its town hall and at
        its gates; they fight for the rest on the way and stay as the daughter's first soldiers. The
        party carries a town hall's and a storage's materials, a house's for each{' '}
        {num(HOUSING_ROOM.house ?? 1)} members past {num(NPC_VILLAGE.residents)}, and Food for twice
        the walk and {days(NPC_FOUND_FOOD_DAYS)} there, with as many more adults as it takes to
        carry all of it. They come from its spare hands and its workers near home first, then from
        its farmers beyond those who feed it; while too few are at hand, its workers far out come
        home to set out and wait there. With too few hands to carry all of it, the party sets out
        once it holds the town hall's materials and its Food, and the city sends a second wave of
        carriers after it with the rest, as hands come free: while the town hall is going up they
        join the party, and once the daughter stands they carry what it still lacks to it, until its
        storage stands. Until then the daughter's own builders also fetch what it lacks from the
        mother's storage, with Food for the way, and that is no theft. Like the party, they stay as
        the daughter's residents. Hands sent back from far workplaces leave them, and none of them
        goes back to work there while called home. One too full for their own Food puts down what
        crowds it out at the storage first, so nobody sets out without it. The party builds the town
        hall, which founds the daughter: an NPC city of its own with a name from the game. It then
        builds its storage, a farm and a house, and once its storage holds the Wood of its reserve,
        its first wall, a ring {num(Math.floor(NPC_VILLAGE.size / 2))} tiles round its home. Mother
        and daughter start at a standing of {num(NPC_FOUND_STANDING)} toward each other, which fades
        like any other, and share nothing. A party whose town hall doesn't stand after{' '}
        {days(NPC_FOUND_GIVE_UP_DAYS)} gives up and walks home. Trading posts and the Trade
        Organization's HQ never found cities.
      </p>
      <TradeNpcTemperPart />
    </>
  )
}
