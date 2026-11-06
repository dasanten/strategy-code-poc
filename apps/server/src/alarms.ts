import {
  SIGHT_RANGE,
  TRADE_ORG,
  commanderOf,
  drivenCarriageId,
  inCityArea,
  isArmed,
  isAt,
  isDown,
  townHallOf,
  wrapDistance,
  type Alarm,
  type City,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { organizationOf } from './crimes.js'
import { endHoldIfOver } from './defence.js'
import type { Invariant } from './invariants.js'

/**
 * Alarms (`CONTEXT.md`: Alarm, Alarm script; ADR 0028). Something happening in a City area starts
 * the Alarm script of its realm's residents at home. It runs as `script` like any other, holding
 * the alarm for `me.alarm`, with what they were doing kept aside in `interrupted` as for a defence
 * script (ADR 0015): when it ends they go on with it. A blow still starts the defence script,
 * which keeps the Alarm script aside in turn and hands back to it (`startDefence`).
 */

/**
 * Whether an alarm can reach `r`, of the city's realm and in its area (`CONTEXT.md`: Alarm): army
 * members, those hired out and those driving a carriage get none. Nor do those Down, or on a wall
 * they are climbing, who can't react to a blow either.
 */
function canBeAlarmed(world: WorldState, city: City, r: Resident, size: number): boolean {
  return (
    city.realmId !== null &&
    r.owner === city.realmId &&
    commanderOf(world, r) === r.owner &&
    inCityArea(world, city, r.x, r.y, size) &&
    drivenCarriageId(r) === undefined &&
    r.order?.kind !== 'climb' &&
    !isDown(r) &&
    !world.armies.some((a) => a.memberIds.includes(r.id))
  )
}

/**
 * Starts `t`'s Alarm script for `alarm`, keeping what they were doing aside (`CONTEXT.md`: Alarm
 * script): the script their Player picked (`Resident.alarmScriptId`), else, for an armed resident,
 * the Alarm default of their realm (script id 0, which the runner resolves); for None or unarmed
 * with none picked, nothing. Not while an Alarm or defence script runs, or over what the Player
 * gave them under attack, while that holds.
 */
export function startAlarm(world: WorldState, t: Resident, alarm: Alarm): void {
  const picked = t.alarmScriptId
  if (picked === 'none' || (picked === undefined && !isArmed(t))) return
  endHoldIfOver(world, t)
  if (t.interrupted || t.givenUnderAttack) return
  if (t.script) delete t.script.waitingSince
  t.interrupted = { order: t.order, ...(t.script ? { script: t.script } : {}) }
  t.order = null
  t.script = { scriptId: picked ?? 0, task: 'alarm', memory: {}, alarm }
}

/**
 * An occupation of `city`'s town hall by the realm `occupier` just started (`CONTEXT.md`: Alarm,
 * occupied): it reaches all its realm's residents in its area, whoever sees it or not. An NPC city
 * has nobody to reach yet.
 */
export function raiseOccupied(world: WorldState, city: City, occupier: string, size: number): void {
  const hall = townHallOf(world, city)
  if (!hall || city.realmId === null) return
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
 * `thief` just stole from the Organization `victimOrg`, on a map of `size` tiles (`CONTEXT.md`:
 * Alarm, theft): standing in the area of a city of that realm, it reaches its residents standing
 * there who see it. Taking from your own raises none, and an NPC city has nobody to reach yet.
 */
export function raiseTheft(
  world: WorldState,
  thief: Resident,
  victimOrg: string,
  size: number,
): void {
  if (organizationOf(thief) === victimOrg) return
  for (const city of world.cities) {
    if (city.realmId !== victimOrg || !inCityArea(world, city, thief.x, thief.y, size)) continue
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
