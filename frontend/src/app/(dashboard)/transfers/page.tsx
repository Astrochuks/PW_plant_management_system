'use client';

import { useState } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import {
  useTransfers,
  useTransferStats,
  useConfirmTransfer,
  useCancelTransfer,
  type Transfer,
} from '@/hooks/use-transfers';
import { getErrorMessage } from '@/lib/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
} from '@/components/ui/alert-dialog';
import {
  ArrowRightLeft,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/providers/auth-provider';
import { CreateTransferDialog } from '@/components/transfers/create-transfer-dialog';

const PAGE_SIZE = 20;

const STATUS_STYLES: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-800', icon: Clock },
  confirmed: { label: 'Confirmed', className: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-600', icon: XCircle },
};

function TransfersPageContent() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(0);

  const params = {
    status: statusFilter !== 'all' ? statusFilter : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { data, isLoading } = useTransfers(params);
  const { data: stats, isLoading: statsLoading } = useTransferStats();
  const confirmMutation = useConfirmTransfer();
  const cancelMutation = useCancelTransfer();

  const transfers = data?.data ?? [];
  const total = data?.pagination?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleConfirm = (transferId: string) => {
    confirmMutation.mutate(transferId, {
      onSuccess: (res) => toast.success(res.message),
      onError: (err) => toast.error(getErrorMessage(err)),
    });
  };

  const handleCancel = (transferId: string) => {
    cancelMutation.mutate(transferId, {
      onSuccess: (res) => toast.success(res.message),
      onError: (err) => toast.error(getErrorMessage(err)),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transfers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track and manage plant transfers between sites
          </p>
        </div>
        {isAdmin && <CreateTransferDialog />}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-3">
                <Skeleton className="h-4 w-20 mb-1" />
                <Skeleton className="h-7 w-10" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatCard label="Pending" value={stats?.data.pending ?? 0} color="amber" />
            <StatCard label="Confirmed" value={stats?.data.confirmed ?? 0} color="emerald" />
            <StatCard label="Cancelled" value={stats?.data.cancelled ?? 0} color="gray" />
            <StatCard label="Last 7 Days" value={stats?.data.recent_7_days ?? 0} color="blue" />
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => { setStatusFilter(v); setPage(0); }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {total} transfer{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton />
      ) : transfers.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <ArrowRightLeft className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-lg text-muted-foreground">No transfers found</p>
            <p className="text-sm text-muted-foreground mt-1">
              Transfers are auto-detected from weekly reports or created manually
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Fleet No.</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead />
                  <TableHead>To</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[60px]">Week</TableHead>
                  <TableHead className="w-[100px]">Date</TableHead>
                  {isAdmin && <TableHead className="w-[120px] text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((t) => (
                  <TransferRow
                    key={t.id}
                    transfer={t}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    isConfirming={confirmMutation.isPending}
                    isCancelling={cancelMutation.isPending}
                    isAdmin={isAdmin}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TransferRow({
  transfer,
  onConfirm,
  onCancel,
  isConfirming,
  isCancelling,
  isAdmin,
}: {
  transfer: Transfer;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  isConfirming: boolean;
  isCancelling: boolean;
  isAdmin: boolean;
}) {
  const style = STATUS_STYLES[transfer.status] || STATUS_STYLES.pending;
  const StatusIcon = style.icon;
  const isPending = transfer.status === 'pending';

  return (
    <TableRow>
      <TableCell className="font-mono text-sm font-medium">
        {transfer.plant?.fleet_number ?? '-'}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">
        {transfer.plant?.description ?? '-'}
      </TableCell>
      <TableCell className="text-sm">
        {transfer.from_location?.name ?? (
          <span className="text-muted-foreground">Unknown</span>
        )}
      </TableCell>
      <TableCell className="text-center">
        <ArrowRight className="h-4 w-4 text-muted-foreground mx-auto" />
      </TableCell>
      <TableCell className="text-sm">
        {transfer.to_location?.name ?? (
          <span className="text-muted-foreground">Unknown</span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={`text-xs ${style.className}`}>
          <StatusIcon className="h-3 w-3 mr-1" />
          {style.label}
        </Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground text-center">
        {transfer.source_week ? `Wk ${transfer.source_week}` : '-'}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {(() => {
          const dateStr = transfer.transfer_date || transfer.week_ending_date;
          if (!dateStr) return '-';
          return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          });
        })()}
      </TableCell>
      {isAdmin && <TableCell className="text-right">
        {isPending && isAdmin && (
          <div className="flex items-center justify-end gap-1">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={isConfirming}>
                  {isConfirming ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm Transfer</AlertDialogTitle>
                  <AlertDialogDescription>
                    Confirm that <strong>{transfer.plant?.fleet_number}</strong> has arrived at{' '}
                    <strong>{transfer.to_location?.name}</strong>? This will update the plant&apos;s
                    current location.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onConfirm(transfer.id)}>
                    Confirm Transfer
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" disabled={isCancelling}>
                  Cancel
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel Transfer</AlertDialogTitle>
                  <AlertDialogDescription>
                    Cancel the transfer of <strong>{transfer.plant?.fleet_number}</strong>?
                    The plant will stay at its current location.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => onCancel(transfer.id)}
                  >
                    Cancel Transfer
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </TableCell>}
    </TableRow>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorClass = {
    amber: 'text-amber-600',
    emerald: 'text-emerald-600',
    gray: 'text-gray-600',
    blue: 'text-blue-600',
  }[color] || '';

  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-xl font-bold ${colorClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function TableSkeleton() {
  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fleet No.</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>From</TableHead>
            <TableHead />
            <TableHead>To</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Week</TableHead>
            <TableHead>Date</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-32" /></TableCell>
              <TableCell><Skeleton className="h-5 w-24" /></TableCell>
              <TableCell><Skeleton className="h-5 w-4 mx-auto" /></TableCell>
              <TableCell><Skeleton className="h-5 w-24" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-10" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function TransfersPage() {
  return (
    <ProtectedRoute requiredRole="management">
      <TransfersPageContent />
    </ProtectedRoute>
  );
}
