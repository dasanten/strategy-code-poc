import { describe, expect, it } from 'vitest'
import { ADMIN_PATH, pageFor } from './pages.js'

const player = { name: 'Mara', isAdmin: false }
const admin = { name: 'Daniel', isAdmin: true }

describe('pages', () => {
  it('asks everyone to log in first', () => {
    expect(pageFor('/', null)).toBe('login')
    expect(pageFor(ADMIN_PATH, null)).toBe('login')
  })

  it('shows admins the game like anyone else, and the admin panel only on its own page', () => {
    expect(pageFor('/', admin)).toBe('game')
    expect(pageFor(ADMIN_PATH, admin)).toBe('admin')
    expect(pageFor(`${ADMIN_PATH}/`, admin)).toBe('admin')
    expect(pageFor('/', player)).toBe('game')
  })

  it('keeps Players out of the admin panel', () => {
    expect(pageFor(ADMIN_PATH, player)).toBe('not-admin')
  })
})
