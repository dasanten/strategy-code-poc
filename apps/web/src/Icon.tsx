import { useSyncExternalStore } from 'react'
import placeholderUrl from './assets/ui/sprites.svg?url'
import { drawnSlices, onDrawnSlices } from './drawn-slices.js'
import { PIXEL_FILES } from './map/pixel-art.js'
import { PIXEL_SLICES } from './map/pixel-slices.js'
import {
  PLACEHOLDER_CELL,
  PLACEHOLDER_COLUMNS,
  PLACEHOLDER_ROWS,
  iconDrawing,
  type UiIconName,
  type UiIconSize,
} from './ui-icons.js'

/**
 * A UI icon (`ui-icons.ts`), the one way the UI draws one: its pixel slice where Daniel has drawn
 * it, else its placeholder. A kit `.ic` box of `size` px (20 unless given), the art scaled in it
 * pixel for pixel. With a `label` it is an image of that name; without, screen readers skip it.
 */
export function Icon({
  name,
  size,
  className,
  label,
}: {
  name: UiIconName
  size?: UiIconSize
  className?: string
  label?: string
}) {
  const drawn = useSyncExternalStore(onDrawnSlices, drawnSlices, drawnSlices)
  const art = iconDrawing(name, (key) => drawn?.has(key) ?? false)
  const [href, width, height] =
    art.from === 'sheet'
      ? [PIXEL_FILES[`${art.sheet}.png`], ...PIXEL_SLICES[art.sheet].size]
      : [
          placeholderUrl,
          PLACEHOLDER_COLUMNS * PLACEHOLDER_CELL,
          PLACEHOLDER_ROWS * PLACEHOLDER_CELL,
        ]
  const classes = ['ic', size && size !== 20 ? `s${size}` : '', className].filter(Boolean)
  return (
    <span
      className={classes.join(' ')}
      data-icon={name}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox={art.rect.join(' ')} aria-hidden="true">
        <image href={href} width={width} height={height} />
      </svg>
    </span>
  )
}
