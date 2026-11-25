import {
  GOOD_WEIGHT,
  MAINLAND_SHARE,
  ISLAND_COUNT,
  HEARTLAND_COUNT,
  FRONTIER_REGION_COUNT,
  FRONTIER_NODE_DENSITY,
  ISLAND_NODE_DENSITY,
  GOLD_NODE_DENSITY,
  START_COINS,
  REGION_BORDER_WIDTH,
  PASS_WIDTH,
  SECOND_WAY_SHARE,
  NPC_STEEL_KIT,
  PROTECTION_DEFENCE,
  STABLE_HAND_FEED_DAYS,
  STABLE_HAND_WORK_MINUTES,
  START_HORSES,
  START_RESIDENTS,
  START_SPEARS,
  START_STONE,
  START_TOOLS,
  START_WOOD,
  STARTING_SITE_WALK,
  STARTING_SITE_NODE_REACH,
  STARTING_SITE_FOREST_REACH,
  HEARTLAND_GROVE_SPACING,
  STARTING_SITES_PER_HEARTLAND,
  WALK_TICKS_PER_TILE,
  WAREHOUSE_FLOOR,
  WEAPON_ATTACK,
  RECIPES,
  WORK_OUTPUT_PER_DAY,
  RICHNESS_FACTOR,
  FRONTIER_RICH_NODES,
  RICHER_NODE_REACH,
  VEIN_CREW_DAYS,
  VEIN_STOCK,
  VEIN_THINNING,
  VEIN_NEARLY_GONE,
  NEW_VEIN_SPOT_REACH,
} from '@csp/balance'
import type { Good } from '@csp/shared-types'
import { Table } from './parts.js'
import { goodName, forged } from './names.js'
import { batchesPerDay, days, duration, num, pct, signed } from './wiki-view.js'

/** A smelter's Steel recipe (`CONTEXT.md`: Coal): its second, after Iron. */
const STEEL = RECIPES.smelter!.find((r) => 'steel' in r.output)!

/** Each steel weapon or piece of armour beside the iron one it beats (`CONTEXT.md`: Coal). */
const STEEL_GEAR: [Good, Good][] = [
  ['sword', 'steelSword'],
  ['shield', 'steelShield'],
  ['armour', 'steelArmour'],
]

/** What a weapon or piece of protection adds in a fight: its attack, or what it takes off a blow. */
const gearValue = (good: Good) =>
  (({ ...WEAPON_ATTACK, ...PROTECTION_DEFENCE }) as Record<string, number>)[good]!

export function LandSection() {
  return (
    <>
      <p>
        The land is one <strong>mainland</strong> and, off its coasts, <strong>islands</strong>,
        with Sea all around. The mainland covers about {pct(MAINLAND_SHARE)} of the map, and up to{' '}
        {num(ISLAND_COUNT)} islands lie off it. Any tile of the mainland can be reached on foot, and
        by carriage, from any other. An island is reached only by vessel: a boat or a ship from a
        haven (see Water &amp; havens).
      </p>
      <p>
        All land lies in a <strong>region</strong> of one of three kinds. The mainland has{' '}
        {num(HEARTLAND_COUNT)} <strong>heartlands</strong>, good farmland in its middle where
        Players start, and {num(FRONTIER_REGION_COUNT)} <strong>frontier</strong> regions beyond
        them, where nobody starts. Each island is a region of its own. No rule keeps a heartland
        safe: it is safe only in that it holds little worth taking.
      </p>
      <p>
        <strong>Coal</strong> lies only out there: its nodes are in Hills and, more of them,
        Mountain of the frontier regions and the islands, never in a heartland. A mine built on a
        coal node yields Coal, {num(WORK_OUTPUT_PER_DAY.coal ?? 0)} a game day for an average
        worker, and teaches Mining. Coal is carried, stored, hauled and traded like any other good;
        it weighs {num(GOOD_WEIGHT.coal ?? 0)} kg a unit, and trading posts and the HQ buy and sell
        it. Your realm’s Coal shows in the top bar beside its Food, Wood and Stone.
      </p>
      <p>
        A smelter turns Iron and Coal into <strong>Steel</strong>: {num(STEEL.input.iron ?? 0)} Iron
        and {num(STEEL.input.coal ?? 0)} Coal make {num(STEEL.output.steel ?? 0)} Steel, so an
        average smelter worker makes {num(batchesPerDay('smelter') * (STEEL.output.steel ?? 0))}{' '}
        Steel a game day. Whether a smelter’s worker makes Iron or Steel is said when they are given
        Work there, as a smith says what to forge; told nothing, they make Iron. Set to Steel
        without Coal, they stand idle and their Doing line says what is missing. Steel weighs{' '}
        {num(GOOD_WEIGHT.steel ?? 0)} kg a unit, is stored and traded like any good, and shows in
        the top bar beside Coal.
      </p>
      <p>
        A smithy forges a <strong>steel</strong> Sword, Shield and Armour from Steel and Wood, each
        better than the iron one and as heavy; the Spear is iron only. The smith says which when
        given Work there, as for the iron ones.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Gear</th>
            <th>Made from</th>
            <th>Iron one</th>
            <th>Steel one</th>
          </tr>
        </thead>
        <tbody>
          {STEEL_GEAR.map(([iron, steel]) => (
            <tr key={steel}>
              <td>{goodName(steel)}</td>
              <td>
                {num(forged(steel).input.steel ?? 0)} Steel, {num(forged(steel).input.wood ?? 0)}{' '}
                Wood
              </td>
              <td>{signed(gearValue(iron) * (iron === 'sword' ? 1 : -1))}</td>
              <td>{signed(gearValue(steel) * (iron === 'sword' ? 1 : -1))}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        <strong>NPC cities and Steel.</strong> An NPC city that knows of a coal node wants a{' '}
        {NPC_STEEL_KIT.map((g) => goodName(g as Good).toLowerCase()).join(', ')} for each of its
        soldiers, in that order, instead of a spear. So it keeps them, their Steel and Wood, and the
        Iron and Coal for that Steel and the Iron ore for that Iron in its reserve, mines Coal, sets
        every second smelter it builds to Steel, forges the steel gear and arms its soldiers with
        it: a soldier fetches each piece from its storage once it holds one and puts back the spear
        it outdoes. A city with no coal node in reach, as in a heartland, stays on the iron spear.
        NPC cities price Coal, Steel and the steel gear like any good and sell what they hold above
        their reserve, and lent residents take the best gear of the surplus, steel first. The Trade
        Organization’s warehouses trade the steel gear too (a floor of{' '}
        {num(WAREHOUSE_FLOOR.steelSword ?? 0)} each at a post), and its HQ and posts arm their
        soldiers with steel as far as their warehouse holds it, iron otherwise.
      </p>
      <p>
        Each heartland has {num(STARTING_SITES_PER_HEARTLAND)} <strong>starting sites</strong>, a
        walk of {num(STARTING_SITE_WALK.minMinutes)} to {num(STARTING_SITE_WALK.maxMinutes)} real
        minutes from the next one. A new Leader (your first, or one after your Leader died with no
        heir) gets a free site in the <strong>open</strong> heartland where Players have the most
        cities, the one opened first on a tie, and in it the free site nearest another Player’s
        city: you start as someone’s neighbour. The world’s first Player opens the first heartland;
        the next one opens, the one nearest an open heartland, only once no open heartland has a
        free site left. A site is free while nothing of anyone’s stands on it or on the farmland
        round it, so one whose city is gone is free again. Should every site be taken, your city
        goes on the free place nearest an open heartland’s middle. Your realm log names the
        heartland your city stands in.
      </p>
      <p>
        Every starting site has a poor stone and iron node within {num(STARTING_SITE_NODE_REACH)}{' '}
        tiles of its middle, and a poor forest node within {num(STARTING_SITE_FOREST_REACH)} tiles,
        about {duration(STARTING_SITE_FOREST_REACH * WALK_TICKS_PER_TILE)} on foot over Plains, so
        Wood is close from the start. A heartland’s Forest lies in wide patches; where none lies
        near, a small grove of Forest grows on its Plains, at most one every{' '}
        {num(HEARTLAND_GROVE_SPACING)} tiles.
      </p>
      <p>
        Resource nodes lie thicker away from home: a frontier region holds{' '}
        {num(FRONTIER_NODE_DENSITY)} times as many as a heartland, an island{' '}
        {num(ISLAND_NODE_DENSITY)} times. <strong>Gold ore</strong> is a rare good like Coal: no
        gold node lies in a heartland, only in the frontier and on islands, where it is{' '}
        {num(GOLD_NODE_DENSITY)} times as common again. Every frontier region has a gold node and a
        coal node in it or in a region next to it. So a heartland realm gets its Coins by trade,
        selling Food, Wood, Stone or Iron at its heartland’s trading post, or by holding a gold node
        out there. Your starting city’s storage holds {num(START_COINS)} Coins for a first trade.
      </p>
      <p>
        <strong>Starting city.</strong> A new Leader’s city starts with {num(START_RESIDENTS)}{' '}
        residents, your Leader among them, working the farm. Every grown one, your Leader too,
        carries {num(START_SPEARS)} iron Spear, so they are armed from the first tick and an alarm
        sends them to defend the city. Children get none, and no spare weapons lie in the storage.
        Beside its Food and Coins, the storage holds {num(START_WOOD)} Wood and {num(START_STONE)}{' '}
        Stone for a first building, and {num(START_TOOLS)} sets of Tools for residents to fetch. NPC
        villages keep their own start.
      </p>
      <p>
        <strong>First steps.</strong> Before any camp or quarry stands, your residents can{' '}
        <a href="#gathering">gather by hand</a>: give a few of them Gather (Wood) on their card and
        they bring load after load of Wood from the forest beside the city to its storage, enough
        for your first houses while you look for nodes.
      </p>
      <p>
        One resident of your starting city, never your Leader, is its <strong>stable hand</strong>.
        They start on a looped queue, <strong>Farm and feed</strong>: if the stable holds less than{' '}
        {days(STABLE_HAND_FEED_DAYS)} of Food for its {num(START_HORSES)} horses, Feed the stable
        once; then work the farm for {num(STABLE_HAND_WORK_MINUTES)} game minutes; again. So your
        horses don’t starve while you are away, as long as the storage has Food. Their card shows
        the queue under its name like any queue, which you can change or clear, and the planner’s
        Saved… lists it among your saved queues in this browser.
      </p>
      <p>
        The regions of the mainland are parted by Mountain ranges and by arms of the Sea, about{' '}
        {num(REGION_BORDER_WIDTH)} tiles across, and joined only by a few ways through: a{' '}
        <strong>pass</strong> is a gap of Hills in a range that a carriage can cross, a{' '}
        <strong>land bridge</strong> a narrow neck of land between two arms of the Sea. Each is
        about {num(PASS_WIDTH)} tiles wide, and about {pct(SECOND_WAY_SHARE)} of the borders have
        two of them instead of one. Whoever holds a pass or a land bridge holds the way between two
        regions.
      </p>
      <p>
        You know the region of every tile you have explored. A tile’s card names it: “Heartland of
        …”, “Frontier: …” or “Island: …”, with “pass” or “land bridge” on a tile of one. Zoomed out
        to the middle and far zoom, the map writes the names of the regions you have explored part
        of over them and marks the passes (a white diamond) and land bridges (a blue one) you have
        explored. Nothing shows for land you haven’t explored. This is not the Region map, which
        shows territory (see Territory).
      </p>
      <p>
        Scripts read a tile’s region in its view: <code>region</code> is its name and{' '}
        <code>regionKind</code> is <code>"heartland"</code>, <code>"frontier"</code> or{' '}
        <code>"island"</code>, both <code>null</code> on water and on tiles you haven’t explored.
      </p>
      <p>
        Every resource node is <strong>poor</strong>, <strong>normal</strong> or{' '}
        <strong>rich</strong>, from the day it comes into being. A mine, quarry or lumber camp on it
        makes {num(RICHNESS_FACTOR.poor)}, {num(RICHNESS_FACTOR.normal)} or{' '}
        {num(RICHNESS_FACTOR.rich)} times as much per worker; workers, skill and Strength count as
        ever. Heartland nodes are poor. Frontier nodes are normal, but for the{' '}
        {num(FRONTIER_RICH_NODES)} of each frontier region nearest its passes, land bridges and
        borders with another frontier region, which are rich. Island nodes are rich. Farms stand on
        no node and make the same everywhere.
      </p>
      <p>
        A node’s card says its richness once you have explored its tile, with what a worker of
        average Strength makes there a game day; so does the card of the workplace on it, and its
        Made a game day list counts it in. Scripts read it as the node’s <code>richness</code>:{' '}
        <code>"poor"</code>, <code>"normal"</code> or <code>"rich"</code>. NPC cities and the Trade
        Organization pick the richer of two nodes about as far away: each step of richness counts as{' '}
        {pct(RICHER_NODE_REACH)} less of the way.
      </p>
      <p>
        A normal or rich ore node (iron ore, gold ore or coal) holds a <strong>vein</strong> that
        working it uses up: each unit its mine makes takes one from it. A normal iron ore or coal
        vein holds {num(VEIN_STOCK.ironOre.normal)} units, a rich one {num(VEIN_STOCK.ironOre.rich)}
        ; a gold ore vein {num(VEIN_STOCK.goldOre.normal)} or {num(VEIN_STOCK.goldOre.rich)}. That
        is {num(VEIN_CREW_DAYS.normal)} or {num(VEIN_CREW_DAYS.rich)} game days of a full crew of
        average workers. Poor nodes, forest and stone never run dry, so a heartland realm always
        keeps what its land gives.
      </p>
      <p>
        Whoever works a mine, your realm and your allies, sees how its vein stands on the mine’s
        card, in words and never as a number: <em>plenty</em> while more than {pct(VEIN_THINNING)}{' '}
        of what it first held is left, <em>thinning</em> from there, <em>nearly gone</em> at{' '}
        {pct(VEIN_NEARLY_GONE)} or less. A workplace on a node that never runs dry says so. Your
        realm log says once when a mine you work turns to thinning and once when it is nearly gone.
        Others, who work nothing there, see the node and its richness only. Your scripts read the
        word as a building’s <code>vein</code>.
      </p>
      <p>
        Once a vein runs dry its node is gone for good. The mine stays standing and makes nothing:
        its workers stop, each one’s log saying “the vein ran dry”, and your realm log says so once.
        You can tear the mine down like any building, but no mine can be built there again. Others
        who explored the tile still see the node on their map until they see the tile again.
      </p>
      <p>
        The land does not run out, though. The moment a vein runs dry a new node of the same kind
        and richness comes into being somewhere else: a normal one in a frontier region, a rich one
        on an island or within {num(NEW_VEIN_SPOT_REACH)} tiles of a pass, land bridge or frontier
        border, gold and coal never in a heartland, and in another region than the old one wherever
        one fits. It appears out of everyone’s sight and, where the map allows, on land nobody has
        explored. Nobody is told: you have to find it. If you had explored its tile before, your map
        shows no node there until one of your residents sees the tile again.
      </p>
      <p>
        NPC cities and the Trade Organization move on too. When the mine an NPC city or a trading
        post works runs dry, its workers are free at the city’s next planning pass and the city,
        still short of the ore, opens a mine on the next fitting node it knows of within its reach.
        Its builders tear the dead mine down for its materials once they have nothing better to do.
        With no other node known it buys the ore, or the goods made from it, from a trader or goes
        without, and a node its scouts find later counts from then on. The Trade Organization’s HQ
        takes the next nearest node of the kind, however far away it lies.
      </p>
    </>
  )
}
