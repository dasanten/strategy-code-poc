import {
  RAM_CREW,
  RAM_STRENGTH,
  RAM_BLOW,
  RAM_STRIKE_TICKS,
  CATAPULT_CREW,
  CATAPULT_REACH,
  CATAPULT_SHOT_TICKS,
  CATAPULT_BLOW,
  CATAPULT_STRENGTH,
  SHOT_REACH,
  WALL_SHOT_REACH_BONUS,
} from '@csp/balance'
import { goods } from './names.js'
import { ramCost, ramPushTicks, ramBreakTicks, catapultBreak, duration, num } from './wiki-view.js'

export function SiegeSection() {
  return (
    <>
      <p>
        A <b>siege machine</b> is a machine of a realm, built in the field where it is needed, so a
        siege needs a supply line like an army. There are two: a <b>ram</b>, a roofed frame on
        wheels round a heavy beam, and a <b>catapult</b>, which throws Stone at walls from far off.
        NPC cities and the Trade Organization don't build them, for now.
      </p>
      <p>
        <b>Building a ram.</b> A resident lays out a <b>ram site</b> with Build (in the Build menu
        under Siege) on any tile a carriage could stand on, off resource nodes and buildings, one to
        a tile. It is a construction site like any other: it takes {goods(ramCost().materials)} and{' '}
        {duration(ramCost().buildTicks)} of one average resident's work, carried there and put in by
        anyone. Once finished the site is gone and a ram of the realm of whoever finished it stands
        on its tile.
      </p>
      <p>
        <b>Crew.</b> Residents of its realm join its <b>crew</b> with Crew the ram on its card: they
        walk onto its tile, following it if it moves, and are its crew while they stand there.
        Children don't crew it. With at least {num(RAM_CREW)} of its crew on it, one of them{' '}
        <b>pushes</b> it (Push the ram to…) to a tile a carriage could go to, along a way a carriage
        could take: a tile of Plains takes about {duration(ramPushTicks()[0]!.ticks)}, of Forest or
        Hills {duration(ramPushTicks()[1]!.ticks)} and of road {duration(ramPushTicks()[2]!.ticks)}.
        The crew go along on its tile. One who walks off is no longer of its crew, and below{' '}
        {num(RAM_CREW)} it stops where it is.
      </p>
      <p>
        <b>Ramming.</b> Pushed next to a wall or gate of another realm's city, or of nobody's, one
        of its crew swings it with the whole crew (Ram the gate on its card, or{' '}
        <code>ram(machine, wall)</code> in a script). It strikes every {duration(RAM_STRIKE_TICKS)}{' '}
        for {num(RAM_BLOW)} damage, far harder than any blow: a tile of wooden wall falls in{' '}
        {duration(ramBreakTicks('wall'))}, a stone gate in {duration(ramBreakTicks('gate', true))}.
        Each strike raises the alarm as a blow at the wall does, and breaking another realm's wall
        is a crime of tearing down, as by hand. Below its crew size it stops. Its crew is under its
        roof: nobody up on a wall strikes them, and no shot reaches them, so defenders have to come
        down and out to fight them or to strike the ram, which is struck only from the ground.
      </p>
      <p>
        <b>Breaking and tearing down.</b> Anyone may attack a ram of another realm, as a wall: every
        blow lands, and after {num(RAM_STRENGTH)} damage it breaks, leaving{' '}
        {goods(ramCost().broken)} on its tile. Breaking another realm's ram is a crime of tearing
        down. Its own realm tears it down from its tile in {duration(ramCost().teardownTicks)} of
        one average resident's work, which leaves {goods(ramCost().tornDown)}.
      </p>
      <p>
        <b>The catapult.</b> It is built, crewed, pushed, broken and torn down as a ram is: its site
        (Build, under Siege) takes {goods(ramCost('catapult').materials)} and{' '}
        {duration(ramCost('catapult').buildTicks)} of one average resident's work, it needs{' '}
        {num(CATAPULT_CREW)} of its crew on it, and it breaks after {num(CATAPULT_STRENGTH)} damage.
        One of its crew aims it with the whole crew (Throw Stone at… on its card, then the wall on
        the map, or <code>throw(machine, wall)</code> or <code>throw(machine, x, y)</code> in a
        script) at a wall, gate or tower of another realm's city, or of nobody's, within{' '}
        {num(CATAPULT_REACH)} tiles: well beyond a Bow's{' '}
        {num((SHOT_REACH.bow ?? 0) + WALL_SHOT_REACH_BONUS)} from up on a wall. Every{' '}
        {duration(CATAPULT_SHOT_TICKS)} it throws one Stone for {num(CATAPULT_BLOW)} damage: a tile
        of wooden wall falls to {num(catapultBreak('wall').shots)} Stone in{' '}
        {duration(catapultBreak('wall').ticks)}, a stone gate to{' '}
        {num(catapultBreak('gate', true).shots)} in {duration(catapultBreak('gate', true).ticks)}.
        The Stone is what its crew carry, then what lies on its tile; out of Stone it stops. It hits
        the building only, never anyone on it or by it. Each shot raises the alarm and breaking
        another realm's wall is a crime, as with a ram. Its crew stands in the open: archers in
        reach shoot them and anyone can strike them.
      </p>
      <p>
        <b>Ramming and throwing attack the wall's owner</b>, as a blow at the wall or a climb does.
        Striking a ram's or catapult's crew at your wall is no crime, an NPC city's soldiers fight
        them as attackers, and residents hired from an NPC city won't ram or throw at its walls.
        Pushing the machine up is no attack yet: nothing is struck.
      </p>
      <p>
        A ram shows on the map to whoever sees its tile, with whose it is and its crew, but Last
        seen doesn't keep it, as it moves. A ram of a realm that ends belongs to nobody. Scripts see
        the machines in sight with <code>machines()</code>, join a crew with{' '}
        <code>crew(machine)</code> and push one with <code>push(machine, x, y)</code>.
      </p>
    </>
  )
}
