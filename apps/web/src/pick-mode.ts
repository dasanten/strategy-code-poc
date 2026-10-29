import { useEffect, useState } from 'react'
import { ROAD_LINE_MAX_TILES, type ScriptParam } from '@csp/shared'
import type { ArmyPick } from './Armies.js'
import type { GroupPicking, Picking } from './Residents.js'

/**
 * What the map is waiting for while an order that needs a target is being given (ADR 0012;
 * `CONTEXT.md`: Picking a target): the picked resident's, the group's, an army's, or a value for
 * a param of the script the picked resident runs.
 */
export type PickTarget =
  | { kind: 'resident'; mode: Exclude<Picking, false> }
  | { kind: 'group'; mode: Exclude<GroupPicking, false> }
  | { kind: 'army'; mode: ArmyPick['kind'] }
  | { kind: 'param'; param: ScriptParam }

/** The target the map waits for, if any; one at a time, the param before the others. */
export function pickTarget(state: {
  picking: Picking
  groupPicking: GroupPicking
  /** Whether several residents are picked, so a group order is the one waiting. */
  isGroup: boolean
  armyPick: ArmyPick | undefined
  paramPick: ScriptParam | undefined
}): PickTarget | undefined {
  if (state.paramPick) return { kind: 'param', param: state.paramPick }
  if (state.armyPick) return { kind: 'army', mode: state.armyPick.kind }
  if (state.isGroup && state.groupPicking) return { kind: 'group', mode: state.groupPicking }
  if (!state.isGroup && state.picking) return { kind: 'resident', mode: state.picking }
  return undefined
}

const RESIDENT_PROMPTS: Record<Exclude<Picking, false>, string> = {
  walk: 'where to walk',
  drive: 'where to drive the carriage',
  haul: 'where the haul route’s other stop is',
  road: 'where the road ends',
  wall: 'where the wall ends',
}

const GROUP_PROMPTS: Record<Exclude<GroupPicking, false>, string> = {
  walk: 'where they walk',
  work: 'the workplace they work',
  build: 'where to build, or a site to join',
  drive: 'where they drive the carriages',
  haul: 'where the haul route’s other stop is',
  roadFrom: 'where the road starts',
  roadTo: 'where the road ends',
  wallFrom: 'where the wall starts',
  wallTo: 'where the wall ends',
  tearDown: 'the building they tear down',
  storeAt: 'the storage, stable or carriage they store at',
  fetchFrom: 'the storage, stable or carriage they fetch from',
  attack: 'whom they attack, or the wall or gate they break',
  climb: 'the wall or gate they climb',
}

const ARMY_PROMPTS: Record<ArmyPick['kind'], string> = {
  armyWalkTo: 'where the army marches',
  armyGuard: 'where the army stands guard',
}

const PARAM_PROMPTS: Record<ScriptParam['type'], string> = {
  building: 'the building',
  storage: 'the storage, stable or carriage',
  // Typed into its field, never picked on the map.
  number: 'the number',
}

/** What picking a tile does for the picked resident, said under the banner where it needs more. */
const RESIDENT_HINTS: Partial<Record<Exclude<Picking, false>, string>> = {
  road: `Builds road from here to there, straight or diagonal, at most ${ROAD_LINE_MAX_TILES} tiles, one after another, with the stone carried; without more, the resident waits on the next site until someone delivers it.`,
  wall: `Builds wall from here to there, straight or diagonal, at most ${ROAD_LINE_MAX_TILES} tiles, one after another, with the wood carried, past tiles with a wall or gate; without more, the resident waits on the next site until someone delivers it.`,
}

/** What picking a tile does for a group, said under the banner. */
export const GROUP_HINTS: Record<Exclude<GroupPicking, false>, string> = {
  walk: 'They spread over free tiles around it, nearest first.',
  work: 'Those standing at the workplace there work it.',
  build: 'Then pick what to build on their card.',
  drive: 'Each standing on a carriage drives it there.',
  haul: 'Each standing on a carriage hauls between there and their tile.',
  roadFrom: 'Then where it ends; they all build along the line.',
  roadTo: `They all build road along the line, straight or diagonal, at most ${ROAD_LINE_MAX_TILES} tiles.`,
  wallFrom: 'Then where it ends; they all build along the line.',
  wallTo: `They all build wall along the line, straight or diagonal, at most ${ROAD_LINE_MAX_TILES} tiles.`,
  tearDown: 'Those standing at it tear it down.',
  storeAt: 'Each takes there everything they carry, keeping their own Food.',
  fetchFrom: 'Each fetches as much as fits of the good from there.',
  attack: 'They all attack it.',
  climb: 'Those standing next to it climb over.',
}

/** More on what picking does, for the banner's second line, where the prompt doesn't say it all. */
export function pickHint(target: PickTarget): string | undefined {
  if (target.kind === 'resident') return RESIDENT_HINTS[target.mode]
  if (target.kind === 'group') return GROUP_HINTS[target.mode]
  return undefined
}

/** Whether the screen is mainly touched rather than pointed at with a mouse. */
export function useTouchScreen(): boolean {
  return useMediaQuery('(pointer: coarse)')
}

/** Whether the screen matches a CSS media query, kept up to date as it changes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false)
  useEffect(() => {
    const list = window.matchMedia?.(query)
    if (!list) return
    const onChange = () => setMatches(list.matches)
    onChange()
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/**
 * The banner shown while picking: "Click where …" with a mouse, "Tap where …" on a touch
 * screen.
 */
export function pickPrompt(target: PickTarget, touch: boolean): string {
  const verb = touch ? 'Tap' : 'Click'
  if (target.kind === 'resident') return `${verb} ${RESIDENT_PROMPTS[target.mode]}`
  if (target.kind === 'group') return `${verb} ${GROUP_PROMPTS[target.mode]}`
  if (target.kind === 'army') return `${verb} ${ARMY_PROMPTS[target.mode]}`
  return `${verb} ${PARAM_PROMPTS[target.param.type]} for ${target.param.name}`
}
