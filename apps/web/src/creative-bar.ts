// The Creative bar's words (`CONTEXT.md`: Creative mode, ADR 0043): time controls for an admin
// on a server started with `CREATIVE=1`.
import type { Account, CreativeSpeed } from '@csp/shared-types'

/** The speeds in the order the bar shows them, with their labels and what they do. */
export const CREATIVE_SPEEDS: readonly { speed: CreativeSpeed; label: string; title: string }[] = [
  { speed: 'normal', label: '×1', title: 'Normal speed: one game minute a second' },
  { speed: 'x10', label: '×10', title: 'Ten game minutes a second' },
  { speed: 'x60', label: '×60', title: 'One game hour a second' },
  { speed: 'max', label: 'Max', title: 'As fast as the machine allows' },
]

/** Whether the game view shows the Creative bar: only to admins on a creative server. */
export function showsCreativeBar(account: Account): boolean {
  return account.isAdmin && account.creative === true
}

/** The bar's line on how the world runs: paused, or at what speed. */
export function creativeRunning(paused: boolean, speed: CreativeSpeed): string {
  if (paused) return 'Paused'
  const shown = CREATIVE_SPEEDS.find((s) => s.speed === speed)
  return speed === 'normal' ? 'Running' : `Running ${shown?.label ?? speed}`
}
