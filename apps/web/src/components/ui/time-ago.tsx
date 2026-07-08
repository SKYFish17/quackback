import { useEffect, useState } from 'react'
import { formatDistanceToNow, type Locale } from 'date-fns'
import { enUS, ru, de, fr, es, ar } from 'date-fns/locale'
import { useIntl } from 'react-intl'

interface TimeAgoProps {
  date: Date | string
  className?: string
}

// Maps our supported react-intl locales to their date-fns equivalents.
const DATE_FNS_LOCALES: Record<string, Locale> = {
  en: enUS,
  ru,
  de,
  fr,
  es,
  ar,
}

function getTimeAgo(date: Date | string | null | undefined, locale: Locale): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  // Check for invalid date
  if (isNaN(d.getTime())) return ''
  return formatDistanceToNow(d, { addSuffix: true, locale })
}

export function TimeAgo({ date, className }: TimeAgoProps) {
  const intl = useIntl()
  const locale = DATE_FNS_LOCALES[intl.locale] ?? enUS

  // Initialize with computed value for SSR
  const [timeAgo, setTimeAgo] = useState<string>(() => getTimeAgo(date, locale))

  useEffect(() => {
    // Update immediately in case server/client time differs slightly
    setTimeAgo(getTimeAgo(date, locale))

    // Update every minute
    const interval = setInterval(() => {
      setTimeAgo(getTimeAgo(date, locale))
    }, 60000)

    return () => clearInterval(interval)
  }, [date, locale])

  return <span className={className}>{timeAgo}</span>
}
