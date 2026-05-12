/**
 * Append-only audit log helper.
 *
 * One call per security-sensitive admin action. Best-effort: insert
 * failures are logged and swallowed so the primary mutation isn't
 * blocked by audit-log downtime. Callers must not rely on the row
 * being visible to a subsequent SELECT in the same transaction —
 * inserts are made on the global connection, not the caller's tx.
 */
import { db, auditLog } from '@/lib/server/db'
import type { UserId } from '@quackback/ids'

/**
 * Closed taxonomy of audit event types.
 *
 * Add new entries as features land. Existing rows reference the
 * string literal directly so reordering / renaming is a schema-level
 * change — never reuse a retired identifier.
 */
export type AuditEventType =
  | 'sso.enforcement.domain.enabled'
  | 'sso.enforcement.domain.disabled'
  | 'sso.enforcement.workspace_required.enabled'
  | 'sso.enforcement.workspace_required.disabled'
  | 'sso.config.changed'
  | 'sso.recovery_codes.generated'
  | 'sso.recovery_codes.used'
  | 'sso.recovery_codes.invalidated'
  | 'auth.password.enabled'
  | 'auth.password.disabled'
  | 'auth.magic_link.enabled'
  | 'auth.magic_link.disabled'
  | 'auth.method.blocked'
  | 'session.revoked.bulk'
  | 'user.role.changed'
  | 'user.invited'
  | 'user.removed'
  | 'two_factor.reset_by_admin'
  | 'two_factor.enabled'
  | 'two_factor.disabled'

export type AuditEventOutcome = 'success' | 'failure'

export interface AuditActor {
  userId?: UserId | null
  email?: string | null
  role?: string | null
}

export interface AuditTarget {
  type: string
  id?: string | null
}

export interface RecordAuditEventInput {
  event: AuditEventType
  outcome?: AuditEventOutcome
  actor: AuditActor
  /** When passed, we extract IP from `x-forwarded-for` / `x-real-ip` and UA from `user-agent`. */
  request?: Request | { ip?: string | null; userAgent?: string | null }
  target?: AuditTarget
  before?: unknown
  after?: unknown
  metadata?: Record<string, unknown>
}

function extractIpAndUserAgent(request: RecordAuditEventInput['request']): {
  ip: string | null
  userAgent: string | null
} {
  if (!request) return { ip: null, userAgent: null }

  if (request instanceof Request) {
    const fwd = request.headers.get('x-forwarded-for')
    const ip = fwd ? fwd.split(',')[0].trim() : request.headers.get('x-real-ip')
    return {
      ip: ip || null,
      userAgent: request.headers.get('user-agent'),
    }
  }

  return {
    ip: request.ip ?? null,
    userAgent: request.userAgent ?? null,
  }
}

export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  const { ip, userAgent } = extractIpAndUserAgent(input.request)

  try {
    await db.insert(auditLog).values({
      eventType: input.event,
      eventOutcome: input.outcome ?? 'success',
      actorUserId: input.actor.userId ?? null,
      actorEmail: input.actor.email ?? null,
      actorRole: input.actor.role ?? null,
      actorIp: ip,
      actorUserAgent: userAgent,
      targetType: input.target?.type ?? null,
      targetId: input.target?.id ?? null,
      beforeValue: input.before ?? null,
      afterValue: input.after ?? null,
      metadata: input.metadata ?? null,
    })
  } catch (error) {
    console.error('[audit] recordAuditEvent failed:', { event: input.event, error })
  }
}
