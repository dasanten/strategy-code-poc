import { describe, expect, it } from 'vitest'
import { ADMIN_PATH, adminTabFor, adminTabPath, pageFor } from './pages.js'

const player = { name: 'Mara', isAdmin: false }
const admin = { name: 'Daniel', isAdmin: true }

describe('pages', () => {
  it('asks everyone to log in first', () => {
    expect(pageFor('/', null)).toBe('login')
    expect(pageFor(ADMIN_PATH, null)).toBe('login')
    expect(pageFor('/admin/map', null)).toBe('login')
  })

  it('shows admins the game like anyone else, and the admin panel only on its own page', () => {
    expect(pageFor('/', admin)).toBe('game')
    expect(pageFor(ADMIN_PATH, admin)).toBe('admin')
    expect(pageFor(`${ADMIN_PATH}/`, admin)).toBe('admin')
    expect(pageFor('/admin/map', admin)).toBe('admin')
    expect(pageFor('/admin/directives', admin)).toBe('admin')
    // A path that only starts like the admin panel is the game's.
    expect(pageFor('/administrator', admin)).toBe('game')
    expect(pageFor('/', player)).toBe('game')
  })

  it('keeps Players out of the admin panel and its map', () => {
    expect(pageFor(ADMIN_PATH, player)).toBe('not-admin')
    expect(pageFor('/admin/map', player)).toBe('not-admin')
  })
})

describe('admin tabs', () => {
  it('opens each tab at its own path, and the map for the panel itself', () => {
    expect(adminTabFor(ADMIN_PATH)).toBe('map')
    expect(adminTabFor('/admin/map')).toBe('map')
    expect(adminTabFor('/admin/accounts/')).toBe('accounts')
    expect(adminTabFor('/admin/directives')).toBe('directives')
    expect(adminTabFor('/admin/nothing')).toBe('map')
    expect(adminTabPath('directives')).toBe('/admin/directives')
  })
})
