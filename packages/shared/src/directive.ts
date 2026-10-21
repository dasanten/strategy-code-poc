import type { Directive, WorldState } from './world.js'

/**
 * World queries about admin directives (`CONTEXT.md`: Admin directive), for the game API (ADR
 * 0002). Every Player sees each directive's target and reason; who gave it stays with admins.
 */

/** The longest reason an admin can give, in characters. */
export const MAX_DIRECTIVE_REASON = 500

/**
 * The Organizations a directive names: its target, and with `withAlliance` every member of the
 * target's alliance as it stands now (`CONTEXT.md`: Alliance: at most one).
 */
export function directiveTargets(
  world: Pick<WorldState, 'alliances'>,
  d: Pick<Directive, 'target' | 'withAlliance'>,
): string[] {
  if (!d.withAlliance) return [d.target]
  const alliance = world.alliances.find((a) => a.members.some((m) => m.realmId === d.target))
  return alliance ? alliance.members.map((m) => m.realmId) : [d.target]
}

/**
 * The directive that has the Trade Organization treat an Organization as one to punish, if any:
 * the oldest naming it.
 */
export function directiveAgainst(
  world: Pick<WorldState, 'directives' | 'alliances'>,
  org: string,
): Directive | undefined {
  return world.directives.find((d) => directiveTargets(world, d).includes(org))
}

/** A directive as every Player sees it: its target and reason, never who gave it. */
export interface DirectiveView {
  id: string
  target: string
  /** The target's name: a realm's by its Leader's name, an NPC city's its own. */
  targetName: string
  withAlliance: boolean
  reason: string
  givenAt: number
}

/** A directive as admins see it, with who gave it. */
export interface AdminDirectiveView extends DirectiveView {
  givenBy: string
}

/** Every directive in force as a Player sees it, oldest first. */
export function directivesFor(
  world: Pick<WorldState, 'directives'>,
  nameOf: (org: string) => string,
): DirectiveView[] {
  return world.directives.map((d) => ({
    id: d.id,
    target: d.target,
    targetName: nameOf(d.target),
    withAlliance: d.withAlliance,
    reason: d.reason,
    givenAt: d.givenAt,
  }))
}
