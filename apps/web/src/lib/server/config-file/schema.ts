import { z } from 'zod'

/**
 * Declarative Quackback config file schema.
 *
 * Loaded from `/etc/quackback/config.yaml`. Anything declared here is
 * reconciled into the `settings` row AND blocked from in-app UI
 * mutation; anything absent stays freely user-editable.
 *
 * Only fields with a legitimate platform-control story are in scope.
 * Workflow data (boards, posts, integrations, API keys, sessions) is
 * intentionally NOT representable here — keeps the lock surface small
 * and prevents the file from drifting into a kitchen-sink schema.
 */

const useCaseSchema = z.enum(['saas', 'consumer', 'marketplace', 'internal'])

const workspaceSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    slug: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    useCase: useCaseSchema.optional(),
  })
  .strict()

// Mirrors the real OSS TierLimits shape from
// apps/web/src/lib/server/domains/settings/tier-limits.types.ts:28.
// `null` in any numeric field = unlimited; partial objects allowed
// (the reconciler merges into the existing tierLimits row, so the
// file only needs to declare the fields it wants to lock).
const tierLimitNumberSchema = z.number().int().nonnegative().nullable()
const tierFeatureFlagsSchema = z
  .object({
    customDomain: z.boolean().optional(),
    customOidcProvider: z.boolean().optional(),
    ipAllowlist: z.boolean().optional(),
    webhooks: z.boolean().optional(),
    mcpServer: z.boolean().optional(),
    analyticsExports: z.boolean().optional(),
    customColors: z.boolean().optional(),
    customCss: z.boolean().optional(),
    integrations: z.boolean().optional(),
  })
  .strict()
  .optional()
const tierLimitsSchema = z
  .object({
    maxBoards: tierLimitNumberSchema.optional(),
    maxPosts: tierLimitNumberSchema.optional(),
    maxTeamSeats: tierLimitNumberSchema.optional(),
    aiTokensPerMonth: tierLimitNumberSchema.optional(),
    apiRequestsPerMonth: tierLimitNumberSchema.optional(),
    apiRequestsPerMinute: tierLimitNumberSchema.optional(),
    features: tierFeatureFlagsSchema,
  })
  .strict()

// `features` is per-key managed: each entry locks one feature flag
// while leaving others UI-toggleable. Allow any boolean key — the OSS
// FeatureFlags shape has its own zod schema that the reconciler
// validates against; here we just need the shape to be string→boolean.
const featuresSchema = z.record(z.string(), z.boolean())

// Suspension state. Cloud-only knob: CP flips this when a subscription
// goes past-due ('suspended') or the Quackback is scheduled for delete
// ('deleting'). Self-hosters never set it — without a config file the
// reconciler doesn't run and `settings.state` stays at its DB default
// of 'active'.
const stateSchema = z.enum(['active', 'suspended', 'deleting'])

// v1 auth surface: OAuth provider toggles + openSignup. Mirrors the OSS
// `AuthConfig` shape (settings.types.ts). Provider secrets stay in their
// existing channels (env + platform_credentials); the file only declares
// which providers are toggled on and whether signup is open. Custom OIDC
// (SSO_OIDC_*) is intentionally NOT declarative in v1 — that requires a
// Secret-reference resolver, which is a separate moving part.
const oauthProvidersSchema = z
  .object({
    google: z.boolean().optional(),
    github: z.boolean().optional(),
  })
  .strict()

// Cloud-OIDC default admin auth (Phase P). The file declares the
// non-secret config — discoveryUrl + clientId + UX flags — while the
// client *secret* keeps riding on SSO_OIDC_CLIENT_SECRET (mounted from
// the per-tenant K8s Secret rendered by the controller). When enabled
// + isDefault, the admin login UI promotes "Sign in with {providerName}"
// as the prominent CTA and demotes password / magic-link / other-OAuth
// to a "More sign-in options" disclosure.
const ssoOidcSchema = z
  .object({
    enabled: z.boolean(),
    providerName: z.string().min(1).max(100).default('Quackback Cloud'),
    discoveryUrl: z.string().url(),
    clientId: z.string().min(1),
    /** Show as the prominent default CTA on the admin login page.
     *  When true + enabled, password sign-in is hidden behind a
     *  "more options" disclosure (still available; just demoted). */
    isDefault: z.boolean().default(true),
    /** Auto-create OSS user records on first SSO sign-in. CP is the
     *  identity source of truth for cloud, so this is true by default. */
    autoCreateUsers: z.boolean().default(true),
  })
  .strict()

const authSchema = z
  .object({
    oauth: oauthProvidersSchema.optional(),
    openSignup: z.boolean().optional(),
    ssoOidc: ssoOidcSchema.optional(),
  })
  .strict()

export const quackbackConfigSchema = z
  .object({
    apiVersion: z.literal('quackback.io/v1'),
    kind: z.literal('QuackbackConfig'),
    metadata: z.object({ source: z.string().optional() }).strict().optional(),
    spec: z
      .object({
        workspace: workspaceSchema.optional(),
        tierLimits: tierLimitsSchema.optional(),
        features: featuresSchema.optional(),
        state: stateSchema.optional(),
        auth: authSchema.optional(),
      })
      .strict(),
  })
  .strict()

export type QuackbackConfig = z.infer<typeof quackbackConfigSchema>
export type QuackbackConfigSpec = QuackbackConfig['spec']

export function parseQuackbackConfig(input: unknown): z.ZodSafeParseResult<QuackbackConfig> {
  return quackbackConfigSchema.safeParse(input)
}
