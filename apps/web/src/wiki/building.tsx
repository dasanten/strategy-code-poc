import {
  CITY_AREA_MARGIN,
  CITY_BUILDING_REACH,
  CONSTRUCTION_SKILL_EFFECT,
  CONSTRUCTION_SKILL_MAX,
  CONSTRUCTION_SKILL_PER_DAY,
  GET_FOOD_AT,
  GET_FOOD_TAKE,
  OUTPOST_REFILL_REACH,
  ROAD_LINE_MAX_TILES,
  TEARDOWN_MATERIALS_RETURNED,
  TEARDOWN_WORK_SHARE,
  DECAY_WORN,
  DECAY_NEARLY_RUIN,
  REPAIR_MATERIALS_SHARE,
  REPAIR_WORK_SHARE,
  REBUILD_MATERIALS_SHARE,
  REBUILD_WORK_SHARE,
  RUIN_COLLAPSE_DAYS,
  COLLAPSE_MATERIALS_LEFT,
  TICKS_PER_GAME_DAY,
} from '@csp/balance'
import type { BuildingKind } from '@csp/shared-types'
import {
  DECAY_DAYS,
  rebuildMaterials,
  rebuildWork,
  repairMaterials,
  repairWork,
} from '../shared/decay.js'
import { WHO_SUGGESTS } from '../who-list-view.js'
import { Table } from './parts.js'
import { kindName, goods } from './names.js'
import { buildCosts, stoneWallCosts, duration, num, pct, realTimeOf } from './wiki-view.js'

/** Each kind that decays, with the game days it takes to lose all its condition: fastest first. */
const decayRows = () =>
  (Object.entries(DECAY_DAYS) as [BuildingKind, number][])
    .map(([kind, days]) => ({ kind, days }))
    .sort((a, b) => a.days - b.days)

export function BuildingSection() {
  return (
    <>
      <p>
        A construction site becomes its building once its materials are there and builders have put
        in its work. Until then the site belongs to the realm whose resident laid it out, so that
        realm's scripts and params can pick it; finished, the building belongs where its kind does
        (a city's, or an outpost storage). Building goes in proportion to Strength, plus{' '}
        {pct(CONSTRUCTION_SKILL_EFFECT)} for each point of Construction (at most{' '}
        {num(CONSTRUCTION_SKILL_MAX)}, learned at {num(CONSTRUCTION_SKILL_PER_DAY)} a game day);
        more builders finish sooner. A crew sent to work, build or breed at a building stands spread
        over its footprint: each goes to the tile with the fewest of the crew on it, the nearest on
        ties, and which tile they stand on changes nothing else. Tearing down takes{' '}
        {pct(TEARDOWN_WORK_SHARE)} of the work and leaves {pct(TEARDOWN_MATERIALS_RETURNED)} of a
        building's materials on the tile (all of an unfinished site's). A road over a mountain can't
        be torn down while a carriage or a ridden horse stands on it: the work waits until they
        leave. A horse left there unridden can't be ridden off a road.
      </p>
      <p>
        Building is given from a resident’s card or a group card (where to build, then what), or in
        realm control mode from Build on the realm bar: what, then where, then who builds it, picked
        from the who-list (see Controls, Control modes).
      </p>
      <p>
        Tear down can be run directly too, with Run script or as a queue step: they tear down the
        building or site in its <code>building</code> param, walking there first, or with none
        picked the one they stand on when it starts. Giving Tear down on a building fills it; it is
        never kept between starts. With no building there, Tear down ends and your realm log says
        why.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Building</th>
            <th>Size</th>
            <th>Materials</th>
            <th>One builder</th>
            <th>Tearing down</th>
            <th>Left when torn down</th>
          </tr>
        </thead>
        <tbody>
          {[
            ...buildCosts().map((b) => ({ ...b, name: kindName(b.kind) })),
            ...stoneWallCosts(),
          ].map((b) => (
            <tr key={b.name}>
              <td>{b.name}</td>
              <td>
                {num(b.footprint)}×{num(b.footprint)}
              </td>
              <td>{goods(b.materials)}</td>
              <td>{duration(b.buildTicks)}</td>
              <td>{duration(b.teardownTicks)}</td>
              <td>{goods(b.returned)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <h3>Decay and repairing</h3>
      <p>
        Every finished building, wall, gate and road slowly loses its <strong>condition</strong>,
        used or not: an even share at the turn of each game day, faster for roads and the wooden
        walls and gates, slowest for those mostly of stone. Blows from attackers are apart from this
        (see <a href="#combat">Combat</a>). Its tile card says how it stands: good, then{' '}
        <strong>worn</strong> once it has lost {pct(DECAY_WORN)}, then{' '}
        <strong>nearly a ruin</strong> once it has lost {pct(DECAY_NEARLY_RUIN)}. Everyone who sees
        a building sees its condition; scripts read it as <code>building.condition</code>. A city
        left alone for a real month is still there: its buildings may be worn, but none has fallen
        to ruin from decay alone. That is all the game does for an absent Player: Food and defence
        while you are away are your own setup, with work scripts that give every resident access to
        Food and your defence scripts.
      </p>
      <p>
        A worn building can be <strong>repaired</strong>: pick a resident, then the building's tile,
        and <em>Repair</em> on its tile card. They run your Repair default: it walks them there, and
        while the repair lacks materials they carry none of, they fetch what it lacks from its{' '}
        <code>source</code> param, or the nearest storage of your realm holding some. A repair takes{' '}
        {pct(REPAIR_MATERIALS_SHARE)} of the building's materials (rounded up) and{' '}
        {pct(REPAIR_WORK_SHARE)} of its work, and puts it back to good. With none of the materials
        in any storage, Repair ends and your realm log says why. Anyone's building can be repaired.
        Scripts repair with <code>repair(buildingId)</code> on the building's tile and ask what it
        lacks with <code>repairNeeded(building)</code>.
      </p>
      <p>
        Some repair <strong>on their own</strong>. A resident running your Build default with no
        construction site to join (none picked, none on their tile) repairs the worn buildings in
        their city's area instead, worst first, then nearest, one after another, fetching the
        materials as above; with none left the script ends. Buildings further off take a Repair
        order. Scripts find what needs repairing with <code>wornBuildings(cityId)</code>. An NPC
        city's builders repair its buildings and its road crew its roads, worst first, from what its
        storage holds above its reserve. The Trade Organization repairs its own from its stock at
        the turn of each day, so the HQ and its trading posts never fall to ruin while it stands.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Building</th>
            <th>Worn after</th>
            <th>All gone after</th>
            <th>Repair materials</th>
            <th>Repair, one builder</th>
            <th>Rebuild materials</th>
            <th>Rebuild, one builder</th>
          </tr>
        </thead>
        <tbody>
          {decayRows().map((b) => (
            <tr key={b.kind}>
              <td>{kindName(b.kind)}</td>
              <td>
                {num(Math.ceil(b.days * DECAY_WORN))} game days (
                {realTimeOf(Math.ceil(b.days * DECAY_WORN) * TICKS_PER_GAME_DAY)})
              </td>
              <td>
                {num(b.days)} game days ({realTimeOf(b.days * TICKS_PER_GAME_DAY)})
              </td>
              <td>{goods(repairMaterials(b.kind))}</td>
              <td>{duration(repairWork(b.kind))}</td>
              <td>{goods(rebuildMaterials(b.kind))}</td>
              <td>{duration(rebuildWork(b.kind))}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <h3>Ruins and collapse</h3>
      <p>
        A building nobody repaired, once it has lost all its condition, becomes a{' '}
        <strong>ruin</strong>. It still stands where it stood and takes up its tiles, but does
        nothing: a ruined wall or gate tile is a gap anyone walks through, a house houses nobody, a
        workplace makes nothing, a stable or training ground is no use, a ruined road is no road,
        and a storage takes nothing in. Goods in a ruined storage stay in it, but anyone at it can
        take them out, guarded or not: taking another organization's is theft. On the map a ruin
        shows faded and grey, and its tile card says it is one.
      </p>
      <p>
        A ruin is <strong>rebuilt</strong> like a repair, with <em>Rebuild</em> on its tile card or{' '}
        <code>repair(buildingId)</code>, for {pct(REBUILD_MATERIALS_SHARE)} of its materials and{' '}
        {pct(REBUILD_WORK_SHARE)} of its work: less than a new one. Left {num(RUIN_COLLAPSE_DAYS)}{' '}
        game days ({realTimeOf(RUIN_COLLAPSE_DAYS * TICKS_PER_GAME_DAY)}) more it{' '}
        <strong>collapses</strong>: it is gone, and {pct(COLLAPSE_MATERIALS_LEFT)} of its materials
        (rounded down), with any goods still in it, lie on its tiles as a pile. A town hall that
        collapses ends its city, as when it is torn down. Scripts read a ruin's{' '}
        <code>building.condition</code> as <code>"ruin"</code>.
      </p>
      <p>
        A city building (town hall, house, storage, wall, gate) belongs to a city when it stands
        within {num(CITY_BUILDING_REACH)} tiles of its town hall or of another of its buildings; the
        city's area reaches {num(CITY_AREA_MARGIN)} tiles around them. A house goes only in a city's
        area; a town hall, storage, wall or gate goes anywhere off Mountain and off resource nodes,
        and a new town hall founds a city. A training ground goes anywhere off Mountain and off
        resource nodes too, and like a workplace it belongs to nobody; what happens there is under{' '}
        <a href="#training">Training</a>.
      </p>
      <p>
        A resident building or tearing down who carries less Food than <code>foodAt</code> (
        {num(GET_FOOD_AT)} unless set) goes to their <code>food</code> storage, else their{' '}
        <code>source</code>, else the nearest storage of your realm with Food, takes Food up to{' '}
        <code>foodTake</code> ({num(GET_FOOD_TAKE)} unless set) and comes back to the site. With no
        Food anywhere they work on. Fetching materials tops their food up to <code>foodTake</code>{' '}
        too, before the materials. <code>foodAt</code> 0 turns this off.
      </p>
      <p>
        Build can be run directly too, with Run script or as a queue step: they join the
        construction site in its <code>site</code> param, or with none picked the one they stand on
        when it starts. Laying out a new site (what and where) is only the Build order's. Giving
        Build on a site your residents laid out fills <code>site</code>; it is never kept, so a
        queue can walk them to a site and then run Build there. With no construction site there,
        Build ends and your realm log says why.
      </p>
      <p>
        <strong>Build line</strong> builds road or wall along a line: on a resident's card pick{' '}
        <em>Build line: road</em> or <em>Build line: wall</em>, then the tile where the line starts
        and the one where it ends, straight or diagonal, at most {num(ROAD_LINE_MAX_TILES)} tiles.
        The resident walks to the line themselves and builds its tiles one at a time, the nearest
        still to build first; tiles that have one already, or can't take one, are skipped. What they
        carry goes in first. Lacking materials for their tile, they fetch them from their{' '}
        <code>source</code>, or the nearest storage of your realm holding them, as much as they can
        carry for this tile and the next ones, topping up their own food there too. With none in any
        storage they lay out each tile's site and go on to the next; once the whole line is laid out
        or built they stop, and your realm log says why (“no stone in any storage”), so the line
        shows and can be finished later. In the queue planner, <strong>Add step</strong> offers
        Build line too: pick both ends on the map. No walk goes before it, since the builder walks
        to the line, and it ends on its own, so it needs no duration; a saved queue or a copied step
        keeps both tiles. Build line has Build's params; its line comes only from the order, so run
        directly or with Run script it ends at once (“no line given”). The plain{' '}
        <code>roadLine</code> and <code>wallLine</code> actions, which build only with what the
        resident carries, stay for your scripts.
      </p>
      <p>
        <strong>A crew on one line:</strong> residents on the same line, from the group card or
        given it one by one, each take the nearest tile still to build that no other of them has
        taken, so several tiles go up at once; each fetches their own materials. With every tile
        left taken by the others, a builder waits, and they all stop once the line is finished.
      </p>
      <p>
        In <a href="#controls">realm control mode</a> a line starts from the realm bar instead:{' '}
        <strong>Road</strong> or <strong>Wall</strong> (wood or stone, on the banner), then where
        the line starts and where it ends, with the same preview. A line too long, or with no tile
        left to build, says why and you pick its end again. Then the who-list shows your residents
        with their way to the line’s tile nearest them, the nearest {num(WHO_SUGGESTS.line)} idle
        ones ticked; those you confirm get Build line as a crew.
      </p>
      <p>
        A storage in a city's area is that city's storage. One outside any city is an{' '}
        <strong>outpost storage</strong>: it belongs to the realm whose residents finished it and
        counts as a storage of your realm everywhere (Store, Fetch, carrying the output, fetching
        materials, haul route stops, <code>storages()</code> and <code>storage</code> params). It
        founds no city and has no area. A city that grows over it takes it in; a storage cut off
        from its city, or left when its town hall is torn down, stays an outpost storage of that
        city's realm. What it holds is seen only by its realm and its allies, and by anyone standing
        at it. Residents of your realm within {num(OUTPOST_REFILL_REACH)} tiles of it take a meal
        from it when they run low, as at home.
      </p>
      <p>
        An outpost storage is guarded like a workplace: while an armed resident of its realm stands
        on or next to it and nobody else's armed resident does, only its realm can take from it.
        Unguarded, anyone at it can pick up from it; for another organization that is theft, and
        tearing it down is a crime too (see Standing).
      </p>
    </>
  )
}
