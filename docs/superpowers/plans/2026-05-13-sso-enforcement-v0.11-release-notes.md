# v0.11.0 release notes — SSO enforcement & compliance foundations

## What's new for admins

### Workspace-wide SSO enforcement

A new tri-state enforcement selector under **Settings → Security → Authentication**:

- **Off** — no hard-binding; team members can use any enabled method.
- **Per verified domain** — only emails at verified domains marked Enforced are bound (existing behaviour, unchanged).
- **Required for all team members** — every admin and member must sign in via SSO regardless of email domain.

Enabling Required mode opens a confirmation modal that surfaces the impact (team members without SSO, active non-SSO sessions, magic-link state, recovery-codes state). Two acknowledgement checkboxes + a recovery-codes-required guard gate the enable button.

On enable:

- Any active non-SSO team sessions are revoked immediately
- Magic-link is auto-disabled (opt back in with `allowMagicLinkUnderRequired`)
- An `sso.enforcement.workspace_required.enabled` audit row is written

### Recovery codes

Admins now generate one-time break-glass codes from the Security page. Each batch is 10 codes in `XXXX-XXXX-XXXX` Crockford-base32 format. Codes are shown once in a show-once modal with Copy / Download / Print and a mandatory acknowledgement checkbox before dismissal. Stored as scrypt hashes with per-code salts; never logged.

Sign in with a code at `/auth/recovery`. Used codes are marked one-time-use immediately and can't be replayed.

### IdP attribute-based role mapping

Source the user's role from a claim on the ID token instead of the flat `autoProvisionRole`. Configure under SSO settings:

- **Claim path** — dotted (`realm_access.roles`) or URL-shaped (`https://acme.com/roles`)
- **Rules** — first-match-wins, `whenContains` against the claim's array members or scalar
- **Default role** — used when no rule matches
- **Sync on every sign-in** — opt in to re-resolve and apply the role on every successful SSO sign-in (demotes existing team members when their IdP group changes)

Role changes from mapping emit `user.role.changed` audit rows with the source field for traceability.

### Audit log

New append-only ledger of security-sensitive admin actions. View under **Settings → Audit log** with event-type and time-range filters plus CSV export. Captures:

- SSO config changes (domain enforce, client-secret rotate, workspace-wide require, attribute mapping)
- Authentication-method toggles (password, magic-link)
- 2FA admin resets
- Recovery-code generation / use
- Bulk session revocations
- Role changes from mapping

Each row records actor (user id, email, role denormalised), IP, user-agent, event type + outcome, target, before/after values, and event-specific metadata.

## Migration notes

Three new migrations:

- `0057_audit_log.sql` — `audit_log` table with three (col, occurred_at DESC) indexes
- `0058_sso_recovery_codes.sql` — `sso_recovery_code` table with active-hash unique index
- `0059_sso_required_default.sql` — backfills `authConfig.ssoOidc.required=false` for tenants with an existing ssoOidc block (behaviour-preserving)

`bun run db:migrate` applies cleanly from any v0.10.x state.

## Behavioural changes

- **`updateAuthConfigFn`** now audits SSO config writes and emits failure audit rows on rejected toggle attempts (tier gate, managed fields, secret presence)
- **`isHardBoundByVerifiedDomain`** is deprecated in favour of `isHardBound`. The old helper still works for backwards compatibility.
- **`lookupAuthMethodsFn`** returns `sso-redirect` for every team-surface email when workspace-wide Required mode is on (no per-email check — would leak existence)
- **Admin auth helpers** — `actorFromAuth(auth)` shorthand replaces the four-line actor literal at call sites

## What's still on the roadmap (out of scope for v0.11)

- SCIM provisioning (v0.12 candidate)
- Audit-log retention policy + scrub path for GDPR erasure (v0.12)
- Rate-limit on `/auth/recovery` route (currently relies on infra-layer rate limits)
- Cursor pagination for the audit-log feed (currently lookahead-only; sufficient until ~100k rows)
