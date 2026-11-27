import { useLayoutEffect, useState } from 'react'
import { showBeside } from '../screen/hud-view.js'
import { mapCovered } from '../screen/Hud.js'
import type { Covered } from './camera.js'

/**
 * Where the map is to look: a place asked for (`showOnMap`, or `show` with a zoom), centred
 * between the open sidebar tab and the selection card once they are drawn.
 */
export function useMapFocus(foldSidebar: () => void) {
  // A place to show on the map, such as one from the realm log or a resident picked in the list:
  // asked for, then centred between the open sidebar tab and the selection card once they are drawn.
  // A place to show on the map; `zoom` picks the zoom from the one now (the zoom stays without).
  const [toShow, setToShow] = useState<{ x: number; y: number; zoom?: (scale: number) => number }>()
  const [focus, setFocus] = useState<{
    x: number
    y: number
    zoom?: (scale: number) => number
    cover: Covered
  }>()
  useLayoutEffect(() => {
    if (!toShow) return
    const covered = mapCovered()
    const shown = showBeside(window.innerWidth, covered.left, covered.right, covered.strip)
    if (shown.foldSidebar) foldSidebar()
    setFocus({ ...toShow, cover: shown })
  }, [toShow, foldSidebar])
  const showOnMap = (x: number, y: number) => setToShow({ x, y })
  return { focus, show: setToShow, showOnMap }
}
