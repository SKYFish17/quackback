'use client'

import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { getUserStatsFn } from '@/lib/server/functions/user'
import { cn } from '@/lib/shared/utils'

function StatItem({
  value,
  label,
  compact,
}: {
  value: number | undefined
  label: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col items-center rounded-md bg-muted/40',
        compact ? 'py-1.5 px-1' : 'py-2 px-2'
      )}
    >
      <span
        className={cn('font-bold tabular-nums text-foreground', compact ? 'text-sm' : 'text-lg')}
      >
        {value ?? '-'}
      </span>
      <span
        className={cn(
          'text-muted-foreground mt-0.5 whitespace-nowrap',
          compact ? 'text-[9px]' : 'text-[10px]'
        )}
      >
        {label}
      </span>
    </div>
  )
}

interface UserStatsBarProps {
  compact?: boolean
  className?: string
  headers?: Record<string, string>
}

export function UserStatsBar({ compact, className, headers }: UserStatsBarProps) {
  const intl = useIntl()
  const { data } = useQuery({
    queryKey: headers ? ['widget', 'user', 'engagement-stats'] : ['user', 'engagement-stats'],
    queryFn: () => getUserStatsFn(headers ? { headers } : undefined),
    staleTime: 60 * 1000,
  })

  return (
    <div className={cn('grid grid-cols-3 gap-1', className)}>
      <StatItem
        value={data?.ideas}
        label={intl.formatMessage({ id: 'portal.userStats.ideas', defaultMessage: 'Ideas' })}
        compact={compact}
      />
      <StatItem
        value={data?.votes}
        label={intl.formatMessage({ id: 'portal.userStats.votes', defaultMessage: 'Votes' })}
        compact={compact}
      />
      <StatItem
        value={data?.comments}
        label={intl.formatMessage({
          id: 'portal.userStats.comments',
          defaultMessage: 'Comments',
        })}
        compact={compact}
      />
    </div>
  )
}
