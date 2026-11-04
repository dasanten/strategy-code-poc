import { createContext, useContext } from 'react'
import type { OrderRequest } from '@csp/shared'

/**
 * The Customise button beside an order (`CONTEXT.md`: Before it starts): it gives the order the
 * way the order's own button does, but with the form before it starts. What it needs of the game
 * comes through context, as the orders sit deep in the cards; with none, it shows nothing.
 */
export interface Customising {
  /** Whether the order's script has params to show (`canCustomise`). */
  can: (order: OrderRequest) => boolean
  /** Runs what the order's own button runs, so that the order it gives opens the form. */
  give: (give: () => void) => void
}

export const CustomiseContext = createContext<Customising | undefined>(undefined)

/** A task's order as far as Customise needs it: which script it starts. */
export const taskStart = (task: string, workplaceId?: string): OrderRequest => ({
  kind: 'task',
  task,
  ...(workplaceId === undefined ? {} : { workplaceId }),
})

export function CustomiseButton({
  order,
  of,
  give,
  disabled,
}: {
  /** The order as far as it names the script it starts, to tell if there is anything to show. */
  order: OrderRequest
  /** What it customises, for the button's accessible name. */
  of: string
  /** What the order's own button runs. */
  give: () => void
  disabled?: boolean
}) {
  const customising = useContext(CustomiseContext)
  if (!customising?.can(order)) return null
  return (
    <button
      type="button"
      className="customise"
      aria-label={`Customise ${of}`}
      disabled={disabled}
      onClick={() => customising.give(give)}
    >
      Customise
    </button>
  )
}
