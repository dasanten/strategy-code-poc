import {
  GAME_DAYS_PER_YEAR,
  MAP_SIZE,
  NPC_FOUND_REACH,
  LAST_SEEN_EVERY_TICKS,
  SIGHT_RANGE,
  TICKS_PER_GAME_DAY,
  Terrain,
  walkSpeed,
} from '@csp/balance'
import { AVERAGE, duration, num, realTimeOf } from './wiki-view.js'

export function TimeSection() {
  const plainsTicksPerTile = 1 / walkSpeed(AVERAGE, Terrain.Plains, 0)
  return (
    <>
      <p>
        The world keeps running while nobody is online. One tick is one real second and one game
        minute, so a game day lasts {realTimeOf(TICKS_PER_GAME_DAY)}, and a game year of{' '}
        {num(GAME_DAYS_PER_YEAR)} game days lasts{' '}
        {realTimeOf(GAME_DAYS_PER_YEAR * TICKS_PER_GAME_DAY)}.
      </p>
      <p>
        The map is {num(MAP_SIZE)} × {num(MAP_SIZE)} tiles, and its opposite sides join: walk off
        the east side and you come back in from the west. Walking once around it on plains takes an
        average resident {duration(MAP_SIZE * plainsTicksPerTile)}. A resident sees{' '}
        {num(SIGHT_RANGE)} tiles around them.
      </p>
      <p>
        The world fills in by itself: an NPC city that has grown full sends some of its people to
        found a new village on free land up to {num(NPC_FOUND_REACH)} tiles away (see NPC cities
        under Trade &amp; prices), which then grows like any other. Land within a realm's territory
        is never founded on.
      </p>
      <p>
        Buildings and cities you have had in sight stay on your map once they leave it, as you last
        saw them and marked apart from what you see now (last seen). Your map of them is brought up
        to date once every {duration(LAST_SEEN_EVERY_TICKS)}, so a building that leaves your sight
        in between is remembered as it was up to that long before. What is in sight now is always
        shown as it is.
      </p>
    </>
  )
}
