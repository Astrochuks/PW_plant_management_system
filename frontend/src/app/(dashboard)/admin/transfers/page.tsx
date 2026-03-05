'use client'

import { useState } from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ArrowRightLeft, Check, X, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ProtectedRoute } from '@/components/protected-route'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  useAdminSiteTransferRequests,
  useAdminConfirmSiteTransfer,
  useAdminRejectSiteTransfer,
  type SiteTransferRequest,
} from '@/hooks/use-transfers'
import { getErrorMessage } from '@/lib/api/client'
import { toast } from 'sonner'

// ============================================================================
// Page
// ============================================================================

function TransferRequestsContent() {
  const [statusFilter, setStatusFilter] = useState<'pending' | 'confirmed' | 'rejected'>('pending')
  const { data, isLoading, refetch, isFetching } = useAdminSiteTransferRequests(statusFilter)
  const confirmMutation = useAdminConfirmSiteTransfer()
  const rejectMutation = useAdminRejectSiteTransfer()

  const [pendingAction, setPendingAction] = useState<{
    id: string
    action: 'confirm' | 'reject'
    label: string
  } | null>(null)

  const requests = data?.data ?? []

  function handleConfirm(req: SiteTransferRequest) {
    setPendingAction({
      id: req.id,
      action: 'confirm',
      label: `${req.plant.fleet_number}: ${req.from_site.name} → ${req.to_site.name}`,
    })
  }

  function handleReject(req: SiteTransferRequest) {
    setPendingAction({
      id: req.id,
      action: 'reject',
      label: `${req.plant.fleet_number}: ${req.from_site.name} → ${req.to_site.name}`,
    })
  }

  function executeAction() {
    if (!pendingAction) return
    const { id, action } = pendingAction
    const mutation = action === 'confirm' ? confirmMutation : rejectMutation
    mutation.mutate(id, {
      onSuccess: (res) => {
        toast.success(res.message ?? (action === 'confirm' ? 'Transfer confirmed' : 'Transfer rejected'))
        setPendingAction(null)
      },
      onError: (err) => {
        toast.error(getErrorMessage(err))
        setPendingAction(null)
      },
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transfer Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Site-to-site plant transfer requests — visible only to admin and the two sites involved
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 border-b">
        {(['pending', 'confirmed', 'rejected'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
              statusFilter === s
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {s}
            {s === 'pending' && data && statusFilter === 'pending' && (
              <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
                {data.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading…
        </div>
      ) : requests.length === 0 ? (
        <div className="border rounded-lg p-12 text-center">
          <ArrowRightLeft className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">No {statusFilter} transfer requests</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Plant</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">From Site</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">To Site</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Type</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Requested</th>
                {statusFilter === 'pending' && (
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2.5">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {requests.map((req) => (
                <TransferRow
                  key={req.id}
                  req={req}
                  showActions={statusFilter === 'pending'}
                  isActing={
                    (confirmMutation.isPending || rejectMutation.isPending) &&
                    pendingAction?.id === req.id
                  }
                  onConfirm={() => handleConfirm(req)}
                  onReject={() => handleReject(req)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmation dialog */}
      <AlertDialog open={!!pendingAction} onOpenChange={(o) => { if (!o) setPendingAction(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.action === 'confirm' ? 'Confirm Transfer' : 'Reject Transfer'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.action === 'confirm'
                ? `This will move ${pendingAction?.label} and update the plant's location. This cannot be undone.`
                : `This will reject the transfer request for ${pendingAction?.label}. The plant stays at its current site.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeAction}
              className={pendingAction?.action === 'reject'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : ''}
            >
              {pendingAction?.action === 'confirm' ? 'Confirm Transfer' : 'Reject Transfer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ============================================================================
// Row
// ============================================================================

function TransferRow({
  req,
  showActions,
  isActing,
  onConfirm,
  onReject,
}: {
  req: SiteTransferRequest
  showActions: boolean
  isActing: boolean
  onConfirm: () => void
  onReject: () => void
}) {
  const age = req.created_at
    ? formatDistanceToNow(parseISO(req.created_at), { addSuffix: true })
    : '—'

  return (
    <tr className="hover:bg-muted/20 transition-colors">
      <td className="px-4 py-3">
        <div className="font-mono font-semibold text-sm">{req.plant.fleet_number}</div>
        {req.plant.description && (
          <div className="text-xs text-muted-foreground truncate max-w-[180px]">
            {req.plant.description}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-sm">{req.from_site.name}</td>
      <td className="px-4 py-3 text-sm">{req.to_site.name}</td>
      <td className="px-4 py-3">
        <Badge
          variant="outline"
          className={
            req.type === 'pull_request'
              ? 'text-purple-700 border-purple-200 bg-purple-50 dark:bg-purple-950/30'
              : 'text-blue-700 border-blue-200 bg-blue-50 dark:bg-blue-950/30'
          }
        >
          {req.type === 'pull_request' ? 'Pull Request' : 'Report Transfer'}
        </Badge>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{age}</td>
      {showActions && (
        <td className="px-4 py-3 text-right">
          {isActing ? (
            <Loader2 className="h-4 w-4 animate-spin ml-auto" />
          ) : (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                onClick={onConfirm}
              >
                <Check className="h-3.5 w-3.5 mr-1" />
                Confirm
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-red-700 border-red-200 hover:bg-red-50"
                onClick={onReject}
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Reject
              </Button>
            </div>
          )}
        </td>
      )}
    </tr>
  )
}

// ============================================================================
// Export with ProtectedRoute
// ============================================================================

export default function AdminTransfersPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <TransferRequestsContent />
    </ProtectedRoute>
  )
}
