import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BUILD_GROUPS, BUILDING_PURPOSE } from './building-info.js'
import { buildingWork, materialsOfKind, workFactor } from '@csp/lang-wasm'
import type { BuildingKind, ResourceNode, WallMaterial } from '@csp/shared-types'
import {
  buildMenuGroups,
  buildingSprite,
  canChooseKind,
  workSpan,
  type BuildMenuKind,
  type BuildingSprite,
} from './build-menu-view.js'
import { PanelFoot } from './CommandBar.js'
import { CustomiseButton, taskStart } from './Customise.js'
import { goodsItems } from './goods-grid.js'
import { GoodsGrid } from './GoodsGrid.js'
import { ART_FILES, BUILDING_ART, PAINTED_BUILDING_IMAGE, PAINTED_FILES } from './map/art.js'
import { PIXEL_FILES, isDrawn, pixelArt } from './map/pixel-art.js'
import { PIXEL_SLICES } from './map/pixel-slices.js'

/**
 * Which of the Build menu's pixel sprites have something drawn in them, by atlas key
 * (`pixelArt`): a slice still empty on its sheet isn't shown (`docs/art.md`: Pixel art). Read
 * from the sheets once, the first time a menu opens; undefined until then.
 */
let drawnSprites: ReadonlySet<string> | undefined
let loadingSprites = false
const spriteListeners = new Set<() => void>()

/** Every sprite the menu can show: each kind, and a tower, wall or gate of stone too. */
const menuSprites = (): BuildingSprite[] =>
  BUILD_GROUPS.flatMap((g) => g.kinds)
    .flatMap((k) => [buildingSprite(k), buildingSprite(k, 'stone')])
    .filter((s): s is BuildingSprite => s !== undefined)

/** A sheet's pixels, to tell which of its slices are drawn; undefined if it can't be read. */
async function sheetPixels(sheet: BuildingSprite['sheet']) {
  const url = PIXEL_FILES[`${sheet}.png`]
  if (!url) return undefined
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return undefined
  ctx.drawImage(img, 0, 0)
  return { pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width }
}

function loadDrawnSprites() {
  if (loadingSprites || typeof document === 'undefined') return
  loadingSprites = true
  const sprites = menuSprites()
  const sheets = [...new Set(sprites.map((s) => s.sheet))]
  void Promise.all(sheets.map((s) => sheetPixels(s).catch(() => undefined)))
    .then((read) => {
      const drawn = new Set<string>()
      for (const s of sprites) {
        const art = read[sheets.indexOf(s.sheet)]
        if (art && isDrawn(art.pixels, art.width, s.rect)) drawn.add(pixelArt(s.sheet, s.slice))
      }
      return drawn
    })
    .catch(() => new Set<string>())
    .then((drawn) => {
      drawnSprites = drawn
      spriteListeners.forEach((l) => l())
    })
}

function onDrawnSprites(listener: () => void) {
  spriteListeners.add(listener)
  loadDrawnSprites()
  return () => spriteListeners.delete(listener)
}

const drawnNow = () => drawnSprites

/**
 * A kind's icon in the Build menu: its pixel sprite (`buildingSprite`) where the sheet has it
 * drawn, else its painted image where it has one of its own, else the registry's line art in
 * the colour of the text around it, less its `<title>`: on hover that would win over the
 * cell's own title, which says why it's dimmed.
 */
export function BuildingIcon({ kind, material }: { kind: BuildingKind; material?: WallMaterial }) {
  const drawn = useSyncExternalStore(onDrawnSprites, drawnNow, drawnNow)
  const sprite = buildingSprite(kind, material)
  if (sprite && drawn?.has(pixelArt(sprite.sheet, sprite.slice))) {
    // The sheet, with only this kind's slice in view.
    const [width, height] = PIXEL_SLICES[sprite.sheet].size
    return (
      <span className="build-icon build-icon-pixel" aria-hidden="true">
        <svg viewBox={sprite.rect.join(' ')}>
          <image href={PIXEL_FILES[`${sprite.sheet}.png`]} width={width} height={height} />
        </svg>
      </span>
    )
  }
  const painted = PAINTED_BUILDING_IMAGE[kind]
  const paintedUrl = painted && PAINTED_FILES[painted]
  if (paintedUrl) {
    return (
      <span className="build-icon build-icon-painted" aria-hidden="true">
        <img src={paintedUrl} alt="" />
      </span>
    )
  }
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
  problemOf,
}: {
  item: BuildMenuKind
  terrain?: number
  blocked: boolean
  planning: boolean
  onBuild: (kind: BuildingKind, material?: WallMaterial) => void
  /** Why it can't go here of a material: a stone wall may go on a wooden one (`buildProblem`). */
  problemOf?: (kind: BuildingKind, material?: WallMaterial) => string | undefined
}) {
  const { kind, name } = item
  const ref = useRef<HTMLDivElement>(null)
  // A wall or gate is of wood or stone (`CONTEXT.md`: Wood or stone): wood unless picked.
  const [material, setMaterial] = useState<WallMaterial>('wood')
  const ofMaterial = kind === 'wall' || kind === 'gate' || kind === 'tower'
  const picked = ofMaterial ? material : undefined
  const problem = picked === 'stone' && problemOf ? problemOf(kind, 'stone') : item.problem
  const label = picked === 'stone' ? `stone ${name.toLowerCase()}` : name.toLowerCase()
  const build = () => onBuild(kind, picked === 'stone' ? 'stone' : undefined)
  // On a phone the grid can fill the sheet, so the detail under it might open out of sight.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [kind])
  return (
    <div className="build-detail" ref={ref}>
      <div className="build-detail-head">
        <BuildingIcon kind={kind} material={picked} />
        <h4 className="px t16">{name}</h4>
      </div>
      {problem && (
        <p className="build-why bad small">
          Not here{planning && item.offered ? ' as it stands' : ''}: {problem}.
          {planning && item.offered && ' Checked again when the step’s turn comes.'}
        </p>
      )}
      <p className="mu small">{BUILDING_PURPOSE[kind]}</p>
      {ofMaterial && (
        <div className="material-pick build-material" role="group" aria-label="Built of">
          <span className="lb">Built of</span>
          {(['wood', 'stone'] as const).map((m) => (
            <button
              type="button"
              className="btn sm"
              key={m}
              aria-pressed={material === m}
              onClick={() => setMaterial(m)}
            >
              {m === 'wood' ? 'Wood' : 'Stone'}
            </button>
          ))}
        </div>
      )}
      <div className="build-cost">
        <GoodsGrid
          label="Materials"
          items={goodsItems(materialsOfKind(kind, picked))}
          empty="No materials"
        />
        <span className="small">
          about {workSpan(buildingWork(kind, terrain, picked))} of work
          {workFactor(kind, terrain) > 1 && ' here on Mountain'}
        </span>
      </div>
      {canChooseKind({ ...item, problem }, planning) && (
        <PanelFoot>
          <button type="button" className="primary" disabled={blocked} onClick={build}>
            {planning ? 'Add: build' : 'Build'} {label}
          </button>
          <CustomiseButton
            order={taskStart('build')}
            of={`Build ${label}`}
            disabled={blocked}
            give={build}
          />
        </PanelFoot>
      )}
    </div>
  )
}

/**
 * The Build menu (`CONTEXT.md`: Build menu), the same on a resident's card, a group card and the
 * planner, each in its own block: every buildable kind as its pixel sprite and short name under
 * its group. Tapping one opens what it is for and what it costs, and Build, under the grid so the
 * sprites stay where they are while the Player looks through them. A kind that can't go here is
 * dimmed, and tapping it says why.
 */
export function BuildMenu({
  node,
  terrain,
  buildProblem,
  blocked = false,
  planning = false,
  anywhere = false,
  onBuild,
}: {
  /** The resource node on this tile, if the Player knows one. */
  node: Pick<ResourceNode, 'kind'> | undefined
  /** The explored terrain beneath this tile, if known (`buildingWork`). */
  terrain?: number
  /** Why a kind can't be laid out on this tile, as far as the Player knows. */
  buildProblem: (kind: BuildingKind, material?: WallMaterial) => string | undefined
  /** Whoever would build can't right now, so Build is off whatever the tile allows. */
  blocked?: boolean
  /** For the planner: the kind is added as a step, whose turn checks it (`canChooseKind`). */
  planning?: boolean
  /** No tile picked yet (realm control mode): every kind is offered, judged once it is picked. */
  anywhere?: boolean
  onBuild: (kind: BuildingKind, material?: WallMaterial) => void
}) {
  const [open, setOpen] = useState<BuildingKind | undefined>()
  const groups = buildMenuGroups(node, buildProblem, anywhere)
  const item = groups.flatMap((g) => g.kinds).find((k) => k.kind === open)
  return (
    <>
      <div className="build-groups">
        {groups.map((group) => (
          <div className="build-group" key={group.name}>
            <h4 className="lb">{group.name}</h4>
            <div className="build-grid">
              {group.kinds.map(({ kind, name, problem }) => (
                <button
                  type="button"
                  key={kind}
                  className={`btn sm build-kind${problem ? ' dimmed' : ''}`}
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
          problemOf={buildProblem}
        />
      )}
    </>
  )
}
