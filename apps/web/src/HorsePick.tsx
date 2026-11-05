import type { SeenHorse } from '@csp/shared'
import { horseDetail } from './selection-view.js'

/**
 * One horse to tick when picking two to breed (`CONTEXT.md`: Breeding): its name, stats and age,
 * and how it fares, so two can be compared. The same row on the resident card, the group card and
 * the queue planner.
 */
export function HorsePick({
  horse,
  tick,
  checked,
  disabled,
  onToggle,
}: {
  horse: SeenHorse
  tick: number
  checked: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <label className="horse-pick small">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
      <span>
        {horse.name} · {horseDetail(horse, tick)}
      </span>
    </label>
  )
}
