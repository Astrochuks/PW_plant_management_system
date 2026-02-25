'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { format } from 'date-fns'
import { Search } from 'lucide-react'
import { useDebounce } from '@/hooks/use-debounce'

export interface MaintenanceRecord {
  id: string
  part_description: string
  supplier: string | null
  part_number: string | null
  reason_for_change: string | null
  unit_cost: number | null
  quantity: number | null
  total_cost: number | null
  replaced_date: string
  purchase_order_number: string | null
  remarks: string | null
  shared_fleet_numbers?: string[] | null
  cost_type?: string | null
}

interface PlantMaintenanceTableProps {
  records: MaintenanceRecord[]
  isLoading?: boolean
  onRowClick?: (record: MaintenanceRecord) => void
}

export function PlantMaintenanceTable({ records, isLoading, onRowClick }: PlantMaintenanceTableProps) {
  const [searchTerm, setSearchTerm] = useState('')

  // Debounce search with 300ms delay
  const debouncedSearch = useDebounce(searchTerm, 300)

  // Filter records based on search term
  const filteredRecords = useMemo(() => {
    if (!debouncedSearch.trim()) return records

    const term = debouncedSearch.toLowerCase()
    return records.filter(
      (record) =>
        record.part_description?.toLowerCase().includes(term) ||
        record.supplier?.toLowerCase().includes(term) ||
        record.purchase_order_number?.toLowerCase().includes(term) ||
        record.remarks?.toLowerCase().includes(term)
    )
  }, [records, debouncedSearch])

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search spare parts (description, supplier, PO number)..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Results Count */}
      {searchTerm && (
        <div className="text-sm text-muted-foreground">
          Found {filteredRecords.length} of {records.length} maintenance records
        </div>
      )}

      {/* Table */}
      {filteredRecords.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          {records.length === 0 ? 'No maintenance records' : 'No records match your search'}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Part Description</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Cost (₦)</TableHead>
                <TableHead>Date Replaced</TableHead>
                <TableHead>PO Number</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.map((record) => (
                <TableRow
                  key={record.id}
                  className={onRowClick ? 'cursor-pointer hover:bg-muted/50' : ''}
                  onClick={() => onRowClick?.(record)}
                >
                  <TableCell>
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {record.part_description}
                        {record.cost_type === 'shared' && record.shared_fleet_numbers && record.shared_fleet_numbers.length > 0 && (
                          <Badge variant="outline" className="text-xs font-normal shrink-0">
                            Shared: {record.shared_fleet_numbers.join(', ')}
                          </Badge>
                        )}
                      </div>
                      {record.remarks && (
                        <div className="text-sm text-muted-foreground mt-1">{record.remarks}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {record.supplier ? (
                      <Badge variant="outline">{record.supplier}</Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    {record.total_cost != null
                      ? record.total_cost.toLocaleString('en-NG', {
                          style: 'currency',
                          currency: 'NGN',
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })
                      : '-'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {format(new Date(record.replaced_date), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell>
                    {record.purchase_order_number ? (
                      <Link
                        href={`/spare-parts/po/${encodeURIComponent(record.purchase_order_number)}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Badge variant="secondary" className="hover:bg-primary/20 cursor-pointer">
                          {record.purchase_order_number}
                        </Badge>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
