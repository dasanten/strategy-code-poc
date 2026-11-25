import {
  BUY_SHARE,
  CREW_FOOD,
  GET_FOOD_AT,
  GET_FOOD_TAKE,
  GOOD_WEIGHT,
  TOOLS_WORK_BONUS,
  TOOLS_WORK_DAYS,
  WAREHOUSE_FLOOR,
  MEND_RECIPE_SHARE,
  MEND_WORK_SHARE,
  WORN_PRICE_SHARE,
  NEARLY_BROKEN_PRICE_SHARE,
  WORK_SKILL_EFFECT,
  WORK_SKILL_MAX,
  WORKPLACE_MAX_WORKERS,
  WORKPLACE_SKILL,
  RECIPES,
  BATCHES_PER_DAY,
  WORK_OUTPUT_PER_DAY,
} from '@csp/balance'
import type { BuildingKind, Good } from '@csp/shared-types'
import { Table } from './parts.js'
import { kindName, goodName, goods, forged } from './names.js'
import {
  AVERAGE_STATS,
  batchesPerDay,
  coinsPerMintWorkerDay,
  days,
  goldMinersPerMintWorker,
  jobDays,
  minersPerSmelterWorker,
  num,
  outputPerDay,
  pct,
  residentsPerFarmer,
  wikiResident,
} from './wiki-view.js'

const skillName = (kind: BuildingKind) => {
  const skill = WORKPLACE_SKILL[kind] ?? ''
  return skill.charAt(0).toUpperCase() + skill.slice(1)
}

const NODE_WORK: { kind: BuildingKind; good: Good }[] = [
  { kind: 'farm', good: 'food' },
  { kind: 'lumberCamp', good: 'wood' },
  { kind: 'quarry', good: 'stone' },
  { kind: 'mine', good: 'ironOre' },
  { kind: 'mine', good: 'goldOre' },
  { kind: 'mine', good: 'coal' },
]

export function WorkSection() {
  const avg = AVERAGE_STATS.strength
  const strong = wikiResident({ strength: avg * 1.5 }, { mining: WORK_SKILL_MAX / 10 })
  return (
    <>
      <p>
        Workers make goods in proportion to their Strength, plus {pct(WORK_SKILL_EFFECT)} for each
        point of the workplace's skill. Output lands in the workplace's pile; one worker at a time
        carries a full load to their <code>output</code> storage, else their <code>storage</code>,
        else the nearest storage of their realm.
      </p>
      <p>
        A workplace's card says how much is being made there: what each of your workers there makes
        and how much a game day at their Strength and skill, and the total of each good. It is the
        pace while they have what they need, not a count of what has been made. Other realms'
        workers aren't counted, as their stats aren't known.
      </p>
      <p>
        A smelter, mint or smithy has no storage: it works what its workers carry and what lies in
        its pile. Once they lack the input for a batch (Iron ore, the Iron and Coal of Steel, Gold
        ore, or the Iron and Wood of what a smith makes), one worker at a time, picked at random,
        fetches a load of what is missing from their <code>input</code> storage, else their{' '}
        <code>storage</code>, else the nearest storage of their realm holding it, puts it on the
        pile and goes back to work; not while someone carries the output. With none anywhere they
        stand idle, and their Doing line says what is missing ("Idle: no coal").
      </p>
      <p>
        A smith can also <strong>mend</strong> (Mend on their card, or <code>workAt("mend")</code>
        in a script): they put the most worn weapon, piece of armour or set of Tools at the smithy
        back to good, from what its workers carry, its pile and what anyone of their realm standing
        on it carries. Mending a piece takes {pct(MEND_RECIPE_SHARE)} of its recipe, rounded, and at
        least one unit, and {pct(MEND_WORK_SHARE)} of the work of forging it. Only a worn or nearly
        broken piece is mended; with none there, or without the input, the smith stands idle. A worn
        piece sells and buys for {pct(WORN_PRICE_SHARE)} of a new one's price, a nearly broken one
        for {pct(NEARLY_BROKEN_PRICE_SHARE)}; a trade gives up new pieces first, then the least
        worn. An NPC city counts only gear in good condition towards its reserve: its soldiers take
        worn gear to its smithy, with what mending it takes, and wait there while one of its smiths,
        or a hand from elsewhere, mends it.
      </p>
      <p>
        Work's params on the card: <code>storage</code> is the main storage, used for the output,
        the inputs and Food alike. <code>output</code> (where the output goes), <code>input</code>{' '}
        (where inputs come from) and <code>food</code> (where Food comes from) each take its place
        for that one use when picked; unset, they use <code>storage</code>, and with that unset too,
        the nearest storage of your realm.
      </p>
      <p>
        A worker who carries less Food than <code>foodAt</code> ({num(GET_FOOD_AT)} unless set)
        leaves work for their <code>food</code> storage, else their <code>storage</code>, else the
        nearest storage of your realm with Food, takes Food up to <code>foodTake</code> (
        {num(GET_FOOD_TAKE)} unless set) and comes back. With no Food anywhere they work on.
        Carrying a load tops their food up to <code>foodTake</code> too, and the carrier brings back
        what the workplace's pile lacks of <code>crewFood</code> ({num(CREW_FOOD)} unless set) for
        the crew's meals, so a worker with Food on the pile stays. <code>foodAt</code> 0 turns
        getting food off, <code>crewFood</code> 0 the crew's Food.
      </p>
      <p>
        Work can be run directly too, with Run script or as a queue step: they work the workplace in
        its <code>workplace</code> param, or with none picked the one they stand on when it starts.
        Giving Work on a workplace fills it. It is never kept: each start works what it is given or
        where they stand, so a queue can walk them to a workplace and then run Work there. The
        workplace can be anyone's you know, out of sight too: they walk to where you last saw it.
        With no workplace there, once theirs is gone, or when they find it held by another realm's
        workers with no room left, Work ends and your realm log says why.
      </p>
      <p>
        Work on a workplace that is still a construction site builds it first, as Build would, with
        materials from the nearest storage of your realm that holds them, and once it is finished
        they work it without another order. Pick the site for Work on the card or as a queue step.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Workplace</th>
            <th>Makes a game day</th>
            <th>Skill</th>
            <th>Workers</th>
          </tr>
        </thead>
        <tbody>
          {NODE_WORK.map(({ kind, good }) => (
            <tr key={good}>
              <td>{kindName(kind)}</td>
              <td>
                {num(WORK_OUTPUT_PER_DAY[good] ?? 0)} {goodName(good)}
              </td>
              <td>{skillName(kind)}</td>
              <td>{num(WORKPLACE_MAX_WORKERS[kind] ?? 0)}</td>
            </tr>
          ))}
          {(Object.keys(RECIPES) as BuildingKind[]).flatMap((kind) =>
            RECIPES[kind]!.map((r, i) => (
              <tr key={`${kind}${i}`}>
                <td>{kindName(kind)}</td>
                <td>
                  {goods(r.output)} from {goods(r.input)}, {num(BATCHES_PER_DAY[kind] ?? 0)} times
                </td>
                <td>{skillName(kind)}</td>
                <td>{num(WORKPLACE_MAX_WORKERS[kind] ?? 0)}</td>
              </tr>
            )),
          )}
        </tbody>
      </Table>
      <h3>Tools</h3>
      <p>
        <strong>Tools</strong> are a good a smithy makes: {num(forged('tools').input.iron ?? 0)}{' '}
        Iron and {num(forged('tools').input.wood ?? 0)} Wood make a set, which weighs{' '}
        {num(GOOD_WEIGHT.tools ?? 0)} kg. Iron only. A resident carrying a set works{' '}
        {pct(TOOLS_WORK_BONUS)} faster: at a workplace they make that much more, and at a
        construction site they build, tear down and repair that much faster. Without Tools they work
        at the plain pace, so nothing stops for want of them. They aren't equipped: carrying one set
        is enough, a second adds nothing, and nobody else sees them. A workplace's card counts them
        in what each of your workers makes.
      </p>
      <p>
        Tools wear with each day's work and break after about {days(TOOLS_WORK_DAYS)} of it; their
        condition reads like a weapon's (Wear). Warehouses buy and sell them like any good (a floor
        of {num(WAREHOUSE_FLOOR.tools ?? 0)}).
      </p>
      <h3>Production chains</h3>
      <ul>
        <li>One farmer feeds {num(residentsPerFarmer())} residents.</li>
        <li>
          {num(minersPerSmelterWorker())} iron miners keep one smelter worker busy, who makes{' '}
          {num(batchesPerDay('smelter') * (RECIPES.smelter![0]!.output.iron ?? 0))} Iron a game day.
        </li>
        <li>
          {num(goldMinersPerMintWorker())} gold miners keep one mint worker busy, who strikes{' '}
          {num(coinsPerMintWorkerDay())} Coins a game day.
        </li>
      </ul>
      <h3>Coins per worker-day</h3>
      <p>
        What a day's work fetches at a warehouse's base price, and at the {pct(BUY_SHARE)} of it a
        warehouse pays when it buys. For smelters, mints and smithies, the value added is the output
        less what went into it, both at the base price.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Job</th>
            <th>Makes a game day</th>
            <th>Base price</th>
            <th>Warehouse pays</th>
            <th>Value added</th>
          </tr>
        </thead>
        <tbody>
          {jobDays().map((j, i) => (
            <tr key={i}>
              <td>{j.job}</td>
              <td>
                {goods(j.makes)}
                {Object.keys(j.uses).length > 0 && ` from ${goods(j.uses)}`}
              </td>
              <td>{num(j.sell)}</td>
              <td>{num(j.buy)}</td>
              <td>{num(j.added)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        Example: a miner with Strength {num(strong.stats.strength.base)} and Mining{' '}
        {num(strong.skills.mining ?? 0)} digs {num(outputPerDay('ironOre', 'mining', strong))} iron
        ore a game day, against {num(outputPerDay('ironOre', 'mining'))} at average.
      </p>
    </>
  )
}
