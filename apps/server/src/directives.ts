import {
  MAX_DIRECTIVE_REASON,
  TRADE_ORG,
  isAllianceCity,
  organizationLabel,
  standingOrganization,
  type AdminDirectiveView,
  type Directive,
  type DirectiveTarget,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'
import { newId } from './starting-city.js'

/*
 * Admin directives (`CONTEXT.md`: Admin directive): an admin, in the admin panel apart from the
 * game, orders the Trade Organization to weaken an Organization. The game still forbids nothing:
 * the Trade Organization refuses it trade and sends its army against it through its normal rules
 * (`tradeOrgRefuses`, `stepPunishments`) until an admin lifts the directive.
 */

/** Whether an id names an Organization a directive can name: a realm, or an NPC city. */
export function canBeNamed(world: WorldState, org: string): boolean {
  return world.realms.some((r) => r.id === org) || isAllianceCity(world, org)
}

/**
 * Every Organization an admin can name, realms first, each by name; `accountOf` gives a realm's
 * Player's account name.
 */
export function directiveTargetChoices(
  world: WorldState,
  accountOf: (userId: number) => string | undefined,
): DirectiveTarget[] {
  const realms: DirectiveTarget[] = world.realms.map((r) => ({
    org: r.id,
    name: organizationLabel(world, r.id),
    is: 'realm',
    account: accountOf(r.userId),
  }))
  const cities: DirectiveTarget[] = world.cities
    .filter((c) => isAllianceCity(world, c.id))
    .map((c) => ({ org: c.id, name: c.name, is: 'city' }))
  const byName = (a: DirectiveTarget, b: DirectiveTarget) => a.name.localeCompare(b.name)
  return [...realms.sort(byName), ...cities.sort(byName)]
}

/** Every directive in force as admins see it, with who gave it. */
export function adminDirectives(world: WorldState): AdminDirectiveView[] {
  return world.directives.map((d) => ({
    id: d.id,
    target: d.target,
    targetName: organizationLabel(world, d.target),
    withAlliance: d.withAlliance,
    reason: d.reason,
    givenAt: d.givenAt,
    givenBy: d.givenBy,
  }))
}

/**
 * An admin gives a directive. Returns it, or why it can't be given: the target must be a realm
 * or an NPC city not already named by a directive of its own, and the reason must be said.
 */
export function giveDirective(
  world: WorldState,
  input: { target: unknown; withAlliance: unknown; reason: unknown },
  givenBy: string,
): Directive | string {
  const { target, withAlliance } = input
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (typeof target !== 'string' || !canBeNamed(world, target)) {
    return 'Name a realm or an NPC city.'
  }
  if (typeof withAlliance !== 'boolean') return 'Say whether it names the alliance too.'
  if (reason.length === 0) return 'Give a reason; every Player sees it.'
  if (reason.length > MAX_DIRECTIVE_REASON) {
    return `Keep the reason to ${MAX_DIRECTIVE_REASON} characters.`
  }
  if (world.directives.some((d) => d.target === target)) {
    return `A directive already names ${organizationLabel(world, target)}.`
  }
  const directive: Directive = {
    id: newId(world, 'directive'),
    target,
    withAlliance,
    reason,
    givenBy,
    givenAt: world.tick,
  }
  world.directives.push(directive)
  return directive
}

/** An admin lifts a directive. Returns whether there was one by that id. */
export function liftDirective(world: WorldState, id: string): boolean {
  const before = world.directives.length
  world.directives = world.directives.filter((d) => d.id !== id)
  return world.directives.length < before
}

/**
 * Directives hold together (`CONTEXT.md`: Admin directive; ADR 0004): each has its own id, names
 * an Organization other than the Trade Organization that no other directive names, says a reason
 * within `MAX_DIRECTIVE_REASON` and who gave it, and was given no later than now.
 */
export const directivesSound: Invariant = {
  name: 'directives-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (message: string, entityIds: string[]) =>
      out.push({ invariant: this.name, message, entityIds })
    const ids = new Set<string>()
    const targets = new Set<string>()
    for (const d of world.directives ?? []) {
      if (ids.has(d.id)) fail(`directive id ${d.id} is used twice`, [d.id])
      ids.add(d.id)
      if (d.target === TRADE_ORG || standingOrganization(world, d.target) === TRADE_ORG) {
        fail(`directive ${d.id} names the Trade Organization`, [d.id])
      }
      if (targets.has(d.target)) fail(`${d.target} is named by two directives`, [d.id])
      targets.add(d.target)
      if (d.reason.trim().length === 0 || d.reason.length > MAX_DIRECTIVE_REASON) {
        fail(`directive ${d.id} has a reason of ${d.reason.length} characters`, [d.id])
      }
      if (d.givenBy.length === 0) fail(`directive ${d.id} says no admin gave it`, [d.id])
      if (d.givenAt > world.tick) fail(`directive ${d.id} was given in the future`, [d.id])
    }
    return out
  },
}
