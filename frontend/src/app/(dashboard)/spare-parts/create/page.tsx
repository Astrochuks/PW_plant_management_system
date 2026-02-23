'use client';

/**
 * PO Entry / Bulk Create Page
 * Form for creating a purchase order with structured line items
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Loader2,
  HelpCircle,
  Trash2,
  Upload,
  FileText,
  X,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useBulkCreateSpareParts, useUploadPODocument, useAutocompletePONumbers, type BulkCreateRequest } from '@/hooks/use-spare-parts';
import { useLocationsWithStats } from '@/hooks/use-locations';
import { ProtectedRoute } from '@/components/protected-route';
import { SupplierCombobox } from '@/components/spare-parts/supplier-combobox';

// ============================================================================
// Types
// ============================================================================

interface LineItem {
  id: string;
  description: string;
  quantity: string;
  unit_cost: string;
  part_number: string;
  fleet: string;
}

interface FormState {
  purchase_order_number: string;
  fleet_numbers: string;
  po_date: string;
  supplier: string;
  supplier_id: string;
  location_id: string;
  vat_percentage: string;
  vat_amount: string;
  discount_percentage: string;
  discount_amount: string;
  other_costs: string;
  requisition_number: string;
}

const INITIAL_FORM: FormState = {
  purchase_order_number: '',
  fleet_numbers: '',
  po_date: '',
  supplier: '',
  supplier_id: '',
  location_id: '',
  vat_percentage: '',
  vat_amount: '',
  discount_percentage: '',
  discount_amount: '',
  other_costs: '',
  requisition_number: '',
};

// ============================================================================
// Helpers
// ============================================================================

function createEmptyItem(): LineItem {
  return {
    id: crypto.randomUUID(),
    description: '',
    quantity: '1',
    unit_cost: '',
    part_number: '',
    fleet: '',
  };
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ============================================================================
// Component
// ============================================================================

function POCreateForm() {
  const router = useRouter();
  const bulkCreate = useBulkCreateSpareParts();
  const uploadDoc = useUploadPODocument();
  const { data: locations } = useLocationsWithStats();

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [lineItems, setLineItems] = useState<LineItem[]>([createEmptyItem()]);
  const [vatMode, setVatMode] = useState<'percentage' | 'amount'>('percentage');
  const [discountMode, setDiscountMode] = useState<'percentage' | 'amount'>('percentage');
  const [poDocument, setPoDocument] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live PO existence check
  const poQuery = form.purchase_order_number.trim().toUpperCase();
  const { data: poSuggestions } = useAutocompletePONumbers(poQuery);
  const existingPO = useMemo(() => {
    if (!poQuery || !poSuggestions) return null;
    return poSuggestions.find(
      (s) => s.po_number.toUpperCase() === poQuery
    ) ?? null;
  }, [poQuery, poSuggestions]);

  const updateField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const updateLineItem = useCallback(
    (id: string, field: keyof LineItem, value: string) => {
      setLineItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
      );
    },
    []
  );

  const addLineItem = useCallback(() => {
    setLineItems((prev) => [...prev, createEmptyItem()]);
  }, []);

  const removeLineItem = useCallback((id: string) => {
    setLineItems((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  // Compute subtotal from line items
  const { subtotal, validCount } = useMemo(() => {
    let total = 0;
    let count = 0;
    for (const item of lineItems) {
      if (item.description.trim()) {
        const qty = Number(item.quantity) || 1;
        const cost = Number(item.unit_cost) || 0;
        total += qty * cost;
        count++;
      }
    }
    return { subtotal: total, validCount: count };
  }, [lineItems]);

  // Compute real-time cost breakdown
  const costBreakdown = useMemo(() => {
    const vatValue =
      vatMode === 'percentage' && form.vat_percentage
        ? subtotal * Number(form.vat_percentage) / 100
        : vatMode === 'amount' && form.vat_amount
          ? Number(form.vat_amount)
          : 0;
    const discountValue =
      discountMode === 'percentage' && form.discount_percentage
        ? subtotal * Number(form.discount_percentage) / 100
        : discountMode === 'amount' && form.discount_amount
          ? Number(form.discount_amount)
          : 0;
    const otherValue = form.other_costs ? Number(form.other_costs) : 0;
    const grandTotal = subtotal + vatValue - discountValue + otherValue;
    return { vatValue, discountValue, otherValue, grandTotal };
  }, [subtotal, vatMode, discountMode, form.vat_percentage, form.vat_amount, form.discount_percentage, form.discount_amount, form.other_costs]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      if (!form.purchase_order_number.trim()) {
        toast.error('PO Number is required');
        return;
      }
      if (!form.fleet_numbers.trim()) {
        toast.error('Fleet numbers are required');
        return;
      }

      const validItems = lineItems.filter((item) => item.description.trim());
      if (validItems.length === 0) {
        toast.error('At least one item with a description is required');
        return;
      }

      // Serialize line items as JSON array (backend auto-detects)
      const itemsJson = JSON.stringify(
        validItems.map((item) => ({
          description: item.description.trim(),
          quantity: Number(item.quantity) || 1,
          unit_cost: Number(item.unit_cost) || 0,
          part_number: item.part_number.trim() || undefined,
          item_fleet: item.fleet.trim() || undefined,
        }))
      );

      const payload: BulkCreateRequest = {
        purchase_order_number: form.purchase_order_number.trim(),
        fleet_numbers: form.fleet_numbers.trim(),
        items: itemsJson,
      };

      if (form.po_date) payload.po_date = form.po_date;
      if (form.requisition_number) payload.requisition_number = form.requisition_number;
      if (form.location_id) payload.location_id = form.location_id;
      if (form.supplier_id) payload.supplier_id = form.supplier_id;
      else if (form.supplier) payload.supplier = form.supplier;

      if (vatMode === 'percentage' && form.vat_percentage) {
        payload.vat_percentage = Number(form.vat_percentage);
      } else if (vatMode === 'amount' && form.vat_amount) {
        payload.vat_amount = Number(form.vat_amount);
      }

      if (discountMode === 'percentage' && form.discount_percentage) {
        payload.discount_percentage = Number(form.discount_percentage);
      } else if (discountMode === 'amount' && form.discount_amount) {
        payload.discount_amount = Number(form.discount_amount);
      }

      if (form.other_costs) payload.other_costs = Number(form.other_costs);

      bulkCreate.mutate(payload, {
        onSuccess: (result) => {
          const meta = result.meta as Record<string, number> | undefined;
          const count = meta?.records_created ?? result.data?.length ?? 0;
          toast.success(
            existingPO
              ? `Added ${count} items to existing PO ${form.purchase_order_number}`
              : `Created ${count} spare part records for PO ${form.purchase_order_number}`
          );

          // Upload document in background — don't block navigation
          if (poDocument) {
            const poNum = form.purchase_order_number.trim();
            uploadDoc.mutate(
              { poNumber: poNum, file: poDocument },
              {
                onSuccess: () => toast.success('PO document uploaded'),
                onError: () => toast.error('Document upload failed. You can upload it later from the PO page.'),
              }
            );
          }

          // Navigate immediately — don't wait for document upload
          router.push(`/spare-parts/po/${encodeURIComponent(form.purchase_order_number)}`);
        },
        onError: (err) => {
          toast.error(
            `Failed to create PO: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
        },
      });
    },
    [form, lineItems, vatMode, discountMode, bulkCreate, uploadDoc, poDocument, router, existingPO]
  );

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <Link
          href="/spare-parts/pos"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Purchase Orders
        </Link>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Plus className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">New PO Entry</h1>
            <p className="text-sm text-muted-foreground">
              Add a purchase order with multiple line items
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* PO Details */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">PO Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="po_number">PO Number *</Label>
                <Input
                  id="po_number"
                  placeholder="e.g. PO-2024-001"
                  value={form.purchase_order_number}
                  onChange={(e) => updateField('purchase_order_number', e.target.value)}
                  className={existingPO ? 'border-amber-500 focus-visible:ring-amber-500' : ''}
                  required
                />
                {existingPO && (
                  <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                        PO already exists
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                        {existingPO.items_count} item{existingPO.items_count !== 1 ? 's' : ''}
                        {existingPO.suppliers && existingPO.suppliers.length > 0 && (
                          <> from {existingPO.suppliers.join(', ')}</>
                        )}
                        {existingPO.total_cost ? (
                          <> — ₦{formatCurrency(existingPO.total_cost)}</>
                        ) : null}
                      </p>
                      <div className="flex items-center gap-3 mt-2">
                        <Link
                          href={`/spare-parts/po/${encodeURIComponent(existingPO.po_number)}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 underline underline-offset-2"
                        >
                          View existing PO <ExternalLink className="h-3 w-3" />
                        </Link>
                        <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300">
                          Submitting will add items to this PO
                        </Badge>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="po_date">PO Date</Label>
                <Input
                  id="po_date"
                  type="date"
                  value={form.po_date}
                  onChange={(e) => updateField('po_date', e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Supplier Name</Label>
                <SupplierCombobox
                  value={form.supplier}
                  supplierId={form.supplier_id}
                  onChange={(name, id) => {
                    updateField('supplier', name);
                    updateField('supplier_id', id ?? '');
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Start typing to search existing suppliers, or enter a new name
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Select
                  value={form.location_id}
                  onValueChange={(v) => updateField('location_id', v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations?.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.location_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="requisition">Requisition Number</Label>
              <Input
                id="requisition"
                placeholder="Optional"
                value={form.requisition_number}
                onChange={(e) => updateField('requisition_number', e.target.value)}
                className="max-w-sm"
              />
            </div>
          </CardContent>
        </Card>

        {/* Fleet Numbers */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              Fleet Numbers *
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p>
                    Enter fleet numbers separated by commas. Use &quot;WORKSHOP&quot; for workshop items
                    or a category name for shared costs.
                  </p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="e.g. PW-001, PW-002, PW-003 or WORKSHOP"
              value={form.fleet_numbers}
              onChange={(e) => updateField('fleet_numbers', e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground mt-2">
              Comma-separated. If multiple fleets, costs are shared across all.
            </p>
          </CardContent>
        </Card>

        {/* Line Items */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              Line Items *
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-sm">
                  <p>
                    Add each item individually. Use the + button to add more rows.
                    The &quot;Fleet&quot; field is optional — use it to assign a specific item
                    to a fleet (for direct cost tracking).
                  </p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Column headers */}
            <div className="hidden sm:grid sm:grid-cols-[1fr_5rem_6.5rem_7rem_5.5rem_2rem] gap-2 text-xs font-medium text-muted-foreground px-1">
              <span>Description *</span>
              <span>Qty</span>
              <span>Unit Cost</span>
              <span>Part No.</span>
              <span>Fleet</span>
              <span></span>
            </div>

            {/* Item rows */}
            {lineItems.map((item, index) => (
              <div
                key={item.id}
                className="grid grid-cols-1 sm:grid-cols-[1fr_5rem_6.5rem_7rem_5.5rem_2rem] gap-2 items-start p-3 sm:p-0 rounded-lg sm:rounded-none border sm:border-0 bg-muted/30 sm:bg-transparent"
              >
                <div>
                  <Label className="sm:hidden text-xs text-muted-foreground mb-1">Description *</Label>
                  <Input
                    placeholder={`Item ${index + 1} description`}
                    value={item.description}
                    onChange={(e) => updateLineItem(item.id, 'description', e.target.value)}
                  />
                </div>
                <div>
                  <Label className="sm:hidden text-xs text-muted-foreground mb-1">Qty</Label>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="1"
                    value={item.quantity}
                    onChange={(e) => updateLineItem(item.id, 'quantity', e.target.value)}
                  />
                </div>
                <div>
                  <Label className="sm:hidden text-xs text-muted-foreground mb-1">Unit Cost</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={item.unit_cost}
                    onChange={(e) => updateLineItem(item.id, 'unit_cost', e.target.value)}
                  />
                </div>
                <div>
                  <Label className="sm:hidden text-xs text-muted-foreground mb-1">Part No.</Label>
                  <Input
                    placeholder="Optional"
                    value={item.part_number}
                    onChange={(e) => updateLineItem(item.id, 'part_number', e.target.value)}
                  />
                </div>
                <div>
                  <Label className="sm:hidden text-xs text-muted-foreground mb-1">Fleet</Label>
                  <Input
                    placeholder="e.g. T468"
                    value={item.fleet}
                    onChange={(e) => updateLineItem(item.id, 'fleet', e.target.value)}
                  />
                </div>
                <div className="flex items-center justify-end sm:justify-center pt-1 sm:pt-0">
                  {lineItems.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removeLineItem(item.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}

            {/* Add item + subtotal */}
            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addLineItem}
                className="gap-1.5"
              >
                <Plus className="h-4 w-4" />
                Add Item
              </Button>
              {subtotal > 0 && (
                <div className="text-sm text-muted-foreground">
                  Subtotal:{' '}
                  <span className="font-semibold text-foreground">
                    ₦{formatCurrency(subtotal)}
                  </span>{' '}
                  ({validCount} {validCount === 1 ? 'item' : 'items'})
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Cost Adjustments */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cost Adjustments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* VAT */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Label>VAT</Label>
                <Select
                  value={vatMode}
                  onValueChange={(v) => setVatMode(v as 'percentage' | 'amount')}
                >
                  <SelectTrigger className="w-[140px]" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage</SelectItem>
                    <SelectItem value="amount">Fixed Amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {vatMode === 'percentage' ? (
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  placeholder="e.g. 7.5"
                  value={form.vat_percentage}
                  onChange={(e) => updateField('vat_percentage', e.target.value)}
                  className="max-w-[200px]"
                />
              ) : (
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Total VAT amount"
                  value={form.vat_amount}
                  onChange={(e) => updateField('vat_amount', e.target.value)}
                  className="max-w-[200px]"
                />
              )}
            </div>

            <Separator />

            {/* Discount */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Label>Discount</Label>
                <Select
                  value={discountMode}
                  onValueChange={(v) => setDiscountMode(v as 'percentage' | 'amount')}
                >
                  <SelectTrigger className="w-[140px]" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage</SelectItem>
                    <SelectItem value="amount">Fixed Amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {discountMode === 'percentage' ? (
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  placeholder="e.g. 5"
                  value={form.discount_percentage}
                  onChange={(e) => updateField('discount_percentage', e.target.value)}
                  className="max-w-[200px]"
                />
              ) : (
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Total discount amount"
                  value={form.discount_amount}
                  onChange={(e) => updateField('discount_amount', e.target.value)}
                  className="max-w-[200px]"
                />
              )}
            </div>

            <Separator />

            {/* Other Costs */}
            <div className="space-y-2">
              <Label>Other Costs</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 1500"
                value={form.other_costs}
                onChange={(e) => updateField('other_costs', e.target.value)}
                className="max-w-[200px]"
              />
            </div>

            {/* Live Cost Breakdown */}
            {subtotal > 0 && (costBreakdown.vatValue > 0 || costBreakdown.discountValue > 0 || costBreakdown.otherValue > 0) && (
              <>
                <Separator />
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>₦{formatCurrency(subtotal)}</span>
                  </div>
                  {costBreakdown.vatValue > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        + VAT{vatMode === 'percentage' && form.vat_percentage ? ` (${form.vat_percentage}%)` : ''}
                      </span>
                      <span className="text-green-600 dark:text-green-400">
                        +₦{formatCurrency(costBreakdown.vatValue)}
                      </span>
                    </div>
                  )}
                  {costBreakdown.discountValue > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        - Discount{discountMode === 'percentage' && form.discount_percentage ? ` (${form.discount_percentage}%)` : ''}
                      </span>
                      <span className="text-red-600 dark:text-red-400">
                        -₦{formatCurrency(costBreakdown.discountValue)}
                      </span>
                    </div>
                  )}
                  {costBreakdown.otherValue > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">+ Other Costs</span>
                      <span>+₦{formatCurrency(costBreakdown.otherValue)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between font-semibold text-base">
                    <span>Grand Total</span>
                    <span>₦{formatCurrency(costBreakdown.grandTotal)}</span>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* PO Document (Optional) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">PO Document (Optional)</CardTitle>
          </CardHeader>
          <CardContent>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setPoDocument(file);
              }}
            />
            {poDocument ? (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                <FileText className="h-5 w-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{poDocument.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(poDocument.size / 1024).toFixed(0)} KB
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    setPoDocument(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                Attach PO Document
              </Button>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              PDF or image of the purchase order. You can also upload this later.
            </p>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={bulkCreate.isPending}>
            {bulkCreate.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {existingPO ? 'Adding Items...' : 'Creating...'}
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                {existingPO ? 'Add Items to Existing PO' : 'Create Purchase Order'}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function POCreatePage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <POCreateForm />
    </ProtectedRoute>
  );
}
