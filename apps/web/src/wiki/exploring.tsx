import {
  HORSE_FOOD_PER_DAY,
  WAYPOINTS_MAX,
  EXPLORE_FOOD_MARGIN,
  EXPLORE_SKIP_RANGE,
  EXPLORED_EDGE_RANGE,
  FOOD_PER_DAY,
  SIGHT_RANGE,
} from '@csp/balance'
import { num } from './wiki-view.js'

export function ExploringSection() {
  return (
    <>
      <p>
        Give a grown resident <strong>Explore</strong> on their card, on foot or riding, and they go
        into the unknown on their own. Before they start, pick <code>find</code>, a kind of resource
        node to look for (forest, stone, iron ore, gold ore or coal), or none to just explore until
        you stop them; <code>toward</code>, a compass direction, or a <code>waypoint</code> to head
        for instead; with neither they take the nearest unexplored land first. <code>food</code> is
        where they refill; with none picked, the nearest storage of your realm with Food.
      </p>
      <p>
        They set out with as much Food as they can carry and walk to the edge of what you have
        explored, that way: the nearest tile you have explored that they can go onto, beside one you
        haven't, within 45° of the direction. Standing there they see {num(SIGHT_RANGE)} tiles past
        it, and walk on to the next edge. A rider looks only where their horse can go.
      </p>
      <p>
        Before each way out they check that the Food on them covers it and the way back to where
        they refill, plus {num(EXPLORE_FOOD_MARGIN)} units to spare (their own food and one more). A
        walker eats {num(FOOD_PER_DAY)} Food a game day, more on hills and mountains; riding, their
        horse eats {num(HORSE_FOOD_PER_DAY)} a day too, from the Food they carry. Once it no longer
        covers it they turn back, refill, and go back out to where they turned if a full load still
        covers that way and back; otherwise they head for the nearest edge from there.
      </p>
      <p>
        Land they can see but find no way to, across a lake, say, they leave out from then on, with
        the edge within {num(EXPLORE_SKIP_RANGE)} tiles of it. With no edge within{' '}
        {num(EXPLORED_EDGE_RANGE)} tiles, or none their Food takes them to and back even with a full
        load, they walk back to where they refill and end, and your realm log says why. Scripts find
        the edge with <code>exploredEdge(from, toward, skip)</code> and the Food a way takes with{' '}
        <code>wayFood(a, b)</code>.
      </p>
      <p>
        With <code>find</code> picked they look about every tick on their way out. Once you see a
        node of that kind that none of your waypoints marks, they put a waypoint on it named after
        it (“Gold ore node”), walk back to where they refill and end; your realm log notes the
        waypoint, and the find as they end. Holding {num(WAYPOINTS_MAX)} waypoints already, they
        still walk back and end, saying no waypoint was added. Scripts see the nodes you have in
        sight with <code>nodesInSight(kind)</code>.
      </p>
    </>
  )
}
