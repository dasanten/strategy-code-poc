import { isArmed } from './balance.js'
import type { Directive, DirectiveGoal, Resident, WorldState } from './world.js'

/**
 * World queries about admin directives (`CONTEXT.md`: Admin directive), for the game API (ADR
 * 0002). Every Player sees each directive's target, reason and goals; who gave it and how far its
 * goals have come stay with admins.
 */

/** The longest reason an admin can give, in characters. */
export const MAX_DIRECTIVE_REASON = 500

/** The most goals one directive can have. */
export const MAX_DIRECTIVE_GOALS = 8

/** The most soldiers a `soldiers` goal can ask to be killed. */
export const MAX_DIRECTIVE_SOLDIERS = 10_000

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

/**
 * The soldiers of the Organizations a directive names: armed residents of those realms, or of
 * those NPC cities (`CONTEXT.md`: Soldier).
 */
export function directiveSoldiers(
  world: Pick<WorldState, 'alliances' | 'residents'>,
  d: Pick<Directive, 'target' | 'withAlliance'>,
): Resident[] {
  const orgs = directiveTargets(world, d)
  return world.residents.filter((r) => orgs.includes(r.owner ?? r.cityId ?? '') && isArmed(r))
}

/** Whether a directive's goal is met. */
export function goalMet(d: Pick<Directive, 'soldiersKilled'>, goal: DirectiveGoal): boolean {
  return goal.kind === 'city' ? goal.met : d.soldiersKilled >= goal.count
}

/**
 * Whether all of a directive's goals are met, so it ends (`CONTEXT.md`: Admin directive). One
 * with no goals ends only when an admin lifts it.
 */
export function goalsMet(d: Pick<Directive, 'goals' | 'soldiersKilled'>): boolean {
  return d.goals.length > 0 && d.goals.every((g) => goalMet(d, g))
}

/** A directive's goal as every Player sees it: what it asks, not how far it has come. */
export type DirectiveGoalView =
  { kind: 'city'; city: string } | { kind: 'soldiers'; count: number; percent?: number }

/** A directive as every Player sees it: its target, reason, goals and price, never who gave it. */
export interface DirectiveView {
  id: string
  target: string
  /** The target's name: a realm's by its Leader's name, an NPC city's its own. */
  targetName: string
  withAlliance: boolean
  reason: string
  givenAt: number
  goals: DirectiveGoalView[]
  /** The Coins the target can pay at any Trade Org warehouse to buy it off; null when it can't. */
  price: number | null
}

/** A directive as admins see it, with who gave it and how far its goals have come. */
export interface AdminDirectiveView extends DirectiveView {
  givenBy: string
  goals: DirectiveGoal[]
  soldiersKilled: number
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
    goals: d.goals.map((g): DirectiveGoalView =>
      g.kind === 'city'
        ? { kind: 'city', city: g.city }
        : {
            kind: 'soldiers',
            count: g.count,
            ...(g.percent === undefined ? {} : { percent: g.percent }),
          },
    ),
    price: d.price,
  }))
}

/** A directive's goal in words, for the admin panel and Players. */
export function describeGoal(goal: DirectiveGoalView): string {
  if (goal.kind === 'city') return `${goal.city} destroyed`
  const soldiers = `${goal.count} soldier${goal.count === 1 ? '' : 's'}`
  return goal.percent === undefined
    ? `${soldiers} killed`
    : `${goal.percent}% of its soldiers killed (${soldiers})`
}
