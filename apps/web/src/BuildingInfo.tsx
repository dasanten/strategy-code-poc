import { useState } from 'react'
import type { Building, BuildingKind, ResourceKind } from '@csp/shared'
import { buildingInfoLines } from './building-info-view.js'
import { BUILDING_NAMES } from './map/palette.js'
import { GOOD_LABELS, SKILL_LABELS } from './Residents.js'

/** Where the browser remembers whether the Player left the ⓘ open. */
const OPEN_KEY = 'csp.buildingInfoOpen'

function remembered(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function remember(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  } catch {
    // Without storage it just isn't remembered.
  }
}

/**
 * The ⓘ on a building's card: collapsed by default, it opens to say what the kind of building
 * is for (`buildingInfoLines`). Whether it was left open is remembered in the browser. `node` is
 * the node a node's workplace stands on, if known; `site` a construction site of the kind.
 */
export function BuildingInfo({
  kind,
  node,
  site,
}: {
  kind: BuildingKind
  node?: ResourceKind
  site?: Building
}) {
  const [open, setOpen] = useState(remembered)
  const lines = open
    ? buildingInfoLines(kind, { goods: GOOD_LABELS, skills: SKILL_LABELS }, { node, site })
    : []
  return (
    <div className="sel-info">
      <button
        type="button"
        className="sel-info-toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
          remember(!open)
        }}
      >
        <span aria-hidden="true">ⓘ</span> About the {BUILDING_NAMES[kind].toLowerCase()}
        <span className="sel-more" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <ul className="sel-facts" aria-label={`About the ${BUILDING_NAMES[kind].toLowerCase()}`}>
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
