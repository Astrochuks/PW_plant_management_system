'use client'

import { useRouter } from 'next/navigation'
import { Bell, CheckCheck, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  useUnreadCount,
  useNotifications,
  useMarkAsRead,
  useMarkAllAsRead,
} from '@/hooks/use-notifications'
import type { Notification } from '@/lib/api/notifications'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
}

function getEntityLink(n: Notification): string | null {
  if (!n.related_entity_type || !n.related_entity_id) return null
  const type = n.related_entity_type.toLowerCase()
  if (type === 'plant' || type === 'plants_master') return `/plants/${n.related_entity_id}`
  if (type === 'location' || type === 'locations') return `/locations/${n.related_entity_id}`
  if (type === 'transfer' || type === 'transfers') return `/transfers`
  if (type === 'spare_part' || type === 'spare_parts') return `/spare-parts`
  return null
}

export function NotificationBell() {
  const router = useRouter()
  const { data: unreadCount = 0 } = useUnreadCount()
  const { data } = useNotifications({ limit: 5 })
  const markRead = useMarkAsRead()
  const markAllRead = useMarkAllAsRead()

  const notifications = data?.data || []

  const handleClick = (n: Notification) => {
    if (!n.read) {
      markRead.mutate(n.id)
    }
    const link = getEntityLink(n)
    if (link) {
      router.push(link)
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center font-medium">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h4 className="text-sm font-semibold">Notifications</h4>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              Mark all read
            </Button>
          )}
        </div>

        {/* Notification List */}
        <div className="max-h-[320px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="py-8 text-center">
              <Inbox className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No notifications</p>
            </div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors border-b last:border-b-0"
              >
                <div className="flex gap-2">
                  {!n.read && (
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                  )}
                  <div className={!n.read ? '' : 'pl-4'}>
                    <p className="text-sm font-medium leading-tight">{n.title}</p>
                    {n.message && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {n.message}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {relativeTime(n.created_at)}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => router.push('/notifications')}
          >
            View all notifications
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
