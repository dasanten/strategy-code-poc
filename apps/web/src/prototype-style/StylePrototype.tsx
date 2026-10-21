// PROTOTYPE (T17.1, #203): throwaway, never merged. Three style directions for the game UI
// (ADR 0008), switchable with ?variant=A|B|C|D, the bottom bar or ← →. Dev builds only, at
// /prototype/style. D is Daniel's pick: B's terrain with everything else from C.
import { useEffect, useState } from 'react'
import { MIXED } from './map-styles.js'
import * as A from './VariantAtlas.js'
import * as B from './VariantTabletop.js'
import * as C from './VariantCommand.js'
import './prototype.css'

const VARIANTS = [
  { key: 'A', name: A.name, View: A.VariantAtlas },
  { key: 'B', name: B.name, View: B.VariantTabletop },
  { key: 'C', name: C.name, View: C.VariantCommand },
  { key: 'D', name: 'Pick: B terrain + C', View: () => <C.VariantCommand style={MIXED} /> },
]

export const PROTOTYPE_PATH = '/prototype/style'

const FONTS =
  'https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=Fredoka:wght@400;600;700&family=Inter:wght@400;600;700&display=swap'

export function StylePrototype() {
  const [key, setKey] = useState(() => new URLSearchParams(location.search).get('variant') ?? 'A')
  const i = Math.max(
    0,
    VARIANTS.findIndex((v) => v.key === key),
  )
  const v = VARIANTS[i]!

  useEffect(() => {
    if (document.querySelector(`link[href="${FONTS}"]`)) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = FONTS
    document.head.appendChild(link)
  }, [])

  const go = (d: number) => {
    const next = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length]!
    const url = new URL(location.href)
    url.searchParams.set('variant', next.key)
    history.replaceState(null, '', url)
    setKey(next.key)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el as HTMLElement)?.isContentEditable
      )
        return
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="proto">
      <v.View key={v.key} />
      <div className="proto-switcher">
        <button onClick={() => go(-1)}>←</button>
        <span>
          {v.key} — {v.name}
        </span>
        <button onClick={() => go(1)}>→</button>
      </div>
    </div>
  )
}
