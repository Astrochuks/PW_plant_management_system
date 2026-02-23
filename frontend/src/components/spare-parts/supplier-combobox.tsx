'use client';

import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useSuppliers } from '@/hooks/use-suppliers';

interface SupplierComboboxProps {
  value: string;
  supplierId: string;
  onChange: (name: string, id: string | null) => void;
}

export function SupplierCombobox({ value, supplierId, onChange }: SupplierComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Load all active suppliers once (cached by React Query, backend max 200)
  const { data, isLoading } = useSuppliers({ limit: 200 });
  const suppliers = data?.data ?? [];

  // Filter locally for instant results
  const filtered = useMemo(() => {
    if (!search) return suppliers;
    const q = search.toLowerCase();
    return suppliers.filter((s) => s.name.toLowerCase().includes(q));
  }, [suppliers, search]);

  const handleSelect = (id: string) => {
    const supplier = suppliers.find((s) => s.id === id);
    if (supplier) {
      onChange(supplier.name, supplier.id);
      setSearch('');
      setOpen(false);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('', null);
    setSearch('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative flex items-center">
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'w-full justify-between font-normal h-9',
              value && 'pr-14'
            )}
          >
            {value ? (
              <span className="flex items-center gap-2 truncate">
                {supplierId ? (
                  <Check className="h-3 w-3 shrink-0 text-green-600" />
                ) : (
                  <span className="text-xs text-amber-600 font-medium shrink-0">(New)</span>
                )}
                {value}
              </span>
            ) : (
              <span className="text-muted-foreground">Select or type supplier name...</span>
            )}
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground ml-2" />
          </Button>
        </PopoverTrigger>
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-8 p-1 rounded-sm hover:bg-accent"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search suppliers..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {isLoading && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!isLoading && filtered.length === 0 && search.length > 0 && (
              <CommandEmpty>
                No matching suppliers found.
              </CommandEmpty>
            )}
            {!isLoading && filtered.length === 0 && search.length === 0 && suppliers.length === 0 && (
              <CommandEmpty>
                No suppliers yet.
              </CommandEmpty>
            )}
            {/* Option to use typed text as new supplier */}
            {search.length >= 2 && !filtered.some((s) => s.name.toLowerCase() === search.toLowerCase()) && (
              <CommandGroup heading="New supplier">
                <CommandItem
                  value={`new:${search}`}
                  onSelect={() => {
                    onChange(search, null);
                    setSearch('');
                    setOpen(false);
                  }}
                  className="cursor-pointer"
                >
                  <span className="text-xs text-amber-600 font-medium mr-1">(New)</span>
                  Create &quot;{search}&quot;
                </CommandItem>
              </CommandGroup>
            )}
            {filtered.length > 0 && (
              <CommandGroup heading={`Suppliers (${filtered.length})`}>
                {filtered.map((supplier) => (
                  <CommandItem
                    key={supplier.id}
                    value={supplier.id}
                    onSelect={handleSelect}
                    className="cursor-pointer"
                  >
                    <Check
                      className={cn(
                        'h-4 w-4 shrink-0',
                        supplierId === supplier.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="truncate">{supplier.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
