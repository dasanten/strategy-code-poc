import { useEffect, useRef, useState } from 'react'
import { BUILD_MATERIALS } from './shared/narrowed.js'
import { BUILDING_PURPOSE } from './shared/building-info.js'
import { buildingWork, workFactor } from './shared/building.js'
import type { BuildingKind, ResourceNode } from '@csp/shared-types'
import { buildMenuGroups, canChooseKind, workSpan, type BuildMenuKind } from './build-menu-view.js'
import { CustomiseButton, taskStart } from './Customise.js'
import { goodsItems } from './goods-grid.js'
import { GoodsGrid } from './GoodsGrid.js'
import { ART_FILES, BUILDING_ART } from './map/art.js'

/**
 * A kind's icon, the registry's own SVG source stroked in the colour of the text around it, less
 * its `<title>`: on hover that would win over the cell's own title, which says why it's dimmed.
 */
function BuildingIcon({ kind }: { kind: BuildingKind }) {
  const svg = (ART_FILES[BUILDING_ART[kind]] ?? '')
    .replace('color="#fff"', '')
    .replace(/<title>.*?<\/title>/, '')
  return (
    <span className="build-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
  )
}

/** What the tapped kind is for, what it costs and Build; or, if it can't go here, why. */
export function KindDetail({
  item,
  terrain,
  blocked,
  planning,
  onBuild,
}: {
  item: BuildMenuKind
  terrain?: number
  blocked: boolean
  planning: boolean
  onBuild: (kind: BuildingKind) => void
}) {
  const { kind, name, problem } = item
  const ref = useRef<HTMLDivElement>(null)
  // On a phone the grid can fill the sheet, so the detail under it might open out of sight.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [kind])
  return (
    <div className="build-detail" ref={ref}>
      <h4>{name}</h4>
      {problem && (
        <p className="build-why small">
          Not here{planning && item.offered ? ' as it stands' : ''}: {problem}.
          {planning && item.offered && ' Checked again when the step’s turn comes.'}
        </p>
      )}
      <p className="muted small">{BUILDING_PURPOSE[kind]}</p>
      <div className="build-cost">
        <GoodsGrid
          label="Materials"
          items={goodsItems(BUILD_MATERIALS[kind])}
          empty="No materials"
        />
        <span className="small muted">
          about {workSpan(buildingWork(kind, terrain))} of work
          {workFactor(kind, terrain) > 1 && ' here on Mountain'}
        </span>
      </div>
      {canChooseKind(item, planning) && (
        <div className="order-buttons">
          <button
            type="button"
            className="primary"
            disabled={blocked}
            onClick={() => onBuild(kind)}
          >
            {planning ? 'Add: build' : 'Build'} {name.toLowerCase()}
          </button>
          <CustomiseButton
            order={taskStart('build')}
            of={`Build ${name.toLowerCase()}`}
            disabled={blocked}
            give={() => onBuild(kind)}
          />
        </div>
      )}
    </div>
  )
}

/**
 * The Build menu (`CONTEXT.md`: Build menu), the same on a resident's card, a group card and the
 * planner, each in its own block: every buildable kind as an icon and short name under its group.
 * Tapping one opens what it is for and what it costs, and Build, under the grid so the icons stay
 * where they are while the Player looks through them. A kind that can't go here is dimmed, and
 * tapping it says why.
 */
export function BuildMenu({
  node,
  terrain,
  buildProblem,
  blocked = false,
  planning = false,
  onBuild,
}: {
  /** The resource node on this tile, if the Player knows one. */
  node: Pick<ResourceNode, 'kind'> | undefined
  /** The explored terrain beneath this tile, if known (`buildingWork`). */
  terrain?: number
  /** Why a kind can't be laid out on this tile, as far as the Player knows. */
  buildProblem: (kind: BuildingKind) => string | undefined
  /** Whoever would build can't right now, so Build is off whatever the tile allows. */
  blocked?: boolean
  /** For the planner: the kind is added as a step, whose turn checks it (`canChooseKind`). */
  planning?: boolean
  onBuild: (kind: BuildingKind) => void
}) {
  const [open, setOpen] = useState<BuildingKind | undefined>()
  const groups = buildMenuGroups(node, buildProblem)
  const item = groups.flatMap((g) => g.kinds).find((k) => k.kind === open)
  return (
    <>
      <div className="build-groups">
        {groups.map((group) => (
          <div className="build-group" key={group.name}>
            <h4>{group.name}</h4>
            <div className="build-grid">
              {group.kinds.map(({ kind, name, problem }) => (
                <button
                  type="button"
                  key={kind}
                  className={`build-kind${problem ? ' dimmed' : ''}`}
                  aria-pressed={open === kind}
                  title={problem ? `Not here: ${problem}.` : undefined}
                  onClick={() => setOpen(open === kind ? undefined : kind)}
                >
                  <BuildingIcon kind={kind} />
                  <span className="build-name">{name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {item && (
        <KindDetail
          item={item}
          terrain={terrain}
          blocked={blocked}
          planning={planning}
          onBuild={onBuild}
        />
      )}
    </>
  )
}
