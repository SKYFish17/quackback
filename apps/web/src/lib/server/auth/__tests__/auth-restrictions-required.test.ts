/**
 * isHardBound — policy predicate combining the per-domain enforced
 * branch with the workspace-wide ssoOidc.required branch.
 *
 *  - Workspace-wide branch fires for admin/member when
 *    authConfig.ssoOidc.required === true
 *  - Magic-link escapes when allowMagicLinkUnderRequired === true
 *  - Portal users (role='user') never hard-bound by workspace-wide
 *  - Per-domain branch still works when workspace-wide is off
 *  - OR semantics: either branch true means hard-bound
 */
import { describe, it, expect } from 'vitest'
import { isHardBound } from '../auth-restrictions'
import type { AuthConfig, VerifiedDomain } from '@/lib/server/domains/settings/settings.types'

const baseConfig: AuthConfig = {
  oauth: { password: true },
  openSignup: false,
}

/** Defaults for the SSO sub-tree — `enabled: true` so policy fires. */
const baseSso = {
  enabled: true,
  discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
  clientId: 'cid',
  autoCreateUsers: false,
} as const

const configWithSso = (overrides: Record<string, unknown> = {}): AuthConfig => ({
  ...baseConfig,
  ssoOidc: { ...baseSso, ...overrides } as never,
})

const enforcedDomain: VerifiedDomain = {
  id: 'domain_acme' as `domain_${string}`,
  name: 'acme.com',
  verificationToken: 'tok',
  verifiedAt: '2026-05-01T00:00:00.000Z',
  enforced: true,
  createdAt: '2026-05-01T00:00:00.000Z',
}

const verifiedDomain: VerifiedDomain = { ...enforcedDomain, enforced: false }

describe('isHardBound — workspace-wide branch', () => {
  it('blocks credential for admin when ssoOidc.required=true', () => {
    expect(
      isHardBound(
        'credential',
        'foo@example.com',
        'admin',
        { ...baseConfig, ssoOidc: { enabled: true, required: true } as never },
        []
      )
    ).toBe(true)
  })

  it('blocks magic-link for member when ssoOidc.required=true', () => {
    expect(
      isHardBound(
        'magic-link',
        'foo@example.com',
        'member',
        { ...baseConfig, ssoOidc: { enabled: true, required: true } as never },
        []
      )
    ).toBe(true)
  })

  it('still allows magic-link when allowMagicLinkUnderRequired=true', () => {
    expect(
      isHardBound(
        'magic-link',
        'foo@example.com',
        'admin',
        {
          ...baseConfig,
          ssoOidc: {
            enabled: true,
            required: true,
            allowMagicLinkUnderRequired: true,
          } as never,
        },
        []
      )
    ).toBe(false)
  })

  it('does NOT bind portal user (role=user) when required=true', () => {
    expect(
      isHardBound(
        'credential',
        'foo@example.com',
        'user',
        { ...baseConfig, ssoOidc: { enabled: true, required: true } as never },
        []
      )
    ).toBe(false)
  })

  it('does nothing when required=false / undefined', () => {
    expect(
      isHardBound('credential', 'foo@example.com', 'admin', configWithSso({ required: false }), [])
    ).toBe(false)
    expect(isHardBound('credential', 'foo@example.com', 'admin', baseConfig, [])).toBe(false)
  })
})

describe('isHardBound — per-domain branch (regression)', () => {
  it('still blocks emails at enforced verified domains', () => {
    expect(
      isHardBound('credential', 'a@acme.com', 'admin', configWithSso(), [enforcedDomain])
    ).toBe(true)
  })

  it('does NOT block when verified domain has enforced=false', () => {
    expect(
      isHardBound('credential', 'a@acme.com', 'admin', configWithSso(), [verifiedDomain])
    ).toBe(false)
  })
})

describe('isHardBound — OR semantics', () => {
  it('returns true when both branches would block', () => {
    expect(
      isHardBound('credential', 'a@acme.com', 'admin', configWithSso({ required: true }), [
        enforcedDomain,
      ])
    ).toBe(true)
  })

  it('returns true when only the workspace-wide branch blocks', () => {
    expect(
      isHardBound('credential', 'a@example.com', 'admin', configWithSso({ required: true }), [])
    ).toBe(true)
  })

  it('returns true when only the per-domain branch blocks', () => {
    expect(
      isHardBound('credential', 'a@acme.com', 'admin', configWithSso(), [enforcedDomain])
    ).toBe(true)
  })
})

describe('isHardBound — master switch (ssoOidc.enabled)', () => {
  // The workspace `enabled` toggle is the master switch. When admin
  // disables SSO, all downstream enforcement (`required`, per-domain
  // `enforced`) becomes dormant. Stale rows shouldn't keep blocking
  // sign-ins after the admin has switched SSO off.
  it('returns false when ssoOidc is absent (never configured)', () => {
    expect(isHardBound('credential', 'a@acme.com', 'admin', baseConfig, [enforcedDomain])).toBe(
      false
    )
  })

  it('returns false when ssoOidc.enabled=false even with a stale enforced-domain row', () => {
    expect(
      isHardBound('credential', 'a@acme.com', 'admin', configWithSso({ enabled: false }), [
        enforcedDomain,
      ])
    ).toBe(false)
  })

  it('returns false when ssoOidc.enabled=false even with stale workspace required=true', () => {
    expect(
      isHardBound(
        'credential',
        'a@example.com',
        'admin',
        configWithSso({ enabled: false, required: true }),
        []
      )
    ).toBe(false)
  })

  it('returns false for magic-link too when ssoOidc.enabled=false', () => {
    expect(
      isHardBound('magic-link', 'a@acme.com', 'admin', configWithSso({ enabled: false }), [
        enforcedDomain,
      ])
    ).toBe(false)
  })
})

describe('isHardBound — non-hard-bound providers', () => {
  it('returns false for sso', () => {
    expect(
      isHardBound(
        'sso',
        'a@example.com',
        'admin',
        { ...baseConfig, ssoOidc: { enabled: true, required: true } as never },
        []
      )
    ).toBe(false)
  })

  it('returns false for google', () => {
    expect(
      isHardBound(
        'google',
        'a@example.com',
        'admin',
        { ...baseConfig, ssoOidc: { enabled: true, required: true } as never },
        []
      )
    ).toBe(false)
  })
})
