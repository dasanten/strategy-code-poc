// PROTOTYPE (T17.1, #203): throwaway. Direction C, "Command table": modern strategy chrome; a thin
// top bar, an icon rail with a drawer over the map, a docked inspector and a minimap.
import { useEffect, useRef, useState } from 'react'
import { MODERN, type MapStyle } from './map-styles.js'
import {
  CLOCK,
  GOODS,
  Glyph,
  REALM,
  SCRIPT_SAMPLE,
  TOOLS,
  describe,
  drawerRows,
  scene,
  tierHint,
  useMap,
  type Tool,
} from './shared.js'
import { terrainTexture } from './render.js'

export const name = 'Command table'

export function VariantCommand({ style = MODERN }: { style?: MapStyle }) {
  const m = useMap(style)
  const [tool, setTool] = useState<Tool>()
  const card = describe(m.sel)
  const mini = useRef<HTMLCanvasElement>(null)
  const tex = useRef<HTMLCanvasElement>(undefined)

  useEffect(() => {
    const c = mini.current!
    const ctx = c.getContext('2d')!
    tex.current ??= terrainTexture(scene, style)
    const k = c.width / scene.map.size
    ctx.drawImage(tex.current, 0, 0, c.width, c.height)
    for (const city of scene.cities) {
      ctx.fillStyle = style.rel[city.rel]
      ctx.fillRect(city.x * k - 2.5, city.y * k - 2.5, 5, 5)
    }
    const w = window.innerWidth / m.cam.s
    const h = window.innerHeight / m.cam.s
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1.5
    ctx.strokeRect((m.cam.x - w / 2) * k, (m.cam.y - h / 2) * k, w * k, h * k)
  })

  const white = '#e8eef4'
  return (
    <div className="pc">
      <canvas ref={m.canvasRef} className="proto-map" />
      <header className="pc-top">
        <b>{REALM}</b>
        <span className="pc-sep" />
        <span>{CLOCK}</span>
        <span className="pc-live">● live</span>
        <span className="pc-grow" />
        {GOODS.map((g) => (
          <span key={g.name} className="pc-good" title={g.name}>
            <Glyph name={g.glyph} color={white} size={15} /> {g.amount}
          </span>
        ))}
        <span className="pc-sep" />
        <span className="pc-leader">
          <Glyph name="crown" color={style.rel.own} size={15} /> Ada
        </span>
      </header>
      <nav className="pc-rail">
        {TOOLS.map((t) => (
          <button
            key={t.name}
            className={tool === t.name ? 'on' : ''}
            onClick={() => setTool(tool === t.name ? undefined : t.name)}
            data-tip={t.name}
          >
            <Glyph name={t.glyph} color={tool === t.name ? '#0e1419' : white} size={20} />
          </button>
        ))}
      </nav>
      {tool && (
        <section className={`pc-drawer ${tool === 'Scripts' ? 'wide' : ''}`}>
          <h2>
            {tool}
            <button onClick={() => setTool(undefined)}>✕</button>
          </h2>
          {tool === 'Scripts' && <pre className="pc-script">{SCRIPT_SAMPLE}</pre>}
          <table>
            <tbody>
              {drawerRows(tool).map(([a, b]) => (
                <tr key={a}>
                  <td>{a}</td>
                  <td>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {card && (
        <aside className="pc-inspector">
          <div
            className="pc-insp-head"
            style={{ borderColor: card.rel ? style.rel[card.rel] : '#555' }}
          >
            <Glyph name={card.glyph} color={card.rel ? style.rel[card.rel] : white} size={30} />
            <div>
              <h3>{card.title}</h3>
              <p>{card.lines[0]}</p>
            </div>
          </div>
          {card.lines.slice(1).map((l) => (
            <p key={l} className="pc-line">
              {l}
            </p>
          ))}
          <div className="pc-actions">
            {card.actions.map((a, i) => (
              <button key={a} onClick={() => a === 'Zoom in' && m.zoomTo('middle')}>
                <kbd>{'QWER'[i]}</kbd> {a}
              </button>
            ))}
          </div>
        </aside>
      )}
      <div className="pc-corner">
        <div className="pc-tiers">
          {(['far', 'middle', 'close'] as const).map((t) => (
            <button key={t} className={m.tier === t ? 'on' : ''} onClick={() => m.zoomTo(t)}>
              {t}
            </button>
          ))}
        </div>
        <canvas
          ref={mini}
          width={180}
          height={180}
          className="pc-mini"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const k = scene.map.size / r.width
            m.setCam((c) => ({ ...c, x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }))
          }}
        />
        <small>{tierHint(m.tier)}</small>
      </div>
    </div>
  )
}
