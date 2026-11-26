import { useEffect, useState } from 'react'
import { type OpenTab } from '../screen/hud-view.js'
import { rememberedTab, rememberTab, type CardSections } from './residents-view.js'
import { type ActionId } from '../screen/selection-view.js'

/**
 * What the resident card and the Residents tab keep while other residents are picked: the
 * card's open tab and panel, and whether the list is open fully (`CONTEXT.md`: Residents list).
 */
export function useResidentPanels(openTab: OpenTab) {
  // The resident card's open tab and panel, kept here so they stay as the Player picks others;
  // the tab is also remembered in this browser (ADR 0012).
  const [cardSections, setCardSections] = useState<CardSections<ActionId>>(() => ({
    tab: rememberedTab(),
  }))
  // The Residents tab opened fully (`CONTEXT.md`: Residents list); closing it goes back.
  const [residentsFull, setResidentsFull] = useState(false)
  const fullList = residentsFull && openTab === 'residents'
  useEffect(() => {
    if (openTab !== 'residents') setResidentsFull(false)
  }, [openTab])
  /** The card's tab and panel changed: the tab is remembered in this browser too. */
  const onCardSections = (s: CardSections<ActionId>) => {
    rememberTab(s.tab)
    setCardSections(s)
  }
  return { cardSections, onCardSections, fullList, setResidentsFull }
}
