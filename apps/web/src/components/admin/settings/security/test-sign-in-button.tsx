/**
 * Admin "Test sign-in" button. Opens a popup against the IdP's
 * authorize URL and listens for the diagnostic result the
 * `/admin/sso/test/callback` route posts back via window.postMessage.
 * Falls back to polling `getSsoTestResultFn` every 2s in case the
 * popup is closed before the postMessage fires (e.g. an IdP redirect
 * to an error page that's on a different origin and so can't post).
 *
 * Renders an inline result panel with the per-stage step list — the
 * admin sees exactly where the handshake broke (token-exchange,
 * signature-verify, claim-check, …) without having to dig through
 * IdP logs.
 */

import { useEffect, useRef, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { startSsoTestFn, getSsoTestResultFn } from '@/lib/server/functions/sso-test'
import type { HandshakeResult } from '@/lib/server/auth/sso-test-handshake'
import { SSO_TEST_POSTMESSAGE_SOURCE } from '@/lib/shared/sso-test-keys'

const POPUP_FEATURES = 'width=600,height=720'
const POLL_INTERVAL_MS = 2000

/** Inline mirror of {@link HandshakeResult} minus the failure-branch
 *  `raw?: unknown` debug field. The callback route strips `raw` before
 *  writing the diagnostic to Redis (TanStack's serializable-input
 *  check rejects unknown shapes), so the wire payload is structurally
 *  this narrower type. Keeps the panel rendering off any field that
 *  isn't actually present on the result. */
type WireResult =
  | Extract<HandshakeResult, { ok: true }>
  | Omit<Extract<HandshakeResult, { ok: false }>, 'raw'>

function friendlyStartError(error: string): string {
  switch (error) {
    case 'sso-not-configured':
      return 'Save your IdP discovery URL and client ID before testing.'
    case 'no-secret':
      return 'Save a client secret before testing.'
    case 'discovery-unreachable':
      return "Couldn't fetch the discovery URL. Check that it's reachable and points at a valid OIDC document."
    default:
      return error
  }
}

export function TestSignInButton({ disabled }: { disabled?: boolean }) {
  const startTest = useServerFn(startSsoTestFn)
  const pollResult = useServerFn(getSsoTestResultFn)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<WireResult | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const popupRef = useRef<Window | null>(null)

  const clearPoll = () => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  // Listen for the callback route's postMessage. Origin + source checks
  // keep stray messages (extensions, other tabs, the IdP itself) from
  // ending the test early with garbage data.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      const data = e.data as { source?: string; result?: WireResult } | null
      if (!data || typeof data !== 'object') return
      if (data.source !== SSO_TEST_POSTMESSAGE_SOURCE) return
      if (!data.result) return
      setResult(data.result)
      setTesting(false)
      clearPoll()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Belt-and-braces cleanup if the component unmounts mid-test.
  useEffect(() => {
    return () => clearPoll()
  }, [])

  async function handleStart() {
    setError(null)
    setResult(null)
    setTesting(true)
    let r: Awaited<ReturnType<typeof startTest>>
    try {
      r = await startTest({ data: {} })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the test.')
      setTesting(false)
      return
    }
    if ('error' in r) {
      setError(friendlyStartError(r.error))
      setTesting(false)
      return
    }
    const popup = window.open(r.authorizeUrl, SSO_TEST_POSTMESSAGE_SOURCE, POPUP_FEATURES)
    if (!popup) {
      setError('Popup blocked. Allow popups for this site and try again.')
      setTesting(false)
      return
    }
    popupRef.current = popup
    // Polling fallback: if the popup lands on an off-origin error page
    // the postMessage will never fire, but the callback route may still
    // have written a diagnostic to Redis. Cleared the moment a result
    // arrives or the component unmounts.
    clearPoll()
    pollRef.current = setInterval(async () => {
      try {
        const diag = await pollResult({ data: { testId: r.testId } })
        if (diag && diag.result) {
          setResult(diag.result)
          setTesting(false)
          clearPoll()
        }
      } catch {
        // Swallow transient errors — the popup may still produce a
        // postMessage. We don't want to kill the test on one bad poll.
      }
    }, POLL_INTERVAL_MS)
  }

  return (
    <div className="space-y-3">
      <Button onClick={handleStart} disabled={disabled || testing} variant="outline">
        {testing ? 'Testing sign-in…' : 'Test sign-in'}
      </Button>
      {error && (
        <Alert variant="destructive">
          <ExclamationTriangleIcon className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {result && <TestResultPanel result={result} />}
    </div>
  )
}

const STAGE_LABELS: Record<string, string> = {
  'state-validation': 'State validation',
  'idp-authorize': 'IdP authorize',
  'discovery-fetch': 'Discovery fetch',
  'token-exchange': 'Token exchange',
  'id-token-decode': 'ID token decode',
  'signature-verify': 'Signature verify',
  'claim-check': 'Claim check',
  userinfo: 'Userinfo',
}

function StepList({ steps }: { steps: WireResult['steps'] }) {
  if (steps.length === 0) return null
  return (
    <ul className="space-y-1 text-xs">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2">
          {s.ok ? (
            <CheckCircleIcon className="h-3.5 w-3.5 text-green-600 mt-0.5 shrink-0" />
          ) : (
            <ExclamationTriangleIcon className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
          )}
          <span>
            <span className="font-medium">{s.label}</span>
            {s.detail && <span className="text-muted-foreground"> — {s.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function TestResultPanel({ result }: { result: WireResult }) {
  if (result.ok) {
    return (
      <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-green-700">
          <CheckCircleIcon className="h-4 w-4" />
          Sign-in flow succeeded
        </div>
        <StepList steps={result.steps} />
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Show claims and token info
          </summary>
          <pre className="mt-2 overflow-auto rounded bg-muted/30 p-2 font-mono text-[11px]">
            {JSON.stringify({ claims: result.claims, tokenInfo: result.tokenInfo }, null, 2)}
          </pre>
        </details>
      </div>
    )
  }
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
        <ExclamationTriangleIcon className="h-4 w-4" />
        Failed at: {STAGE_LABELS[result.stage] ?? result.stage}
        {result.errorCode && (
          <code className="ml-1 text-[11px] text-muted-foreground">({result.errorCode})</code>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{result.hint}</p>
      <StepList steps={result.steps} />
    </div>
  )
}
