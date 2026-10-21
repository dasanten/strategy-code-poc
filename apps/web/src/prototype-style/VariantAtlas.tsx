// PROTOTYPE (T17.1, #203): throwaway. Direction A, "Parchment atlas": the map is an old chart on
// the table; the HUD is a ribbon, bookmark tabs and a pinned note.
import { useState } from 'react'
import { PARCHMENT } from './map-styles.js'
import {
  CLOCK,
  GOODS,
  Glyph,
  REALM,
  SCRIPT_SAMPLE,
  TOOLS,
  describe,
  drawerRows,
  tierHint,
  useMap,
  type Tool,
} from './shared.js'

export const name = 'Parchment atlas'

export function VariantAtlas() {
  const m = useMap(PARCHMENT)
  const [tool, setTool] = useState<Tool>()
  const card = describe(m.sel)
  const ink = '#3b2814'
  return (
    <div className="pa">
      <canvas ref={m.canvasRef} className="proto-map" />
      <div className="pa-vignette" />
      <header className="pa-ribbon">
        <div className="pa-ribbon-title">{REALM}</div>
        <div className="pa-ribbon-sub">
          {CLOCK} <span className="pa-dot">●</span> connected
        </div>
        <div className="pa-goods">
          {GOODS.map((g) => (
            <span key={g.name} title={g.name}>
              <Glyph name={g.glyph} color={ink} size={16} /> {g.amount}
            </span>
          ))}
        </div>
      </header>
      <nav className="pa-tabs">
        {TOOLS.map((t) => (
          <button
            key={t.name}
            className={tool === t.name ? 'on' : ''}
            onClick={() => setTool(tool === t.name ? undefined : t.name)}
          >
            <Glyph name={t.glyph} color={ink} size={18} />
            <span>{t.name}</span>
          </button>
        ))}
      </nav>
      {tool && (
        <section className={`pa-ledger ${tool === 'Scripts' ? 'wide' : ''}`}>
          <h2>{tool}</h2>
          {tool === 'Scripts' && <pre className="pa-script">{SCRIPT_SAMPLE}</pre>}
          <ul>
            {drawerRows(tool).map(([a, b]) => (
              <li key={a}>
                <span>{a}</span>
                <i>{b}</i>
              </li>
            ))}
          </ul>
          <button className="pa-close" onClick={() => setTool(undefined)}>
            close the ledger
          </button>
        </section>
      )}
      {card && (
        <aside className="pa-note">
          <div className="pa-pin" />
          <div className="pa-note-head">
            <Glyph name={card.glyph} color={ink} size={34} />
            <div>
              <h3>{card.title}</h3>
              {card.lines.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </div>
          </div>
          <div className="pa-actions">
            {card.actions.map((a) => (
              <button key={a} onClick={() => a === 'Zoom in' && m.zoomTo('middle')}>
                {a} ›
              </button>
            ))}
          </div>
        </aside>
      )}
      <div className="pa-scale">
        <svg viewBox="0 0 60 60" width="64" height="64" className="pa-compass">
          <g fill="none" stroke={ink} strokeWidth="1.2">
            <circle cx="30" cy="30" r="22" />
            <circle cx="30" cy="30" r="18" strokeDasharray="2 3" />
          </g>
          <path d="M30 4l5 26-5 26-5-26z" fill={ink} />
          <path d="M4 30l26-4 26 4-26 4z" fill={ink} opacity=".5" />
          <text x="30" y="3" fontSize="8" textAnchor="middle" fill={ink}>
            N
          </text>
        </svg>
        <div>
          <div className="pa-tiers">
            {(['far', 'middle', 'close'] as const).map((t) => (
              <button key={t} className={m.tier === t ? 'on' : ''} onClick={() => m.zoomTo(t)}>
                {t}
              </button>
            ))}
          </div>
          <small>{tierHint(m.tier)}</small>
        </div>
      </div>
    </div>
  )
}
