'use client';

/**
 * Pagination Component
 * Simple pagination controls with page numbers
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

interface PaginationProps {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  itemLabel?: string;
}

export function Pagination({ meta, onPageChange, itemLabel = 'items' }: PaginationProps) {
  const { page, total, total_pages, limit } = meta;

  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  // Generate page numbers to show
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    const maxVisible = 5;

    if (total_pages <= maxVisible + 2) {
      // Show all pages
      for (let i = 1; i <= total_pages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (page > 3) {
        pages.push('ellipsis');
      }

      // Show pages around current
      const startPage = Math.max(2, page - 1);
      const endPage = Math.min(total_pages - 1, page + 1);

      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }

      if (page < total_pages - 2) {
        pages.push('ellipsis');
      }

      // Always show last page
      pages.push(total_pages);
    }

    return pages;
  };

  if (total_pages <= 1) {
    return (
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Showing {total} {itemLabel}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        Showing {start} to {end} of {total} {itemLabel}
      </p>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          className="h-8 w-8"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {getPageNumbers().map((pageNum, idx) =>
          pageNum === 'ellipsis' ? (
            <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground">
              ...
            </span>
          ) : (
            <Button
              key={pageNum}
              variant={pageNum === page ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPageChange(pageNum)}
              className="h-8 w-8 p-0"
            >
              {pageNum}
            </Button>
          )
        )}

        <Button
          variant="outline"
          size="icon"
          onClick={() => onPageChange(page + 1)}
          disabled={page === total_pages}
          className="h-8 w-8"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
