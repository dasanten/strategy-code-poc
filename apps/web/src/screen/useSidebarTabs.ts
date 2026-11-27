import { useCallback } from 'react'
import { withOpen, type OpenTab } from './hud-view.js'
import { useEscapeCloses } from './Hud.js'
import { useSidebar } from './Sidebar.js'

/**
 * The sidebar's open tab and the Diplomacy tab's own tab (`useSidebar`), with a setter for the
 * open tab alone and Escape folding it.
 */
export function useSidebarTabs() {
  // The sidebar's open tab, if any (ADR 0044: one at a time), as the browser kept it.
  // The Diplomacy tab's own tab is kept with it, and stays while the sidebar is folded.
  const [sidebar, setSidebar] = useSidebar()
  const openTab = sidebar.open
  const setOpenTab = useCallback(
    (open: OpenTab | ((open: OpenTab) => OpenTab)) =>
      setSidebar((s) => withOpen(s, typeof open === 'function' ? open(s.open) : open)),
    [setSidebar],
  )
  const foldSidebar = useCallback(() => setOpenTab(undefined), [setOpenTab])
  useEscapeCloses(openTab, foldSidebar)
  return { sidebar, setSidebar, openTab, setOpenTab, foldSidebar }
}
