/**
 * SSO test sign-in callback.
 *
 * Popup target the admin's browser is redirected to after the IdP
 * authorize step. Inherits the /admin layout (admin must still be
 * signed in — the diagnostic handshake never touches their session).
 *
 * Loader (server) reads the per-state session from Redis, deletes it
 * BEFORE running the handshake (one-time use), runs the handshake,
 * and persists the result at `sso-test:result:<testId>` for the
 * polling fallback. Component (client) postMessages the result to
 * the opener and auto-closes on success.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { z } from 'zod'
import type { HandshakeResult } from '@/lib/server/auth/sso-test-handshake'
import type { SsoTestDiagnostic } from '@/lib/server/functions/sso-test'

const searchSchema = z.object({
  state: z.string().optional(),
  code: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
})

export const Route = createFileRoute('/admin/sso/test/callback')({
  validateSearch: searchSchema,
  loader: async ({ location }) => {
    const search = searchSchema.parse(location.search)
    const { cacheGet, cacheSet, cacheDel } = await import('@/lib/server/redis')
    const { runHandshake } = await import('@/lib/server/auth/sso-test-handshake')

    if (!search.state) {
      return {
        result: {
          ok: false,
          stage: 'state-validation',
          hint: 'IdP redirect did not include a state parameter.',
          steps: [],
        } satisfies HandshakeResult,
        testId: null as string | null,
      }
    }

    const sessionKey = `sso-test:${search.state}`
    const session = await cacheGet<{
      testId: string
      state: string
      nonce: string
      tokenEndpoint: string
      jwksUri: string
      issuer: string
      discoveryUrl: string
      clientId: string
      clientSecret: string
      redirectUri: string
    }>(sessionKey)

    if (!session) {
      return {
        result: {
          ok: false,
          stage: 'state-validation',
          hint: 'Test session expired or invalid. Start the test again.',
          steps: [],
        } satisfies HandshakeResult,
        testId: null as string | null,
      }
    }

    // One-time-use: delete the session BEFORE running the handshake so
    // the state/nonce can never be replayed even if the handshake hangs.
    await cacheDel(sessionKey)

    const result = await runHandshake({
      state: search.state,
      code: search.code ?? null,
      idpError: search.error ?? null,
      idpErrorDescription: search.error_description ?? null,
      expectedState: session.state,
      expectedNonce: session.nonce,
      discoveryUrl: session.discoveryUrl,
      clientId: session.clientId,
      clientSecret: session.clientSecret,
      redirectUri: session.redirectUri,
    })

    // Strip the failure-branch `raw` debug field before persisting:
    // TanStack's serializable-input check rejects `unknown` payloads,
    // and `SsoTestDiagnostic` (what `getSsoTestResultFn` returns) omits
    // it. See note in apps/web/src/lib/server/functions/sso-test.ts.
    const wireResult: SsoTestDiagnostic['result'] = result.ok
      ? result
      : {
          ok: false,
          stage: result.stage,
          errorCode: result.errorCode,
          hint: result.hint,
          steps: result.steps,
        }

    // Persist the result for the polling fallback (postMessage is
    // primary; polling covers popup-blocker / cross-window cases).
    await cacheSet(
      `sso-test:result:${session.testId}`,
      { result: wireResult } satisfies SsoTestDiagnostic,
      600
    )

    return { result, testId: session.testId as string | null }
  },
  component: TestCallbackPage,
})

function TestCallbackPage() {
  const { result, testId } = Route.useLoaderData()
  useEffect(() => {
    if (typeof window === 'undefined' || !window.opener) return
    window.opener.postMessage(
      { source: 'quackback-sso-test', testId, result },
      window.location.origin
    )
    // Brief delay so admin sees the result before the popup closes
    // on success. On failure, leave it open for them to read.
    if (result.ok) {
      const t = setTimeout(() => window.close(), 1500)
      return () => clearTimeout(t)
    }
  }, [result, testId])

  return (
    <div className="p-6 max-w-xl mx-auto">
      <h1 className="text-lg font-semibold mb-2">SSO test sign-in</h1>
      {result.ok ? (
        <p className="text-green-600 text-sm">
          Sign-in succeeded. This window will close automatically.
        </p>
      ) : (
        <div className="text-sm">
          <p className="text-destructive font-medium">Test failed at: {result.stage}</p>
          <p className="mt-2 text-muted-foreground">{result.hint}</p>
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        You can close this window. Results will appear in the original tab.
      </p>
    </div>
  )
}
