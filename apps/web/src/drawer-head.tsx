import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Inside a drawer, where its head shows a panel's count or state: the spot right of the drawer's
 * title, null until it is mounted. Undefined outside a drawer.
 */
export const DrawerStatus = createContext<HTMLElement | null | undefined>(undefined)

/**
 * A panel's head: its title, and its count or state on the right ("none", "8 in sight"). In a
 * drawer the drawer's title already says what the panel is, so the title is left out and the
 * count shows right of the drawer's title instead of a second head under it.
 */
export function PanelHead({ title, children }: { title: string; children?: ReactNode }) {
  const slot = useContext(DrawerStatus)
  if (slot !== undefined)
    return slot && children !== undefined ? createPortal(children, slot) : null
  return (
    <div className="panel-head">
      <h2>{title}</h2>
      {children !== undefined && <span>{children}</span>}
    </div>
  )
}
