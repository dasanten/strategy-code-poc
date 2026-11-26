import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'

/** The gap, in pixels, between the map dock and what stops above it. */
const MAP_DOCK_GAP = 8

/**
 * Measures the map dock (`.map-dock`) on the screen that `ref`'s element sits in, while `on`: its
 * height, with the gap above it, goes to the screen as `--map-dock-h`, for what stops above it
 * (the dock on a desktop, the realm bar on a phone).
 */
export function useMapDockHeight(ref: RefObject<HTMLElement | null>, on = true) {
  // The map dock comes with the map, after this may have mounted, so each render looks again.
  const watching = useRef<{ el: HTMLElement; observer: ResizeObserver }>(undefined)
  useLayoutEffect(() => {
    const screen = ref.current?.parentElement
    const mapDock = (on && screen?.querySelector<HTMLElement>('.map-dock')) || undefined
    if (watching.current?.el === mapDock) return
    watching.current?.observer.disconnect()
    watching.current = undefined
    if (!screen) return
    if (!mapDock) return void screen.style.removeProperty('--map-dock-h')
    const observer = new ResizeObserver(() => {
      const tall = mapDock.offsetHeight
      screen.style.setProperty('--map-dock-h', `${tall > 0 ? tall + MAP_DOCK_GAP : 0}px`)
    })
    observer.observe(mapDock)
    watching.current = { el: mapDock, observer }
  })
  useEffect(() => {
    const screen = ref.current?.parentElement
    return () => {
      watching.current?.observer.disconnect()
      watching.current = undefined
      screen?.style.removeProperty('--map-dock-h')
    }
  }, [ref])
}

/**
 * The dock on the right of a desktop's screen (ADR 0044; `CONTEXT.md`: Screen): tile cards, the
 * who-list and realm order cards go into it (`CardSheet` with `dock`), so a tile and a resident
 * can be open together. It runs from under the top bar down to above the map dock (`.map-dock`)
 * and the command bar; empty, it lets clicks through to the map. The map dock's height, with the
 * gap above it, goes to the screen as `--map-dock-h` (`useMapDockHeight`). On a phone there is no
 * dock: the cards are the bottom sheet.
 */
export function Dock({ onMount }: { onMount: (dock: HTMLElement | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    onMount(ref.current)
    return () => onMount(null)
  }, [onMount])
  useMapDockHeight(ref)
  return <div ref={ref} className="game-dock" />
}
