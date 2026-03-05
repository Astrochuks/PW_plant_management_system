'use client'

import { format, parseISO } from 'date-fns'
import { ArrowLeftRight, CheckCircle2, XCircle, Loader2, SendHorizonal } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
  useIncomingTransfers,
  usePullRequests,
  useConfirmTransfer,
  useRejectTransfer,
  type PullRequest,
  type IncomingTransfer,
} from '@/hooks/use-site-report'
import { getErrorMessage } from '@/lib/api/client'
import { toast } from 'sonner'

export default function SiteTransfersPage() {
  const { data: incoming = [], isLoading: incomingLoading } = useIncomingTransfers()
  const { data: pullRequests = [], isLoading: pullLoading } = usePullRequests()
  const confirmMutation = useConfirmTransfer()
  const rejectMutation = useRejectTransfer()

  const handleConfirm = (id: string, fleetNumber: string) => {
    confirmMutation.mutate(id, {
      onSuccess: () => toast.success(`${fleetNumber} confirmed — plant moved`),
      onError: (err) => toast.error(getErrorMessage(err)),
    })
  }

  const handleReject = (id: string, fleetNumber: string) => {
    rejectMutation.mutate(id, {
      onSuccess: () => toast.success(`Transfer of ${fleetNumber} rejected`),
      onError: (err) => toast.error(getErrorMessage(err)),
    })
  }

  const isLoading = incomingLoading || pullLoading

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Transfers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage incoming transfers and approve/reject transfer requests from other sites
        </p>
      </div>

      {/* ── Incoming transfers (regular — sent from another site to us) ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Incoming Transfers</h2>
          {incoming.length > 0 && (
            <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200 text-xs">
              {incoming.length} pending
            </Badge>
          )}
        </div>

        {incomingLoading ? (
          <TableSkeleton cols={7} />
        ) : incoming.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <ArrowLeftRight className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-40" />
              <p className="text-sm text-muted-foreground">No incoming transfers pending</p>
            </CardContent>
          </Card>
        ) : (
          <IncomingTable
            rows={incoming}
            onConfirm={handleConfirm}
            onReject={handleReject}
            isActing={confirmMutation.isPending || rejectMutation.isPending}
          />
        )}
      </section>

      {/* ── Pull requests (other sites requesting plants FROM us) ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Transfer Requests From Other Sites</h2>
          {pullRequests.length > 0 && (
            <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200 text-xs">
              {pullRequests.length} awaiting approval
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground -mt-1">
          Another site engineer has requested one of your plants. Approve to release it, or reject.
        </p>

        {pullLoading ? (
          <TableSkeleton cols={5} />
        ) : pullRequests.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <SendHorizonal className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-40" />
              <p className="text-sm text-muted-foreground">No transfer requests from other sites</p>
            </CardContent>
          </Card>
        ) : (
          <PullRequestTable
            rows={pullRequests}
            onApprove={handleConfirm}
            onReject={handleReject}
            isActing={confirmMutation.isPending || rejectMutation.isPending}
          />
        )}
      </section>
    </div>
  )
}

// ============================================================================
// Incoming transfers table
// ============================================================================

function IncomingTable({
  rows,
  onConfirm,
  onReject,
  isActing,
}: {
  rows: IncomingTransfer[]
  onConfirm: (id: string, fleet: string) => void
  onReject: (id: string, fleet: string) => void
  isActing: boolean
}) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[110px]">Fleet No.</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Fleet Type</TableHead>
            <TableHead>From Site</TableHead>
            <TableHead className="w-[110px]">Date</TableHead>
            <TableHead className="text-right w-[180px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-mono font-medium text-sm">{t.fleet_number}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{t.description ?? '—'}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{t.fleet_type ?? '—'}</TableCell>
              <TableCell className="text-sm">{t.from_location_name}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {t.transfer_date
                  ? format(parseISO(t.transfer_date + 'T00:00:00'), 'dd MMM yyyy')
                  : format(parseISO(t.created_at), 'dd MMM yyyy')}
              </TableCell>
              <TableCell className="text-right">
                <TransferActions
                  id={t.id}
                  fleetNumber={t.fleet_number}
                  siteName={t.from_location_name}
                  confirmLabel="Confirm Arrival"
                  confirmDescription={`Confirm that ${t.fleet_number} has physically arrived at your site from ${t.from_location_name}?`}
                  rejectDescription={`Reject the incoming transfer of ${t.fleet_number} from ${t.from_location_name}? The plant will remain at its current registered location.`}
                  onConfirm={onConfirm}
                  onReject={onReject}
                  isActing={isActing}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ============================================================================
// Pull requests table
// ============================================================================

function PullRequestTable({
  rows,
  onApprove,
  onReject,
  isActing,
}: {
  rows: PullRequest[]
  onApprove: (id: string, fleet: string) => void
  onReject: (id: string, fleet: string) => void
  isActing: boolean
}) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[110px]">Fleet No.</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Fleet Type</TableHead>
            <TableHead>Requesting Site</TableHead>
            <TableHead className="text-right w-[180px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-mono font-medium text-sm">{t.fleet_number}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{t.description ?? '—'}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{t.fleet_type ?? '—'}</TableCell>
              <TableCell className="text-sm">{t.requesting_location_name}</TableCell>
              <TableCell className="text-right">
                <TransferActions
                  id={t.id}
                  fleetNumber={t.fleet_number}
                  siteName={t.requesting_location_name}
                  confirmLabel="Approve & Release"
                  confirmDescription={`Approve the request from ${t.requesting_location_name} for ${t.fleet_number}? The plant will be transferred to their site.`}
                  rejectDescription={`Reject the request from ${t.requesting_location_name} for ${t.fleet_number}? The plant stays at your site.`}
                  onConfirm={onApprove}
                  onReject={onReject}
                  isActing={isActing}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ============================================================================
// Shared action buttons
// ============================================================================

function TransferActions({
  id,
  fleetNumber,
  siteName,
  confirmLabel,
  confirmDescription,
  rejectDescription,
  onConfirm,
  onReject,
  isActing,
}: {
  id: string
  fleetNumber: string
  siteName: string
  confirmLabel: string
  confirmDescription: string
  rejectDescription: string
  onConfirm: (id: string, fleet: string) => void
  onReject: (id: string, fleet: string) => void
  isActing: boolean
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" className="h-7 text-xs" disabled={isActing}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
            {confirmLabel}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Transfer</AlertDialogTitle>
            <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => onConfirm(id, fleetNumber)}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" disabled={isActing}>
            <XCircle className="h-3.5 w-3.5 mr-1" />
            Reject
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Transfer</AlertDialogTitle>
            <AlertDialogDescription>{rejectDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onReject(id, fleetNumber)}
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: cols }).map((_, i) => (
              <TableHead key={i}><Skeleton className="h-4 w-20" /></TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 3 }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: cols }).map((_, j) => (
                <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
