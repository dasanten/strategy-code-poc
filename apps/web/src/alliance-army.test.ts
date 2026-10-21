import type { Diplomacy } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { commandsSeen } from './alliance-army.js'

const member = (realmId: string) => ({ realmId, realm: realmId, joinedAt: 0, leavesAt: null })
const diplomacy: Diplomacy = {
  alliance: {
    id: 'alliance1',
    name: 'North',
    leaderId: 'r1',
    members: [member('r1'), member('r2')],
    invites: [],
    army: [{ is: 'resident', id: 'lent', realmId: 'r2', realm: 'r2', recallAt: null }],
  },
  invitations: [],
  realmsInSight: [],
  contracts: [],
  deliveries: [],
  standings: [],
  joinRequests: [],
}

describe('alliance army in the UI', () => {
  it('lets the alliance leader, not the owner, command what was handed over', () => {
    expect(commandsSeen(diplomacy, 'r1', { id: 'lent', owner: 'r2' })).toBe(true)
    expect(commandsSeen(diplomacy, 'r2', { id: 'lent', owner: 'r2' })).toBe(false)
    expect(commandsSeen(diplomacy, 'r2', { id: 'kept', owner: 'r2' })).toBe(true)
    expect(commandsSeen(diplomacy, 'r1', { id: 'kept', owner: 'r2' })).toBe(false)
    const none = { ...diplomacy, alliance: null }
    expect(commandsSeen(none, 'r2', { id: 'lent', owner: 'r2' })).toBe(true)
  })
})
