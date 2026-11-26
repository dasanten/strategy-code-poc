// What each kind of building is for, and the Build menu's groups, from the specs.

import { BUILD_MENU_GROUPS, BUILDING_KINDS, BUILDING_SPECS } from '@csp/balance'
import { BUILDABLE } from './building.js'
import type { BuildingKind } from '@csp/shared-types'

/**
 * What each kind of building is for, in words (`CONTEXT.md`: each building's own entry): the one
 * description the Build menu and the building card's ⓘ share. Its spec's, with the numbers in it
 * from the balance.
 */
export const BUILDING_PURPOSE: Record<BuildingKind, string> = Object.fromEntries(
  BUILDING_KINDS.map((kind) => [kind, BUILDING_SPECS[kind].purpose]),
) as Record<BuildingKind, string>

/**
 * The groups of the Build menu and the kinds in each, in the order it shows them (`CONTEXT.md`:
 * Build menu). Every buildable kind is in exactly one.
 */
export const BUILD_GROUPS: readonly { name: string; kinds: readonly BuildingKind[] }[] =
  BUILD_MENU_GROUPS.map((name) => ({
    name,
    kinds: BUILDABLE.filter((kind) => BUILDING_SPECS[kind].buildMenu?.group === name),
  }))
