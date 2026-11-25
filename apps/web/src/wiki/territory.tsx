import {
  START_RESIDENTS,
  TERRITORY_CITY_BASE,
  TERRITORY_MAX_REACH,
  TERRITORY_PER_ARMED,
  TERRITORY_PER_RESIDENT,
  TERRITORY_REACH_PER_ROOT,
  TERRITORY_WORKPLACE_BASE,
} from '@csp/balance'
import { Table } from './parts.js'
import { cityControl, num } from './wiki-view.js'

export function TerritorySection() {
  return (
    <>
      <p>
        Cities and guarded workplaces project control. A city starts at {num(TERRITORY_CITY_BASE)},
        a guarded workplace at {num(TERRITORY_WORKPLACE_BASE)}; each resident adds{' '}
        {num(TERRITORY_PER_RESIDENT)} and each armed one {num(TERRITORY_PER_ARMED)} more. Control
        reaches {num(TERRITORY_REACH_PER_ROOT)} tiles times the square root of its strength, at most{' '}
        {num(TERRITORY_MAX_REACH)} tiles, fading with distance; where two overlap, the stronger
        wins.
      </p>
      <p>
        The Region map shows territory over all the terrain you explored, one colour per
        Organization (an alliance’s members share one). Zoomed far out it is filled in; at the
        middle and close zoom only its borders show, unless the Region map button is on.
      </p>
      <Table>
        <thead>
          <tr>
            <th>City</th>
            <th>Control</th>
            <th>Reach</th>
          </tr>
        </thead>
        <tbody>
          {[
            cityControl(0, 0),
            cityControl(START_RESIDENTS, 0),
            cityControl(START_RESIDENTS, START_RESIDENTS / 2),
            cityControl(START_RESIDENTS * 4, START_RESIDENTS),
          ].map((c) => (
            <tr key={`${c.residents}-${c.armed}`}>
              <td>
                {num(c.residents)} residents, {num(c.armed)} of them armed
              </td>
              <td>{num(c.strength)}</td>
              <td>{num(c.reach)} tiles</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  )
}
