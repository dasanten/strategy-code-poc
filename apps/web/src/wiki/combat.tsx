import {
  BLOW_BASE,
  BLOW_PER_STRENGTH,
  BROKEN_MATERIALS_RETURNED,
  CLIMB_TICKS,
  COMBAT_SKILL_EFFECT,
  COMBAT_SKILL_PER_BLOW,
  DODGE_LIMIT,
  DODGE_PER_AGILITY,
  EQUIP_TICKS,
  GOOD_WEIGHT,
  MAX_HEALTH,
  MIN_BLOW_DAMAGE,
  OCCUPATION_GAME_DAYS,
  NPC_ARCHER_ARROWS,
  NPC_ARCHER_SHARE,
  PROTECTION_DEFENCE,
  SIGHT_RANGE,
  DEFEND_CALM_TICKS,
  STRIKE_TICKS,
  FOOTPRINT,
  WALL_DEFENCE,
  WALL_STRENGTH,
  STONE_WALL_STRENGTH,
  TOWER_ROOM,
  TOWER_SIGHT_RANGE,
  TOWER_SHOT_REACH_BONUS,
  WALL_WALK_TICKS,
  FALL_DAMAGE,
  WEAPON_ATTACK,
  WEAR_BLOWS,
  TRAINING_WEAR_BLOWS_PER_DAY,
  WORN_FROM,
  NEARLY_BROKEN_FROM,
  SHOT_REACH,
  SHOT_TICKS,
  SHOT_DAMAGE,
  SHOT_SKILL_LIMIT,
  SHOT_PIERCE,
  WALL_SHOT_REACH_BONUS,
} from '@csp/balance'
import type { Good } from '@csp/shared-types'
import { Table } from './parts.js'
import { goodName, forged } from './names.js'
import {
  AVERAGE_STATS,
  COMBAT_SKILL_MAX,
  blow,
  breakTicks,
  days,
  duration,
  num,
  pct,
  signed,
} from './wiki-view.js'

/** How many blows a piece of gear lasts (`CONTEXT.md`: Wear), or a dash for gear that never wears. */
function lasts(good: Good): string {
  const blows = (WEAR_BLOWS as Record<string, number | undefined>)[good]
  return blows === undefined ? '—' : num(blows)
}

export function CombatSection() {
  const avg = AVERAGE_STATS.strength
  const unarmed = blow()
  const sword = blow({ sword: 1 })
  const steelSword = blow({ steelSword: 1 })
  const swordSkilled = blow({ sword: 1 }, COMBAT_SKILL_MAX)
  const dodge = Math.min(DODGE_LIMIT, avg * DODGE_PER_AGILITY)
  return (
    <>
      <p>
        Residents in contact strike every {duration(STRIKE_TICKS)}. A blow does {num(BLOW_BASE)}{' '}
        plus {num(BLOW_PER_STRENGTH)} for each point of Strength plus the weapon's attack, then{' '}
        {pct(COMBAT_SKILL_EFFECT)} more for each point of Combat skill (at most twice as hard).
        Protection takes damage off, but a blow that lands does at least {num(MIN_BLOW_DAMAGE)}.
        Each point of Agility dodges {pct(DODGE_PER_AGILITY)} of blows, at most {pct(DODGE_LIMIT)}.
        Combat skill grows by {num(COMBAT_SKILL_PER_BLOW)} with every blow struck or taken.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Gear</th>
            <th>Attack</th>
            <th>Defence</th>
            <th>Lasts (blows)</th>
            <th>kg</th>
          </tr>
        </thead>
        <tbody>
          {(Object.entries(WEAPON_ATTACK) as [Good, number][]).map(([g, a]) => (
            <tr key={g}>
              <td>{goodName(g)}</td>
              <td>{signed(a)}</td>
              <td>—</td>
              <td>{lasts(g)}</td>
              <td>{num(GOOD_WEIGHT[g])}</td>
            </tr>
          ))}
          {(Object.entries(PROTECTION_DEFENCE) as [Good, number][]).map(([g, d]) => (
            <tr key={g}>
              <td>{goodName(g)}</td>
              <td>—</td>
              <td>{signed(-d)}</td>
              <td>{lasts(g)}</td>
              <td>{num(GOOD_WEIGHT[g])}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        An average resident hits for {num(unarmed)} with bare fists, {num(sword)} with a sword,{' '}
        {num(steelSword)} with a steel sword, and {num(swordSkilled)} with a sword at full Combat
        skill ({num(COMBAT_SKILL_MAX)} points); they dodge {pct(dodge)} of blows. A resident has{' '}
        {num(MAX_HEALTH)} health.
      </p>
      <p>
        Each resident has three <strong>equipment</strong> slots: a <strong>weapon</strong>, a{' '}
        <strong>shield</strong> and <strong>armour</strong>, one item each. Only what is equipped
        counts in a fight, and only a resident with a weapon equipped is <strong>armed</strong> (a
        soldier): a spare sword in the pack makes nobody a soldier and a second shield adds nothing.
        A resident with an empty slot equips the best fitting item at once when they pick one up,
        from a storage, the ground, a carriage or a smithy; with the slot already full, the new one
        is only carried, even if it is better. Putting the equipped item down (storing, dropping it,
        or losing it as loot) empties its slot, and the best other item of that kind they carry
        takes its place. Equipped gear still weighs what it weighs and is part of what they carry. A
        resident's card shows their three slots.
      </p>
      <p>
        A <strong>Bow</strong> and a <strong>Crossbow</strong> are weapons for shooting, and each
        takes both hands: with one equipped the shield slot stays empty (the shield stays carried
        and goes back on when they put a one-handed weapon in its place), and a shield can't be put
        on beside one. In a blow they add nothing, so an archer in a brawl fights with their fists.
        They shoot <strong>Arrows</strong>, a plain good that is carried, stored and traded like any
        other and goes in no slot. A smithy makes each, the smith saying which as for the other
        gear:
      </p>
      <Table>
        <thead>
          <tr>
            <th>Good</th>
            <th>Made from</th>
            <th>A batch makes</th>
            <th>Weight</th>
          </tr>
        </thead>
        <tbody>
          {(['bow', 'crossbow', 'arrows'] as const).map((g) => (
            <tr key={g}>
              <td>{goodName(g)}</td>
              <td>
                {(Object.entries(forged(g).input) as [Good, number][])
                  .map(([input, n]) => `${num(n)} ${goodName(input)}`)
                  .join(', ')}
              </td>
              <td>{num(forged(g).output[g] ?? 0)}</td>
              <td>{num(GOOD_WEIGHT[g])} kg each</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <h3>Ranged combat</h3>
      <p>
        An armed resident with a Bow or Crossbow equipped <strong>shoots</strong> anyone they may
        strike whom they see within their weapon's <strong>reach</strong>, in tiles, contact
        included: given an attack order, they walk only until the target is in reach and shoot from
        there. Each shot uses up one Arrow they carry, whether it lands or not; out of Arrows they
        fight with their fists and have to walk into contact. Nothing blocks a shot for now. A shot
        is a strike like a blow: the one hit is under attack and fights back or flees, their city's
        alarm goes, and it is a crime where a blow would be. Agility dodges a shot as it does a
        blow, and a shield and armour take damage off it, but a Crossbow's bolt goes through part of
        them. Strength adds nothing to a shot; Combat skill makes a Bow much better, a Crossbow only
        a little.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Weapon</th>
            <th>Reach</th>
            <th>A shot every</th>
            <th>Damage</th>
            <th>At full Combat skill</th>
            <th>Through armour</th>
          </tr>
        </thead>
        <tbody>
          {(['bow', 'crossbow'] as const).map((w) => (
            <tr key={w}>
              <td>{goodName(w)}</td>
              <td>{num(SHOT_REACH[w] ?? 0)} tiles</td>
              <td>{duration(SHOT_TICKS[w] ?? 0)}</td>
              <td>{num(SHOT_DAMAGE[w] ?? 0)}</td>
              <td>{num((SHOT_DAMAGE[w] ?? 0) * (1 + (SHOT_SKILL_LIMIT[w] ?? 0)))}</td>
              <td>{pct(SHOT_PIERCE[w] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        <strong>Archers by default.</strong> Struck, an archer's Defend default shoots back from
        where they stand, walking only until the one who struck them is in reach. On an alarm, the
        Alarm default sends an archer on the ground up onto the city's wall tile between them and
        whoever they go after, and they shoot from there; up on the wall they wait for them to come
        in reach rather than come down. With no wall between them they shoot from where they stand.
        Out of Arrows an archer does what anyone armed does and closes in. Scripts see a resident's{' '}
        <code>reach</code> (null without a Bow or Crossbow) and the Arrows they carry in{' '}
        <code>carried.arrows</code>; <code>shoot(targetId)</code> shoots someone in reach without a
        step, and <code>attack</code> walks only until they are in reach.
      </p>
      <p>
        <strong>NPC archers.</strong> An NPC city with a smithy arms {pct(NPC_ARCHER_SHARE)} of its
        soldiers with a Bow (rounded down) and keeps {num(NPC_ARCHER_ARROWS)} Arrows in its reserve
        for each of them; its smithy forges them once its soldiers are armed. Each archer carries{' '}
        {num(NPC_ARCHER_ARROWS)} Arrows and fetches more from its storage as they run low. While the
        city has a wall, its archers stand on it and leave the town hall and the gates to the
        others. One without a smithy, and the Trade Organization's cities, keep no archers. A
        resident hired from an NPC city who takes a Bow from its surplus takes Arrows along too,
        also only from its surplus.
      </p>
      <p>
        To <strong>swap</strong> gear, pick another item they carry for a slot on their card (or the
        group card's Equip…, for each of them who carries it), or take a slot's item off; scripts do
        the same with <code>equip(good)</code> and <code>takeOff(slot)</code>, and a queue with the
        Put on gear and Take off gear steps. It takes {duration(EQUIP_TICKS)}, and they strike no
        blows meanwhile, even when struck; an order given under attack still goes. What comes off
        stays carried. A slot taken off stays empty until they pick up more that fits it, so a
        resident can walk unarmed with a sword in the pack.
      </p>
      <p>
        Anyone who sees a resident sees what they have equipped: on the map up close a mark for
        their weapon and shield and a rim for armour, bright for steel and grey for iron, and the
        same on their card, to scripts too. What else they carry stays hidden from other realms, as
        a carriage's load does, unless one of theirs stands on the same tile.
      </p>
      <p>
        Gear <strong>wears</strong>: a weapon with each blow it strikes, dodged or not, a shield and
        armour with each blow they take, and every equipped piece a little in training,{' '}
        {num(TRAINING_WEAR_BLOWS_PER_DAY)} blow's worth a game day. The table says how many blows
        each lasts. Worn out, a piece <strong>breaks</strong> and is gone, and the next best one
        carried takes its slot; until then it fights as well as new. A resident uses up the most
        worn piece of a kind first, and worn gear stays as worn in a storage, a carriage or the loot
        of the fallen. Its <strong>condition</strong> reads good, worn (from {pct(WORN_FROM)} of its
        life used) or nearly broken (from {pct(NEARLY_BROKEN_FROM)}), on the card and to scripts (
        <code>condition</code>), only for the realm carrying it; anyone else sees just its kind and
        metal.
      </p>
      <p>
        Defenders on their own city's wall take {pct(WALL_DEFENCE)} of the damage. A tile of wall
        takes {num(WALL_STRENGTH.wall)} damage to break and a gate {num(WALL_STRENGTH.gate)}: an
        average unarmed resident alone needs {duration(breakTicks('wall'))} for a wall and{' '}
        {duration(breakTicks('gate'))} for a gate. Of stone, a tile of wall takes{' '}
        {num(STONE_WALL_STRENGTH.wall)} and a gate {num(STONE_WALL_STRENGTH.gate)}:{' '}
        {duration(breakTicks('wall', true))} and {duration(breakTicks('gate', true))} for that
        resident. A broken one leaves {pct(BROKEN_MATERIALS_RETURNED)} of its materials. Climbing
        over takes {duration(CLIMB_TICKS)}, unable to dodge or strike back, and raises the alarm as
        breaking the wall does. So a starting city's armed residents, at home when the attack
        starts, get up onto their wall in time to beat breakers and climbers twice their number.
      </p>
      <p>
        <strong>The wall walk.</strong> Every wall and gate tile has a walk on top, unbroken round
        the ring; whoever is on it is <em>up</em>. Only the city's own realm and its allies get up,
        from the ground next to the wall, and getting up takes {duration(WALL_WALK_TICKS)}, as long
        again to get down. Along the walk is walking, over the gates too, while people pass under a
        gate on the ground. They come down only on the side they went up from, so the walk is never
        a way through the wall. Nobody walks onto a wall on the ground, nor squeezes past its
        corner. A path that ends on the wall counts the time to get up, so your residents go up only
        when you send them there; a path elsewhere never takes the walk. A resident's card says “Up
        on the wall walk”, and scripts see it as <code>me.up</code>. Going after an attacker at the
        wall, by the Alarm default or your order, a resident inside gets up onto the walk beside
        them unless the way round through a gate is quicker; a trading post's and the HQ's soldiers
        do the same.
      </p>
      <p>
        <strong>Towers.</strong> A tower is a {num(FOOTPRINT.tower)} × {num(FOOTPRINT.tower)}{' '}
        building of wood or stone (Build menu, under Defence), standing in a wall's line or alone,
        off resource nodes and not on Mountain. It isn't built over wall tiles: tear those down
        first. Like a wall it closes the way, and its top is part of the wall walk wherever a wall
        tile touches it: residents walk onto it from the walk, or get up onto it from the ground
        beside it as onto a wall. It holds {num(TOWER_ROOM)} residents up at once; one more waits
        beside it until someone leaves. It is broken like a wall but holds out longer: wooden,{' '}
        {num(WALL_STRENGTH.tower)} damage ({duration(breakTicks('tower'))} for that resident), of
        stone {num(STONE_WALL_STRENGTH.tower)} ({duration(breakTicks('tower', true))}), and it is
        struck from beside any of its tiles. Whoever is up on it when it breaks falls, as from a
        wall tile. A tower is broken, not climbed.
      </p>
      <p>
        <strong>Up on a tower.</strong> A resident up on a tower sees {num(TOWER_SIGHT_RANGE)} tiles
        around instead of {num(SIGHT_RANGE)}, and what they see is your realm's Sight: it shows on
        the map, is explored and kept in Last seen like anything else seen. An outsider coming into
        the city's area that such a lookout sees raises the alarm across the whole of its area, so a
        tower warns of an army early. An archer up on a tower shoots {num(TOWER_SHOT_REACH_BONUS)}{' '}
        tiles further than on the ground, beyond an archer on the wall ({num(WALL_SHOT_REACH_BONUS)}{' '}
        further), and up there takes the wall's cover as on the wall.
      </p>
      <p>
        <strong>NPC towers.</strong> A tower is part of a city like its wall, and grows its area the
        same way. An NPC town whose outer wall is all of stone builds stone towers, each just inside
        its wall and touching it: first one by each gate, leaving the way in free, then one in each
        corner. It builds each from Stone it holds beyond its reserve, last of its projects, and
        quarries for it if it has to. While it waits to found a daughter it starts no new tower, so
        founding comes first. Its soldiers on wall posts fill its towers first, {num(TOWER_ROOM)} to
        a tower, its archers before the others. When the town moves its wall out, it builds towers
        on the new wall, and tears the old ones down with the old wall.
      </p>
      <p>
        <strong>The high ground.</strong> Whoever is up strikes down at anyone on the ground next to
        the wall, but nobody on the ground can strike anyone up: from below there is only the wall
        or gate itself to break, or climbing it, both while being struck from above, or shooting up
        at them with a Bow or Crossbow. Order a resident below without Arrows to shoot to attack
        someone up and they won't (“they are up on the wall”). A climber is on the ground until
        over; one who made it and stands on the wall fights those up as anywhere, and so do those up
        on two walls that touch. Up on their own city's wall, defenders still take only{' '}
        {pct(WALL_DEFENCE)} of each blow and each shot.
      </p>
      <p>
        <strong>Archers on the wall.</strong> An archer up on a wall walk shoots{' '}
        {num(WALL_SHOT_REACH_BONUS)} tiles further than on the ground: a Bow{' '}
        {num((SHOT_REACH.bow ?? 0) + WALL_SHOT_REACH_BONUS)} tiles, a Crossbow{' '}
        {num((SHOT_REACH.crossbow ?? 0) + WALL_SHOT_REACH_BONUS)}. So archers on a wall shoot
        attackers before those can shoot back, and take only {pct(WALL_DEFENCE)} of what does come
        back up.
      </p>
      <p>
        <strong>A tile breaks.</strong> When a wall or gate tile breaks, whoever is up on it falls
        to the ground next to it on the inside of the ring (on a stretch with no inside, on the side
        toward its city) and loses {num(FALL_DAMAGE)} health. A fall kills like a blow: one left
        with no health, or Down, dies, and what they carried lies there as loot. Those up on the
        tiles next to it stay up.
      </p>
      <h3>Under attack</h3>
      <p>
        A resident of yours who is struck and lives runs their defence script,{' '}
        <strong>Defend</strong> (one of your default scripts): armed, they fight back at whoever
        struck them until that one is dead, gone or out of sight; unarmed, or struck from up on a
        wall where they can't strike back, they walk home to their city's town hall, away from the
        wall, and stop once there or once no blow has landed for {duration(DEFEND_CALM_TICKS)}.
        Their card says “Defending: fighting back at Bo” or “Defending: fleeing home”, with what
        they were doing on the line under it. What they were doing waits meanwhile: once Defend ends
        they go back to it, a script with its memory, a queue at its step, or a plain order. Struck
        again while defending, they keep defending. Scripts see the last blow as{' '}
        <code>me.struckBy</code> and <code>me.struckAt</code>. Residents of NPC cities, and in an
        army, fight back or flee home the same way. Armed neighbours at home who see the blow come
        to help (see Alarms below).
      </p>
      <p>
        <strong>On a carriage:</strong> the carriage is the way out. An unarmed driver drives on
        where they were going, at the same pace, a haul route too, and an armed one fights back with
        the carriage standing, comes back to it if the fight led away, and then goes on. An unarmed
        passenger stays aboard while the carriage is being driven; on one standing still, with no
        driver driving it or its horse Down or dead, they get off and walk home. An armed passenger
        gets off and fights back. A caravan's driver under attack doesn't wait for the escort
        either. Your own defence script decides for itself: a driver's <code>me.order</code> stays
        their drive or haul route until it gives them another order, and a carriage's{' '}
        <code>standsStill</code> says whether anything moves it.
      </p>
      <p>
        An order you give a resident under attack, while their defence script runs or within{' '}
        {duration(DEFEND_CALM_TICKS)} of a blow, ends the defence script and what it interrupted,
        and further blows don't undo it. One that ends by itself, like a walk or a drive to a
        target, stands until it is done or you replace it, however long that takes. What goes on
        until stopped, like a haul route, working, rallying the crew, a task, a script or a queue, holds until no blow
        has landed for {duration(DEFEND_CALM_TICKS)}; after that the next blow runs the defence
        script as usual. An order given before the attack is interrupted as usual, and what a script
        or queue requests itself doesn't count as given by you.
      </p>
      <h3>Defence script</h3>
      <p>
        Defend is only the default: on a resident's card, the Script tab's{' '}
        <strong>Defence script</strong> picks any of your scripts for them to run when struck
        instead, a default script such as Work too; the group card picks it for all of them at once.
        If the script has params, you pick them as you pick it, as before a script starts, and they
        are kept for that resident like any script's. Back on “Defend (default)”, they defend by
        Defend again. It runs just as Defend does: in place of what they were doing, which goes on
        once it calls <code>end()</code>. It is kept for the resident, across your Leader's death
        too, and only you see it; scripts read it as <code>me.defenceScript</code>, the script's id,
        or <code>null</code> for Defend. If the script is gone from your library when they are
        struck, they defend by Defend, your realm log says so once, and the pick goes back to
        Defend. A resident lent to another realm defends by that realm's Defend.
      </p>
      <h3>Alarms</h3>
      <p>
        An alarm is something happening in a city's area that your residents at home can react to.
        Four things set it off. An occupation of the city's town hall starting reaches every
        resident of your realm standing in that city's area. An <strong>outsider</strong> coming
        into the area, someone of another realm or NPC city who isn't allied, reaches those standing
        there who see them (within {num(SIGHT_RANGE)} tiles), once as they come in and again if they
        leave and come back. Trade Organization caravans and wandering traders, with their crews,
        don't count, and someone already attacking gets no outsider alarm. A theft from your realm
        in that area, of goods from a storage, a carriage or a Down resident, or of a carriage or
        horse, reaches those standing there who see it; what lies in a pile is anyone's to take, so
        that raises none. An attack, someone striking or climbing a wall or gate of the city or
        striking a resident of yours standing in its area, reaches those standing there who see it,
        so the armed residents beside them react rather than only the one struck, who runs their
        defence script. It is raised once per attacker, the first time someone at home sees them at
        it, and again only after {duration(DEFEND_CALM_TICKS)} with no blow from them. Those already
        fighting aren't interrupted, and someone fighting back raises none. Army members, those
        hired out and those driving a carriage get no alarm. It runs their{' '}
        <strong>Alarm script</strong>, which by default is <strong>Alarm</strong> (one of your
        default scripts) for an armed resident and nothing for an unarmed one.
      </p>
      <p>
        Alarm goes after the occupier while they stand in the city's area, any other armed one of
        theirs there after them, and ends once they are gone. It goes after a thief or an attacker
        until they are dead or have left the area or sight; then, while others are still at the
        city's wall or its residents, it goes after the nearest of them in sight, and ends only once
        none is left. Their card says “On alarm: going after Bo”. For an armed outsider it walks to
        the town hall and stands there until no armed outsider is left in the area, then goes back
        to what it was doing; someone armed of yours on the hall blocks an occupation before it
        starts, at no cost in standing. An unarmed outsider it only writes in the script log.
      </p>
      <p>
        <strong>Force at home:</strong> in your own city's area, striking someone occupying its town
        hall, or a thief of your realm that you know of or one of your residents saw, is no crime
        and costs no standing. Someone occupying is someone armed standing on the hall, so one who
        has walked off it no longer is. Striking back at an attacker on their alarm is no crime
        either. Striking anyone else there is a crime as anywhere, and so is striking a thief
        outside the area. Scripts see this as <code>knownThief</code> on those{' '}
        <code>residents()</code> gives: whether your realm knows they stole from it or one of your
        residents saw it, no more than that.
      </p>
      <p>
        On a resident's card, the Script tab's <strong>Alarm script</strong> picks any of your
        scripts for them to run instead, an unarmed resident too, or <strong>None</strong> to run
        nothing; the group card picks it for all of them at once. It runs in place of what they were
        doing, which goes on with its memory once it calls <code>end()</code>, as for a defence
        script. A second alarm doesn't interrupt it, with two exceptions: a theft or an attack takes
        over from an outsider alarm, unless they are already attacking someone, and an occupation
        takes over from any other. The script goes on with its memory, <code>me.alarm</code> now the
        new one, and when it calls <code>end()</code> an outsider alarm it took over from goes on.
        So those holding the hall go after a thief or an attacker, then back to holding while armed
        outsiders remain; should an armed outsider lure them away and step onto the hall, the
        occupation brings them all back. A blow still runs their defence script, and once that ends
        the Alarm script goes on; while a defence script runs, or an order you gave under attack
        holds, an alarm doesn't reach them. An order you give meanwhile ends both. Scripts read the
        alarm as <code>me.alarm</code>: its <code>kind</code>, <code>about</code> who and their{' '}
        <code>realmId</code>, where (<code>cityId</code>, <code>x</code>, <code>y</code>) and{' '}
        <code>tick</code>; <code>inCityArea(cityId, x, y)</code> says whether a tile lies in a
        city's area, <code>cityAreaAt(x, y)</code> which city's area it lies in, and{' '}
        <code>outsidersIn(cityId)</code> lists the outsiders you see in one. The pick reads as{' '}
        <code>me.alarmScript</code>. If the script is gone from your library when an alarm comes,
        your realm log says so once and the pick goes back to Alarm.
      </p>
      <h3>Capturing a city</h3>
      <p>
        A city is captured by occupying its town hall: armed residents of your realm stand on it
        (any of its tiles), nobody else's armed residents do, and none of the city's defenders do
        (armed residents of its realm or an ally, or for an NPC city its own). An ally of yours on
        the hall counts as another realm, so nobody occupies it. Held {days(OCCUPATION_GAME_DAYS)}{' '}
        without a break, the city joins your realm with its buildings and the residents who live
        there, loyal at once; its Leader never joins. Beating its defenders is not enough on its
        own, and defenders elsewhere in the city don't stop the clock: they have to come to the
        hall. An NPC city's soldiers, a trading post's and the HQ's do: anyone occupying their town
        hall is an attacker to them, even one who attacks nobody, and those in the city's area go
        after them, which is no crime. The first tick the occupation doesn't hold, it is broken and
        its days are lost; the next one starts again from nothing. Your realm log says when one of
        your town halls is occupied, by whom, and when the occupation is broken, and likewise when
        you occupy a town hall and when your occupation is broken. Every city is captured this way:
        NPC cities, Players' cities, trading posts and the Trade Org HQ, whose hired mercenaries
        defend it. Anyone with the town hall in sight sees who occupies it and the game days left: a
        small flag in the occupier's colour on the hall, and "Occupied by …" on its tile card and in
        the city inspector, a warning when it is your city. Out of sight it isn't shown, nor
        remembered in Last seen. Scripts see it as <code>city.occupation</code>: who occupies a town
        hall in sight, and the ticks left.
      </p>
      <h3>The fall of the HQ</h3>
      <p>
        Taking the Trade Org HQ is hopeless in practice but not forbidden, and it changes the world
        for good: nothing ever takes its place. The captor gets the city with its people, wherever
        they stand, and its warehouses as storages with everything in them, coins included. Caravans
        end at once: their crew join the captor where they stand, each carriage, horse and load
        going with them. Deliveries and transfers still open are cancelled with a line in your realm
        log and nothing refunded, and trading posts take no new ones. Every contract with the Trade
        Organization ends at once, with no refund and no loss of standing: soldiers you hired from
        it are the captor's where they stand, and your mercenaries guarding the HQ walk home. Its
        punishments and debts end, and admin directives stay in force and can be bought off at a
        post, but it sends nobody out for them. With no caravans or wandering traders the posts'
        warehouses get only what their own hands bring and what people sell them. When the last
        trading post falls too, the Trade Organization is gone.
      </p>
      <h3>What joins with a city</h3>
      <p>
        However a city joins a realm, captured, bought, persuaded or handed over, its horses and
        carriages come with it. An NPC city's are all its own, wherever they stand, at a stable or
        on the road. A Player's aren't tied to one city, so of those the ones in its area or at its
        stables join, and the rest stay with their realm. Either way a horse a joining resident
        rides and a carriage one drives join with them, and a carriage's hitched horse with it.
        Another NPC city's or realm's that happen to stand there don't.
      </p>
    </>
  )
}
