import { NPC_JOB_MARGIN, NPC_JOB_SCORE } from '@csp/shared'

/*
 * What an NPC city's jobs are worth (`CONTEXT.md`: NPC city; ADR 0029). Its planning pass says what
 * a free adult could do, as far as it knows, and these say what each is worth, so each goes to the
 * highest-scoring job with room (`shareOut`). Pure, with the numbers in `balance.ts`.
 */

/** A job as the pass knows it. */
export type ScoredJob =
  /** Farming: while Food runs short for a worker off the farms, else while it lacks farmers. */
  | { kind: 'farm'; foodShort?: boolean }
  /** Revivers aren't weighed (ADR 0029); this is where their turn comes among the jobs that are. */
  | { kind: 'revive' }
  /** Building the city's project. */
  | { kind: 'project' }
  /** Making a good short of its reserve; `share` is how much of what it wants it lacks, 0 to 1. */
  | { kind: 'short'; share: number }
  /** The road crew. */
  | { kind: 'road' }
  /** Scouting. */
  | { kind: 'scout' }
  /** Going back to the workplace they were let go from. */
  | { kind: 'back' }
  /** Working for surplus; `full` is how full its good's cap is, below 1, below 0 under its reserve. */
  | { kind: 'surplus'; full: number }

/** What a job is worth now. */
export function jobScore(job: ScoredJob): number {
  const s = NPC_JOB_SCORE
  switch (job.kind) {
    case 'farm':
      return job.foodShort ? s.farmFoodShort : s.farm
    case 'revive':
      return s.revive
    case 'project':
      return s.project
    case 'short':
      return s.short + s.shortRange * job.share
    case 'road':
      return s.road
    case 'scout':
      return s.scout
    case 'back':
      return s.back
    case 'surplus': {
      // However far below its cap, it stays inside its range, and further below always scores more.
      const below = 1 - job.full
      return s.surplus + s.surplusRange * (below / (1 + below))
    }
  }
}

/** Jobs, the highest-scoring first; equal ones stay in the order given. */
export function rankJobs<T extends { job: ScoredJob }>(offers: readonly T[]): T[] {
  return offers
    .map((offer) => ({ offer, score: jobScore(offer.job) }))
    .sort((a, b) => b.score - a.score)
    .map(({ offer }) => offer)
}

/** Whether a job is worth a worker leaving one that scores `held`: by more than the margin. */
export function beats(score: number, held: number): boolean {
  return score > held + NPC_JOB_MARGIN
}
