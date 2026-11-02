import { describe, expect, it } from 'vitest'
import { tileToScreen } from './camera.js'
import { PIN_HEIGHT, PIN_RADIUS, pinAt } from './pins.js'

const size = 200
const view = { width: 800, height: 600 }
const pass = { id: 'wp1', name: 'Pass', x: 50, y: 50 }
const ford = { id: 'wp2', name: 'Ford', x: 51, y: 50 }

describe('pinAt', () => {
  // Far out a tile is a pixel or two across, so the pin's head stands over other tiles.
  const cam = { x: 50, y: 50, scale: 2 }
  const [px, py] = tileToScreen(cam, view, size, 50.5, 50.5)

  it('finds the waypoint whose pin head or stem a click falls on', () => {
    expect(pinAt([pass], cam, view, size, px + 2, py - PIN_HEIGHT - 2)).toBe(pass)
    expect(pinAt([pass], cam, view, size, px, py - 4)).toBe(pass)
    expect(pinAt([pass], cam, view, size, px, py)).toBe(pass)
  })

  it('finds none beside the pin or under its point', () => {
    expect(pinAt([pass], cam, view, size, px + PIN_RADIUS + 6, py - PIN_HEIGHT)).toBeUndefined()
    expect(pinAt([pass], cam, view, size, px, py + 6)).toBeUndefined()
    expect(pinAt([], cam, view, size, px, py)).toBeUndefined()
  })

  it('picks the nearest head where pins overlap', () => {
    const [fx] = tileToScreen(cam, view, size, 51.5, 50.5)
    expect(pinAt([pass, ford], cam, view, size, fx + 1, py - PIN_HEIGHT)).toBe(ford)
    expect(pinAt([pass, ford], cam, view, size, px - 1, py - PIN_HEIGHT)).toBe(pass)
  })
})
