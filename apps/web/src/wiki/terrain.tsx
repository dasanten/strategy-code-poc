import {
  AGILITY_LIMIT,
  AGILITY_SPEED_EFFECT,
  AGILITY_TERRAIN_EFFECT,
  HUNGER_ENDURANCE_LIMIT,
  DIAGONAL_STEP,
  ENDURANCE_TERRAIN_EFFECT,
  TERRAIN_FOOD,
  TERRAIN_SPEED,
  Terrain,
  WALK_TICKS_PER_TILE,
  walkSpeed,
  workFactor,
} from '@csp/balance'
import { Table } from './parts.js'
import {
  AVERAGE,
  AVERAGE_STATS,
  TERRAIN_NAMES,
  duration,
  num,
  pct,
  wikiResident,
} from './wiki-view.js'

export function TerrainSection() {
  const avg = AVERAGE_STATS.strength
  const strongAgile = wikiResident({ agility: avg * 1.5 })
  return (
    <>
      <p>
        An unloaded average resident walks a plains tile in {duration(WALK_TICKS_PER_TILE)}. Terrain
        changes how fast they walk and how much food they burn; lakes and sea can't be entered. A
        road is as fast whatever lies beneath it.
      </p>
      <p>
        Residents and carriages step onto any of the eight tiles around, diagonals too. A diagonal
        step is {num(DIAGONAL_STEP, 2)} times as far, so it takes that much longer on the same
        ground. It can't squeeze between two corners: both straight tiles beside it must be ones
        they could step onto, with no wall, gate in the way, lake, sea, or (for a carriage or rider)
        mountain without a finished road. Two walls touching at a corner close the way like a
        straight stretch.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Terrain</th>
            <th>Speed</th>
            <th>Food burnt</th>
            <th>Road work</th>
          </tr>
        </thead>
        <tbody>
          {TERRAIN_NAMES.map((t) => (
            <tr key={t}>
              <td>{t}</td>
              <td>{pct(TERRAIN_SPEED[Terrain[t]]!)}</td>
              <td>{pct(TERRAIN_FOOD[Terrain[t]]!)}</td>
              <td>{t === 'Road' ? '—' : `× ${num(workFactor('road', Terrain[t]))}`}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        Each point of Agility above average walks {pct(AGILITY_SPEED_EFFECT)} faster and takes{' '}
        {pct(AGILITY_TERRAIN_EFFECT)} off a terrain's slowdown (slower below average), each by at
        most {pct(AGILITY_LIMIT)}. Each point of Endurance takes {pct(ENDURANCE_TERRAIN_EFFECT)} off
        a terrain's extra food, at most {pct(HUNGER_ENDURANCE_LIMIT)}.
      </p>
      <p>
        Example: with Agility {num(strongAgile.stats.agility.base)} a resident crosses a plains tile
        in {duration(1 / walkSpeed(strongAgile, Terrain.Plains, 0))} and a hills tile in{' '}
        {duration(1 / walkSpeed(strongAgile, Terrain.Hills, 0))}, against{' '}
        {duration(1 / walkSpeed(AVERAGE, Terrain.Hills, 0))} at average.
      </p>
    </>
  )
}
