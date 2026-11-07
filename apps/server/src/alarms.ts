import {
  DEFEND_CALM_TICKS,
  SIGHT_RANGE,
  TRADE_ORG,
  commanderOf,
  drivenCarriageId,
  inCityArea,
  isArmed,
  isAt,
  isDown,
  occupiersOf,
  punishers,
  townHallOf,
  wrapDistance,
  type Alarm,
  type Building,
  type City,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { caravanCrew } from './caravans.js'
import { cityOrganization, organizationOf } from './crimes.js'
import { endHoldIfOver } from './defence.js'
import type { Invariant } from './invariants.js'
import { foundingParty } from './npc-founding.js'

/**
 * Alarms (`CONTEXT.md`: Alarm, Alarm script; ADR 0028). Something happening in a City area starts
 * the Alarm script of its realm's residents at home. It runs as `script` like any other, holding
 * the alarm for `me.alarm`, with what they were doing kept aside in `interrupted` as for a defence
 * script (ADR 0015): when it ends they go on with it. A blow still starts the defence script,
 * which keeps the Alarm script aside in turn and hands back to it (`startDefence`). NPC villages,
 * towns and self-managed cities run the same for their armed residents, with the game's default
 * only; trading posts and the HQ keep their own rules (`stepNpcDefence`).
 */

/**
 * Whether an alarm can reach `r`, of the city's Organization and in its area (`CONTEXT.md`: Alarm):
 * army members, those hired out and those driving a carriage get none. Nor do those Down, or on a
 * wall they are climbing, who can't react to a blow either. A trading post's and the HQ's keep their
 * own rules, and those an NPC city doesn't run itself get none (`runApart`).
 */
function canBeAlarmed(world: WorldState, city: City, r: Resident, size: number): boolean {
  return (
    !city.tradeOrg &&
    organizationOf(r) === cityOrganization(city) &&
    commanderOf(world, r) === r.owner &&
    inCityArea(world, city, r.x, r.y, size) &&
    drivenCarriageId(r) === undefined &&
    r.order?.kind !== 'climb' &&
    !isDown(r) &&
    !world.armies.some((a) => a.memberIds.includes(r.id)) &&
    !runApart(world, city, r)
  )
}

/**
 * Whether `r` of an NPC city goes by something other than their city: a caravan, a punishment or a
 * founding (`CONTEXT.md`: Founding), which would give them orders over their Alarm script's.
 */
function runApart(world: WorldState, city: City, r: Resident): boolean {
  if (city.realmId !== null) return false
  return (
    foundingParty(world.cityPlans[city.id]).includes(r.id) ||
    caravanCrew(world).has(r.id) ||
    punishers(world).has(r.id)
  )
}

/**
 * Whether `r` runs the Alarm default as their NPC city's (`runNpcScripts`): one of a city that has
 * no realm and isn't the Trade Organization's, so nobody else is to end it.
 */
export function runsNpcAlarm(world: WorldState, r: Resident): boolean {
  if (r.owner !== null || r.script?.task !== 'alarm' || r.script.scriptId !== 0) return false
  const city = world.cities.find((c) => c.id === r.cityId)
  return !!city && city.realmId === null && !city.tradeOrg
}

/**
 * Starts `t`'s Alarm script for `alarm`, keeping what they were doing aside (`CONTEXT.md`: Alarm
 * script): the script their Player picked (`Resident.alarmScriptId`), else, for an armed resident,
 * the Alarm default of their realm (script id 0, which the runner resolves); for None or unarmed
 * with none picked, nothing. One no Player commands has no pick: they run the game's default if
 * armed (`CONTEXT.md`: NPC city). Not while a defence script runs, or over what the Player gave them
 * under attack, while that holds. Nor while an Alarm script runs, unless the new alarm takes over
 * from its alarm (`takesOver`): the script goes on with its memory, for the new alarm.
 */
export function startAlarm(world: WorldState, t: Resident, alarm: Alarm): void {
  const picked = commanderOf(world, t) === null ? undefined : t.alarmScriptId
  if (picked === 'none' || (picked === undefined && !isArmed(t))) return
  endHoldIfOver(world, t)
  const running = t.script?.task === 'alarm' ? t.script : undefined
  if (running?.alarm && takesOver(t, running.alarm, alarm)) {
    const under = running.alarm.kind === 'outsider' ? running.alarm : running.alarmUnder
    if (under) running.alarmUnder = under
    running.alarm = alarm
    delete running.waitingSince
    t.order = null
    return
  }
  if (t.interrupted || t.givenUnderAttack) return
  if (t.script) delete t.script.waitingSince
  t.interrupted = { order: t.order, ...(t.script ? { script: t.script } : {}) }
  t.order = null
  t.script = { scriptId: picked ?? 0, task: 'alarm', memory: {}, alarm }
}

/**
 * Whether `alarm` takes over from the alarm `t`'s Alarm script runs for (`CONTEXT.md`: Alarm
 * script): an occupation from any other, and a theft or an attack from an outsider, unless they
 * are already attacking someone.
 */
function takesOver(t: Resident, running: Alarm, alarm: Alarm): boolean {
  if (alarm.kind === 'occupied') return running.kind !== 'occupied'
  if (alarm.kind === 'outsider' || running.kind !== 'outsider') return false
  return t.order?.kind !== 'attack'
}

/**
 * `r`'s Alarm script called `end()`: if its alarm took over from an outsider alarm, the script goes
 * on for that one, with its memory (`CONTEXT.md`: Alarm script), and those holding the hall go back
 * to it. False if there is none to go back to, and it really ends.
 */
export function backToOutsiderAlarm(r: Resident): boolean {
  const under = r.script?.alarmUnder
  if (!under) return false
  r.script!.alarm = under
  delete r.script!.alarmUnder
  r.order = null
  return true
}

/**
 * An occupation of `city`'s town hall by the realm `occupier` just started (`CONTEXT.md`: Alarm,
 * occupied): it reaches all its residents in its area, whoever sees it or not. Raised again for one
 * who already runs it, it leaves them alone (`startAlarm`).
 */
export function raiseOccupied(world: WorldState, city: City, occupier: string, size: number): void {
  const hall = townHallOf(world, city)
  if (!hall) return
  // Occupying takes someone armed there, so there is one to name; the Trade Org's are of no realm.
  const someone = world.residents.find(
    (r) =>
      isArmed(r) && isAt(r, hall, size) && (r.owner === occupier || occupier === TRADE_ORG),
  )
  if (!someone) return
  const alarm: Alarm = {
    kind: 'occupied',
    cityId: city.id,
    about: someone.id,
    realmId: occupier,
    x: hall.x,
    y: hall.y,
    tick: world.tick,
  }
  for (const r of world.residents) {
    if (canBeAlarmed(world, city, r, size)) startAlarm(world, r, alarm)
  }
}

/**
 * `who`, an outsider, just came into `city`'s area (`CONTEXT.md`: Alarm, outsider): it reaches its
 * residents in its area who see them, within sight range themselves, but for those already
 * attacking someone, who stay at it.
 */
export function raiseOutsider(world: WorldState, city: City, who: Resident, size: number): void {
  const org = cityOrganization(city)
  const alarm: Alarm = {
    kind: 'outsider',
    cityId: city.id,
    about: who.id,
    realmId: who.owner,
    x: who.x,
    y: who.y,
    tick: world.tick,
  }
  for (const r of world.residents) {
    if (organizationOf(r) !== org || wrapDistance(size, r, who) > SIGHT_RANGE) continue
    if (r.order?.kind !== 'attack' && canBeAlarmed(world, city, r, size)) {
      startAlarm(world, r, alarm)
    }
  }
}

/**
 * `a` just attacked something of `city` at `at` (`CONTEXT.md`: Alarm, attacked): `at` is one of its
 * walls or gates, or `struck`, a resident of its Organization standing in its area, whose answer to the
 * blow is their Defence script. It reaches those at home who see it, leaving alone those already
 * fighting. Raised once per attacker: while their blows keep coming, the rest raise nothing. An
 * attack nobody at home saw has raised nothing yet, so the next blow someone sees does.
 */
function raiseAttacked(
  world: WorldState,
  city: City,
  a: Resident,
  at: { x: number; y: number },
  struck: Resident | undefined,
  size: number,
): void {
  const raised = city.alarmedAttackers?.[a.id]
  if (raised !== undefined && world.tick - raised < DEFEND_CALM_TICKS) {
    city.alarmedAttackers![a.id] = world.tick
    return
  }
  const org = cityOrganization(city)
  const witnesses = world.residents.filter(
    (r) =>
      r !== struck &&
      organizationOf(r) === org &&
      wrapDistance(size, r, at) <= SIGHT_RANGE &&
      canBeAlarmed(world, city, r, size),
  )
  if (witnesses.length === 0) return
  const stillFresh = Object.entries(city.alarmedAttackers ?? {}).filter(
    ([, tick]) => world.tick - tick < DEFEND_CALM_TICKS,
  )
  city.alarmedAttackers = { ...Object.fromEntries(stillFresh), [a.id]: world.tick }
  const alarm: Alarm = {
    kind: 'attacked',
    cityId: city.id,
    about: a.id,
    realmId: a.owner,
    x: at.x,
    y: at.y,
    tick: world.tick,
  }
  for (const r of witnesses) {
    if (r.order?.kind !== 'attack') startAlarm(world, r, alarm)
  }
}

/**
 * Whether `a`'s blow is an attack on the Organization `org` for its `attacked` alarm: a blow struck
 * in fighting back is none (`CONTEXT.md`: Alarm), nor is one by someone of that Organization.
 */
function attacksOrganization(a: Resident, org: string | null): boolean {
  if (org === null || organizationOf(a) === org) return false
  return !(a.order?.kind === 'attack' && a.order.defending)
}

/** `a`'s blow at the wall or gate `wall` raises an `attacked` alarm in its city (`raiseAttacked`). */
export function raiseWallAttacked(world: WorldState, a: Resident, wall: Building, size: number) {
  const city = world.cities.find((c) => c.id === wall.cityId)
  if (city && attacksOrganization(a, cityOrganization(city))) {
    raiseAttacked(world, city, a, wall, undefined, size)
  }
}

/**
 * `a`'s blow at the resident `t` raises an `attacked` alarm in each city of `t`'s Organization whose
 * area they stand in (`raiseAttacked`); out of those, nothing.
 */
export function raiseResidentAttacked(world: WorldState, a: Resident, t: Resident, size: number) {
  const org = organizationOf(t)
  if (!attacksOrganization(a, org)) return
  for (const city of world.cities) {
    if (cityOrganization(city) === org && inCityArea(world, city, t.x, t.y, size)) {
      raiseAttacked(world, city, a, t, t, size)
    }
  }
}

/**
 * `thief` just stole from the Organization `victimOrg`, on a map of `size` tiles (`CONTEXT.md`:
 * Alarm, theft): standing in the area of a city of that Organization, it reaches its residents
 * standing there who see it. Taking from your own raises none.
 */
export function raiseTheft(
  world: WorldState,
  thief: Resident,
  victimOrg: string,
  size: number,
): void {
  if (organizationOf(thief) === victimOrg) return
  for (const city of world.cities) {
    if (cityOrganization(city) !== victimOrg) continue
    if (!inCityArea(world, city, thief.x, thief.y, size)) continue
    const alarm: Alarm = {
      kind: 'theft',
      cityId: city.id,
      about: thief.id,
      realmId: thief.owner,
      x: thief.x,
      y: thief.y,
      tick: world.tick,
    }
    for (const r of world.residents) {
      if (wrapDistance(size, r, thief) <= SIGHT_RANGE && canBeAlarmed(world, city, r, size)) {
        startAlarm(world, r, alarm)
      }
    }
  }
}

/**
 * Whether `r` going after `targetId` answers the attack their Alarm script runs for: they strike
 * back, which is no crime (`CONTEXT.md`: Alarm), whatever the attacker has gone on to since.
 */
export function answersAttack(r: Resident, targetId: string): boolean {
  const alarm = r.script?.alarm
  return alarm?.kind === 'attacked' && alarm.about === targetId
}

/**
 * Whether `r`, of an NPC city, goes after `targetId` as one occupying their town hall for their Alarm
 * script (`CONTEXT.md`: Occupying a town hall): no crime, as for any of its soldiers. An occupier need
 * attack nobody, may have left the hall by the time the blows land, and stops occupying it the moment
 * a defender stands on it, so the order has to say so from the start.
 */
export function goesAfterOccupier(
  world: WorldState,
  r: Resident,
  targetId: string,
  size: number,
): boolean {
  if (r.owner !== null || r.script?.alarm?.kind !== 'occupied') return false
  const city = world.cities.find((c) => c.id === r.cityId)
  return !!city && occupiersOf(world, city, size).some((o) => o.id === targetId)
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Alarm): who raised an `attacked` alarm is kept with the tick of
 * a blow already struck.
 */
export const alarmedAttackersSound: Invariant = {
  name: 'alarmed-attackers-sound',
  check: (world) =>
    world.cities.flatMap((c) =>
      Object.entries(c.alarmedAttackers ?? {})
        .filter(([, tick]) => !Number.isInteger(tick) || tick < 0 || tick > world.tick)
        .map(([id, tick]) => ({
          invariant: 'alarmed-attackers-sound',
          message: `${c.id} keeps ${id} as an attacker at tick ${tick}, at tick ${world.tick}`,
          entityIds: [c.id, id],
        })),
    ),
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Alarm script): nobody runs two Alarm scripts. One running
 * holds its alarm and has what it interrupted kept aside, so that they get it back; kept aside
 * itself, a defence script is what runs, and what it interrupted is no Alarm or defence script.
 */
export const alarmsSound: Invariant = {
  name: 'alarms-sound',
  check: (world) =>
    world.residents.flatMap((r) => {
      const kept = r.interrupted
      const aside = kept?.alarm
      const problems = [
        r.script?.task === 'alarm' && !r.script.alarm && 'runs an Alarm script with no alarm',
        r.script?.alarm?.about === r.id && 'runs an Alarm script about themselves',
        r.script?.task === 'alarm' && !kept && 'runs an Alarm script with nothing kept aside',
        r.script?.task === 'alarm' && aside && 'runs two Alarm scripts',
        r.script?.alarmUnder && r.script.task !== 'alarm' && 'keeps an alarm under no Alarm script',
        r.script?.alarmUnder &&
          r.script.alarmUnder.kind !== 'outsider' &&
          'keeps an alarm to go back to that is no outsider alarm',
        r.script?.alarmUnder?.kind === 'outsider' &&
          r.script.alarm?.kind === 'outsider' &&
          'keeps an outsider alarm under another',
        aside && r.script?.task !== 'defend' && 'keeps an Alarm script aside but doesn’t defend',
        aside && aside.script.task !== 'alarm' && 'keeps a script aside as an Alarm script',
        kept?.script?.task === 'alarm' && 'came back to an Alarm script as what it interrupted',
        kept?.script?.task === 'defend' && 'came back to a defence script as what it interrupted',
      ].filter((p): p is string => typeof p === 'string')
      return problems.map((p) => ({
        invariant: 'alarms-sound',
        message: `${r.id} ${p}`,
        entityIds: [r.id],
      }))
    }),
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Alarm script): a resident's picked Alarm script is a script
 * id, a whole positive number, or None.
 */
export const alarmScriptSound: Invariant = {
  name: 'alarm-script-sound',
  check: (world) =>
    world.residents
      .filter((r) => {
        const picked = r.alarmScriptId
        if (picked === undefined || picked === 'none') return false
        return !Number.isInteger(picked) || picked <= 0
      })
      .map((r) => ({
        invariant: 'alarm-script-sound',
        message: `${r.id} keeps Alarm script ${r.alarmScriptId}, which can't be one`,
        entityIds: [r.id],
      })),
}
