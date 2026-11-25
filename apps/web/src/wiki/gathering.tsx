import {
  WORK_OUTPUT_PER_DAY,
  GATHER_PER_DAY,
  GATHER_REACH,
  PATCH_SIZE,
  PATCH_REGROW_DAYS,
  PATCH_REST_DAYS,
  RICHNESS_FACTOR,
} from '@csp/balance'
import { days, num } from './wiki-view.js'

export function GatheringSection() {
  return (
    <>
      <p>
        A grown resident takes <strong>Wood</strong> or <strong>Food</strong> from a Forest tile
        they stand on, or <strong>Stone</strong> from a Hills tile, straight into their hands: no
        node, no workplace. Not on a tile with a building, a road, a construction site or a resource
        node on it. Iron ore, Gold ore and Coal are never gathered. An average resident gathers{' '}
        {num(GATHER_PER_DAY.wood ?? 0)} Wood, {num(GATHER_PER_DAY.food ?? 0)} Food or{' '}
        {num(GATHER_PER_DAY.stone ?? 0)} Stone a game day: more than working a poor node (
        {num((WORK_OUTPUT_PER_DAY.wood ?? 0) * RICHNESS_FACTOR.poor)} Wood), less than a normal one
        ({num(WORK_OUTPUT_PER_DAY.wood ?? 0)} Wood). Strength, the good’s skill (Woodcutting,
        Farming, Mining) and Tools count as they do at a workplace, and gathering teaches that
        skill.
      </p>
      <p>
        <strong>Patches.</strong> Each Forest and Hills tile holds {num(PATCH_SIZE)} units for
        gathering, about one load, shared by everyone and by Wood and Food alike. Once it is gone
        the tile is <strong>picked over</strong> and gives nothing. Once nobody has gathered there
        for {days(PATCH_REST_DAYS)}, it grows back steadily, from empty to full in{' '}
        {days(PATCH_REGROW_DAYS)}. So the land beside a city empties under a few gatherers, while a
        workplace on a node never runs out. The tile card says what a tile gives and, while it is in
        sight, how much is left or when it is full again; up close the map shows picked-over tiles
        in sight thinned out.
      </p>
      <p>
        <strong>The Gather task.</strong> Gather on a resident’s card, on the group card, as a queue
        step or from the realm bar asks what to gather first. The resident walks to the nearest tile
        within {num(GATHER_REACH)} tiles of where they started that gives it and isn’t picked over
        as far as they can see, gathers until their hands are full or the patch is gone, and goes on
        to the next tile; with a full load they store it at their <code>storage</code>, else the
        nearest storage of your realm, and come back. Several gatherers take different tiles. Out of
        sight they go by what you last saw there: a tile someone built on since looks free until it
        comes into sight, and then they pick the next one. With no such tile left in reach they
        store what they carry and end, saying why. The usual food params work as in Work. In a
        script, <code>gather(good)</code> gathers on the tile you stand on, and a tile’s{' '}
        <code>pickedOver</code> says whether its patch is gone.
      </p>
    </>
  )
}
