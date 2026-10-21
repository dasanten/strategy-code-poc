// PROTOTYPE (T17.1, #203): throwaway. Direction B, "Painted tabletop": a board game on a table;
// big resource chips, a dock of wooden buttons along the bottom, a tray that slides up, and a large
// piece card with chunky action buttons.
import { useState } from 'react'
import { BOARD } from './map-styles.js'
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

export const name = 'Painted tabletop'

export function VariantTabletop() {
  const m = useMap(BOARD)
  const [tool, setTool] = useState<Tool>()
  const card = describe(m.sel)
  const rel = card?.rel ? BOARD.rel[card.rel] : '#fff8e6'
  return (
    <div className="pb">
      <canvas ref={m.canvasRef} className="proto-map" />
      <div className="pb-chips">
        {GOODS.map((g) => (
          <div key={g.name} className="pb-chip" title={g.name}>
            <span className="pb-chip-icon">
              <Glyph name={g.glyph} color="#2a1d12" size={22} stroke={2.6} />
            </span>
            <b>{g.amount}</b>
          </div>
        ))}
      </div>
      <div className="pb-realm">
        <div className="pb-plank">{REALM}</div>
        <div className="pb-clock">
          <span>{CLOCK}</span>
        </div>
      </div>
      <div className="pb-zoom">
        <button onClick={() => m.zoomBy(1.4)}>+</button>
        <button onClick={() => m.zoomBy(1 / 1.4)}>−</button>
        <small>{tierHint(m.tier)}</small>
      </div>
      {tool && (
        <section className={`pb-tray ${tool === 'Scripts' ? 'wide' : ''}`}>
          <h2>
            <Glyph
              name={TOOLS.find((t) => t.name === tool)!.glyph}
              color="#fff6e0"
              size={24}
              stroke={2.6}
            />{' '}
            {tool}
          </h2>
          {tool === 'Scripts' && <pre className="pb-script">{SCRIPT_SAMPLE}</pre>}
          <div className="pb-rows">
            {drawerRows(tool).map(([a, b]) => (
              <div key={a} className="pb-row">
                <b>{a}</b>
                <span>{b}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <nav className="pb-dock">
        {TOOLS.map((t) => (
          <button
            key={t.name}
            className={tool === t.name ? 'on' : ''}
            onClick={() => setTool(tool === t.name ? undefined : t.name)}
            title={t.name}
          >
            <Glyph name={t.glyph} color="#2a1d12" size={28} stroke={2.6} />
            <span>{t.name}</span>
          </button>
        ))}
      </nav>
      {card && (
        <aside className="pb-card">
          <div className="pb-portrait" style={{ background: rel }}>
            <Glyph name={card.glyph} color="#2a1d12" size={54} stroke={2.4} />
          </div>
          <div className="pb-card-body">
            <h3>{card.title}</h3>
            {card.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
            <div className="pb-actions">
              {card.actions.map((a, i) => (
                <button
                  key={a}
                  className={i === 0 ? 'go' : ''}
                  onClick={() => a === 'Zoom in' && m.zoomTo('middle')}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}
