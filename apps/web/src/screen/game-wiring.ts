import type { Building, Resident, ScriptSummary, SeenCity } from '@csp/shared-types'
import { commandsSeen } from '../army/alliance-army.js'
import { faresKnown } from '../residents/seen.js'
import type { ClientWorld, useWorld } from '../world/useWorld.js'
import type { usePick } from '../pick/usePick.js'
import type { useSelection } from './useSelection.js'
import type { useKnownGround } from '../map/useKnownGround.js'
import type { useRealmOrder } from '../realm/useRealmOrder.js'
import type { useStartForm } from '../script/useStartForm.js'
import type { usePlanning } from '../queue/usePlanning.js'
import type { useScriptWorkshop } from '../script/useScriptWorkshop.js'
import type { useOpenCity } from '../city/useOpenCity.js'
import type { useResidentPanels } from '../residents/useResidentPanels.js'
import type { useSidebarTabs } from './useSidebarTabs.js'

/**
 * What the screen's cards and tabs read of what the Player sees, gathered once in `Game`, which
 * wires the parts of the screen together (`App.tsx`).
 */
export interface GameSeen {
  world: ClientWorld
  /** The residents the Player gives orders to (`ownResidents`). */
  own: Resident[]
  /** The other realms the Player knows by name (`realmsKnown`). */
  realms: ReturnType<typeof realmsKnown>
  /** The cities and buildings the Player knows, in sight or remembered (`CONTEXT.md`: Last seen). */
  knownCities: SeenCity[]
  knownBuildings: Building[]
  /** The script library's list (`useScriptWorkshop`). */
  scripts: ScriptSummary[]
  /** Narrow or touch: cards are bottom sheets and the HUD folds into a menu button (ADR 0012). */
  phone: boolean
}

/** How a card's sheet shows: on a phone, in the dock on a desktop, or hidden behind a screen. */
export interface Sheet {
  phone: boolean
  dock: HTMLElement | null
  hidden: boolean
}

/** What the parts of the screen share, each as its hook gives it. */
export type Live = ReturnType<typeof useWorld>
export type Picker = ReturnType<typeof usePick>
export type SelectionState = ReturnType<typeof useSelection>
export type Ground = ReturnType<typeof useKnownGround>
export type RealmOrderState = ReturnType<typeof useRealmOrder>
export type StartForm = ReturnType<typeof useStartForm>
export type Planning = ReturnType<typeof usePlanning>
export type Workshop = ReturnType<typeof useScriptWorkshop>
export type OpenCity = ReturnType<typeof useOpenCity>
export type ResidentPanels = ReturnType<typeof useResidentPanels>
export type SidebarTabs = ReturnType<typeof useSidebarTabs>

/**
 * The residents the Player gives orders to: their own, less those handed over to their alliance's
 * army or rented out, and, as its alliance leader, the ones handed over (`CONTEXT.md`: Alliance
 * army) and the mercenaries they hired (`CONTEXT.md`: Mercenary contract).
 */
export function ownResidents(world: ClientWorld | null): Resident[] {
  return world
    ? world.residents.filter(
        (r): r is Resident => commandsSeen(world.diplomacy, world.home.realmId, r) && faresKnown(r),
      )
    : []
}

/** The other realms (and NPC cities) the Player knows by name: their allies and those in sight. */
export function realmsKnown(world: ClientWorld) {
  return [
    ...(world.diplomacy.alliance?.members ?? []).filter((m) => m.realmId !== world.home.realmId),
    ...world.diplomacy.realmsInSight,
  ]
}

/** The realm's Leader and heir (`CONTEXT.md`: Leader, Heir). */
export function leadership(world: ClientWorld | null) {
  const leader = world?.residents.find(
    (r): r is Resident => r.id === world.home.leaderId && faresKnown(r),
  )
  // The realm's heir (`CONTEXT.md`: Heir): absent before the world comes, null with none.
  const heirId = world?.home.heirId ?? null
  const heirName = world && heirId ? world.residents.find((r) => r.id === heirId)?.name : undefined
  const heirShown = world && leader ? (heirName ?? null) : undefined
  return { leader, heirId, heirName, heirShown }
}
