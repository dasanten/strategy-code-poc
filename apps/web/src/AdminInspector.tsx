import { useEffect, useState } from 'react'
import type { AdminInspectTarget, AdminInspection } from '@csp/shared'
import { api, ApiFailure } from './api.js'
import { ADMIN_MAP_REFRESH_MS } from './admin-map.js'
import { inspectorCard } from './admin-inspector.js'
import type { Relationship } from './theme.js'
import { SelectionCard } from './SelectionCard.js'
import './admin-inspector.css'

/** The card's edge in the theme's colour for the kind of Organization holding it. */
const ORG_TONE: Record<NonNullable<AdminInspection['org']>['is'], Relationship> = {
  realm: 'otherRealm',
  city: 'npcCity',
  tradeOrg: 'tradeOrg',
}

/**
 * The admin map's inspector (`CONTEXT.md`: admin map): docked top right like the game's selection
 * card, without actions. It loads what is inspected again every few seconds; names on it inspect
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
  return (
    <div className="admin-inspector">
      <SelectionCard
        rel={ins?.org ? ORG_TONE[ins.org.is] : undefined}
        title={card?.title ?? (error ? 'Not there' : 'Loading…')}
        badge={card?.badge}
        lines={card ? [card.owner] : error ? [error] : []}
        onClose={onClose}
      >
        {card && (
          <dl className="admin-inspector-rows">
            {card.rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>
                  {row.text}
                  {row.links?.map((l, i) => (
                    <span key={`${l.target.kind}-${l.target.id}`}>
                      {i > 0 && ', '}
                      <button type="button" className="link" onClick={() => onInspect(l.target)}>
                        {l.name}
                      </button>
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {card?.directive && (
          <button type="button" onClick={() => onDirective(card.directive!.org)}>
            Give directive against {card.directive.name}…
          </button>
        )}
      </SelectionCard>
    </div>
  )
}
