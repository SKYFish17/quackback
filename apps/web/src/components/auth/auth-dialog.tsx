import { useState } from 'react'
import { useIntl, FormattedMessage } from 'react-intl'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { PortalAuthFormInline } from './portal-auth-form-inline'
import { useAuthPopover } from './auth-popover-context'
import { useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'

interface OrgAuthConfig {
  found: boolean
  oauth: Record<string, boolean | undefined>
  openSignup?: boolean
  customProviderNames?: Record<string, string>
}

interface AuthDialogProps {
  authConfig?: OrgAuthConfig | null
  workspaceName?: string
}

import type { AuthFormStep } from './email-signin-types'

interface FormContext {
  step: AuthFormStep
  email: string
}

/** Wraps the inline auth form in a Radix dialog with a header that
 * adapts to the form's current step (e.g. flips to "Check your email"
 * after the user submits their email). */
export function AuthDialog({ authConfig, workspaceName }: AuthDialogProps) {
  const intl = useIntl()
  const { isOpen, mode, closeAuthPopover, setMode, onAuthSuccess } = useAuthPopover()
  const [formContext, setFormContext] = useState<FormContext>({ step: 'credentials', email: '' })

  // Listen for auth success broadcasts from popup windows
  useAuthBroadcast({
    onSuccess: onAuthSuccess,
    enabled: isOpen,
  })

  const { title, description } = headerForStep(intl, mode, formContext)

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          // Reset context on close so the next open starts fresh
          setFormContext({ step: 'credentials', email: '' })
          closeAuthPopover()
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <PortalAuthFormInline
          mode={mode}
          authConfig={authConfig}
          workspaceName={workspaceName}
          onModeSwitch={setMode}
          onContextChange={setFormContext}
        />
      </DialogContent>
    </Dialog>
  )
}

function headerForStep(
  intl: ReturnType<typeof useIntl>,
  mode: 'login' | 'signup',
  ctx: FormContext
): { title: string; description: React.ReactNode } {
  if (ctx.step === 'code') {
    return {
      title: mode === 'signup'
        ? intl.formatMessage({ id: 'portal.auth.dialog.almostThere', defaultMessage: 'Almost there' })
        : intl.formatMessage({ id: 'portal.auth.checkEmail', defaultMessage: 'Check your email' }),
      description: (
        <FormattedMessage
          id="portal.auth.sentCodeTo"
          defaultMessage="We sent a 6-digit code to <strong>{email}</strong>."
          values={{
            email: ctx.email,
            strong: (chunks) => <strong className="text-foreground">{chunks}</strong>,
          }}
        />
      ),
    }
  }
  if (ctx.step === 'forgot') {
    return {
      title: intl.formatMessage({ id: 'portal.auth.resetPassword', defaultMessage: 'Reset your password' }),
      description: intl.formatMessage({ id: 'portal.auth.dialog.resetDescription', defaultMessage: "Enter your email and we'll send you a reset link." }),
    }
  }
  if (ctx.step === 'reset') {
    return {
      title: intl.formatMessage({ id: 'portal.auth.checkEmail', defaultMessage: 'Check your email' }),
      description: intl.formatMessage({ id: 'portal.auth.dialog.sentResetLink', defaultMessage: 'We sent you a password reset link.' }),
    }
  }
  return {
    title: mode === 'login'
      ? intl.formatMessage({ id: 'portal.auth.welcomeBack', defaultMessage: 'Welcome back' })
      : intl.formatMessage({ id: 'portal.auth.createAccount', defaultMessage: 'Create an account' }),
    description: mode === 'login'
      ? intl.formatMessage({ id: 'portal.auth.dialog.signInToVote', defaultMessage: 'Sign in to vote and comment on feedback.' })
      : intl.formatMessage({ id: 'portal.auth.dialog.signUpToVote', defaultMessage: 'Sign up to vote and comment on feedback.' }),
  }
}
