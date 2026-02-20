'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck, Trash2, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  useNotifications,
  useMarkAsRead,
  useMarkAllAsRead,
  useDeleteNotification,
  useUnreadCount,
} from '@/hooks/use-notifications'
import type { Notification } from '@/lib/api/notifications'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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

const typeBadgeVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  info: 'secondary',
  warning: 'outline',
  error: 'destructive',
  success: 'default',
  transfer: 'outline',
  upload: 'secondary',
}

function NotificationCard({ notification: n }: { notification: Notification }) {
  const router = useRouter()
  const markRead = useMarkAsRead()
  const deleteNotif = useDeleteNotification()

  const handleNavigate = () => {
    if (!n.read) markRead.mutate(n.id)
    const link = getEntityLink(n)
    if (link) router.push(link)
  }

  return (
    <Card className={!n.read ? 'border-primary/30 bg-primary/5' : ''}>
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          {/* Unread indicator */}
          <div className="pt-1.5">
            {!n.read ? (
              <span className="h-2.5 w-2.5 rounded-full bg-primary block" />
            ) : (
              <span className="h-2.5 w-2.5 block" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <button
                onClick={handleNavigate}
                className="text-left"
              >
                <p className="text-sm font-medium">{n.title}</p>
                {n.message && (
                  <p className="text-sm text-muted-foreground mt-0.5">{n.message}</p>
                )}
              </button>
              {n.notification_type && (
                <Badge
                  variant={typeBadgeVariant[n.notification_type] || 'secondary'}
                  className="flex-shrink-0"
                >
                  {n.notification_type}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-xs text-muted-foreground">{formatDate(n.created_at)}</span>
              {!n.read && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={() => markRead.mutate(n.id)}
                  disabled={markRead.isPending}
                >
                  Mark read
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-destructive hover:text-destructive">
                    <Trash2 className="h-3 w-3 mr-1" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete notification?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove this notification.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteNotif.mutate(n.id)}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [page, setPage] = useState(1)

  const { data, isLoading } = useNotifications({
    unread_only: unreadOnly,
    page,
    limit: 20,
  })
  const { data: unreadCount = 0 } = useUnreadCount()
  const markAllRead = useMarkAllAsRead()

  const notifications = data?.data || []
  const meta = data?.meta

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bell className="h-6 w-6" />
            Notifications
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
              : 'All caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            <CheckCheck className="h-4 w-4 mr-2" />
            Mark all as read
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Switch
          id="unread-only"
          checked={unreadOnly}
          onCheckedChange={(checked) => {
            setUnreadOnly(checked)
            setPage(1)
          }}
        />
        <Label htmlFor="unread-only" className="text-sm">
          Show unread only
        </Label>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : notifications.length > 0 ? (
        <div className="space-y-3">
          {notifications.map((n) => (
            <NotificationCard key={n.id} notification={n} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Inbox className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="font-medium">No notifications</p>
            <p className="text-sm text-muted-foreground mt-1">
              {unreadOnly ? 'No unread notifications.' : 'You have no notifications yet.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {meta && meta.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {meta.page} of {meta.total_pages} ({Number(meta.total)} total)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.total_pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
