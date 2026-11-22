import { useEffect, useState } from 'react'
import type { AdminInspectTarget, AdminInspection } from '@csp/shared-types'
import { api, ApiFailure } from './api.js'
import { ADMIN_MAP_REFRESH_MS } from './admin-map.js'
import { inspectorCard } from './admin-inspector.js'
import { relationshipClass, type Relationship } from './theme.js'

/** The card's mark in the theme's colour for the kind of Organization holding it. */
const ORG_TONE: Record<NonNullable<AdminInspection['org']>['is'], Relationship> = {
  realm: 'otherRealm',
  city: 'npcCity',
  tradeOrg: 'tradeOrg',
}

/**
 * The admin map's inspector (`CONTEXT.md`: admin map): a panel docked top right over the map,
 * without actions. It loads what is inspected again every few seconds; names on it inspect
 * those instead. Anything held by a realm or NPC city offers to give a directive against it.
 */
export function AdminInspector({
  target,
  onInspect,
  onClose,
  onDirective,
}: {
  target: AdminInspectTarget
  onInspect: (target: AdminInspectTarget) => void
  onClose: () => void
  onDirective: (org: string) => void
}) {
  const [shown, setShown] = useState<{ for: AdminInspectTarget; ins: AdminInspection }>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let live = true
    const load = () =>
      api.adminInspect(target).then(
        (ins) => {
          if (!live) return
          setShown({ for: target, ins })
          setError(undefined)
        },
        (err: unknown) => {
          if (live) setError(err instanceof ApiFailure ? err.message : 'Something went wrong.')
        },
      )
    void load()
    const timer = setInterval(load, ADMIN_MAP_REFRESH_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [target])

  const ins = shown?.for === target ? shown.ins : undefined
  const card = ins && inspectorCard(ins)
  const tone = ins?.org ? relationshipClass(ORG_TONE[ins.org.is]) : ''
  return (
    <section className={`pn admin-inspector ${tone}`} aria-label="Inspector">
      <div className="hd">
        {tone && <span className="dot" aria-hidden="true" />}
        <h2 className="grow">{card?.title ?? (error ? 'Not there' : 'Loading…')}</h2>
        {card?.badge && <span className="chip d">{card.badge}</span>}
        <button
          type="button"
          className="btn sm sq"
          aria-label="Close the inspector"
          onClick={onClose}
        >
          <span className="ic s16 i-x" aria-hidden="true" />
        </button>
      </div>
      {(card || error) && (
        <div className="sec">
          {card ? <span className="b">{card.owner}</span> : <p className="error">{error}</p>}
          {card && (
            <table className="tb admin-inspector-rows">
              <tbody>
                {card.rows.map((row) => (
                  <tr key={row.label}>
                    <td className="lb">{row.label}</td>
                    <td>
                      {row.text}
                      {row.links?.map((l, i) => (
                        <span key={`${l.target.kind}-${l.target.id}`}>
                          {i > 0 && ', '}
                          <button
                            type="button"
                            className="admin-link"
                            onClick={() => onInspect(l.target)}
                          >
                            {l.name}
                          </button>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {card?.directive && (
            <button
              type="button"
              className="btn dng"
              onClick={() => onDirective(card.directive!.org)}
            >
              Give directive against {card.directive.name}…
            </button>
          )}
        </div>
      )}
    </section>
  )
}
