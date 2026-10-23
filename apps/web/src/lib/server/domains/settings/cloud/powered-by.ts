import type { CloudConfig } from './cloud.types'

/**
 * Whether the "Powered by Quackback" badge should render on the portal,
 * widget, and branded emails.
 *
 * SmmBox fork: self-hosted (cloud disabled) never shows it — feedback.smmbox.com
 * runs under the SmmBox brand. Upstream always shows it on self-hosted installs.
 * `isEntitled('hideBranding')` is still the wrong check for cloud: that function
 * is true when cloud is off.
 */
export function shouldShowPoweredBy(config: CloudConfig): boolean {
  if (!config.enabled) return false
  return config.entitlements.hideBranding !== true
}
