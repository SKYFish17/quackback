/**
 * Unit tests for the audit log helper.
 *
 * Confirms the helper builds rows with the right shape, defaults
 * outcome to 'success', extracts IP/UA from common request headers,
 * and swallows insert errors so audit failures never block the
 * primary action (audit is best-effort, not transactional with the
 * mutation it records).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UserId } from '@quackback/ids'

const mockInsertValues = vi.fn()
const mockInsert = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
  },
  auditLog: { __table: 'audit_log' },
}))

const { recordAuditEvent } = await import('../log')

beforeEach(() => {
  vi.clearAllMocks()
  mockInsertValues.mockResolvedValue(undefined)
  mockInsert.mockReturnValue({ values: mockInsertValues })
})

describe('recordAuditEvent', () => {
  it('records an event with the supplied actor, target, and metadata', async () => {
    await recordAuditEvent({
      event: 'sso.enforcement.domain.enabled',
      actor: {
        userId: 'user_01h' as UserId,
        email: 'admin@example.com',
        role: 'admin',
      },
      target: { type: 'sso_verified_domain', id: 'domain_01h' },
      before: { enforced: false },
      after: { enforced: true },
      metadata: { domain: 'example.com' },
    })

    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockInsertValues).toHaveBeenCalledTimes(1)

    const row = mockInsertValues.mock.calls[0][0]
    expect(row).toMatchObject({
      eventType: 'sso.enforcement.domain.enabled',
      eventOutcome: 'success',
      actorUserId: 'user_01h',
      actorEmail: 'admin@example.com',
      actorRole: 'admin',
      targetType: 'sso_verified_domain',
      targetId: 'domain_01h',
      beforeValue: { enforced: false },
      afterValue: { enforced: true },
      metadata: { domain: 'example.com' },
    })
  })

  it('defaults outcome to success when omitted', async () => {
    await recordAuditEvent({
      event: 'auth.password.disabled',
      actor: { email: 'a@b.com' },
    })

    expect(mockInsertValues.mock.calls[0][0].eventOutcome).toBe('success')
  })

  it('records explicit failure outcome', async () => {
    await recordAuditEvent({
      event: 'auth.method.blocked',
      outcome: 'failure',
      actor: { email: 'a@b.com' },
    })

    expect(mockInsertValues.mock.calls[0][0].eventOutcome).toBe('failure')
  })

  it('extracts ip and user-agent from a Request', async () => {
    const request = new Request('https://example.com/admin/x', {
      headers: {
        'x-forwarded-for': '203.0.113.45, 10.0.0.1',
        'user-agent': 'Mozilla/5.0 (Test)',
      },
    })

    await recordAuditEvent({
      event: 'sso.config.changed',
      actor: { email: 'a@b.com' },
      request,
    })

    const row = mockInsertValues.mock.calls[0][0]
    expect(row.actorIp).toBe('203.0.113.45')
    expect(row.actorUserAgent).toBe('Mozilla/5.0 (Test)')
  })

  it('swallows insert errors and does not throw', async () => {
    mockInsertValues.mockRejectedValueOnce(new Error('connection refused'))

    await expect(
      recordAuditEvent({ event: 'sso.config.changed', actor: { email: 'a@b.com' } })
    ).resolves.toBeUndefined()
  })

  it('omits actor user id when actor is anonymous', async () => {
    await recordAuditEvent({
      event: 'auth.method.blocked',
      actor: { email: 'unknown@example.com' },
    })

    const row = mockInsertValues.mock.calls[0][0]
    expect(row.actorUserId).toBeNull()
  })
})
