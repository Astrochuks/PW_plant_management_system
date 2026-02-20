'use client';

/**
 * PO Entry / Bulk Create Page
 * Form for creating a purchase order with multiple line items
 */

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Loader2,
  HelpCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { useBulkCreateSpareParts, type BulkCreateRequest } from '@/hooks/use-spare-parts';
import { useLocationsWithStats } from '@/hooks/use-locations';
import { ProtectedRoute } from '@/components/protected-route';

interface FormState {
  purchase_order_number: string;
  fleet_numbers: string;
  items: string;
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
  items: '',
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

function POCreateForm() {
  const router = useRouter();
  const bulkCreate = useBulkCreateSpareParts();
  const { data: locations } = useLocationsWithStats();

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [vatMode, setVatMode] = useState<'percentage' | 'amount'>('percentage');
  const [discountMode, setDiscountMode] = useState<'percentage' | 'amount'>('percentage');

  const updateField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      // Validate required fields
      if (!form.purchase_order_number.trim()) {
        toast.error('PO Number is required');
        return;
      }
      if (!form.fleet_numbers.trim()) {
        toast.error('Fleet numbers are required');
        return;
      }
      if (!form.items.trim()) {
        toast.error('At least one item is required');
        return;
      }

      const payload: BulkCreateRequest = {
        purchase_order_number: form.purchase_order_number.trim(),
        fleet_numbers: form.fleet_numbers.trim(),
        items: form.items.trim(),
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
          const count = result.data?.length ?? 0;
          toast.success(`Created ${count} spare part records for PO ${form.purchase_order_number}`);
          router.push(`/spare-parts/po/${encodeURIComponent(form.purchase_order_number)}`);
        },
        onError: (err) => {
          toast.error(
            `Failed to create PO: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
        },
      });
    },
    [form, vatMode, discountMode, bulkCreate, router]
  );

  return (
    <div className="space-y-6 max-w-3xl">
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
                  required
                />
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
                <Label htmlFor="supplier">Supplier Name</Label>
                <Input
                  id="supplier"
                  placeholder="Enter supplier name"
                  value={form.supplier}
                  onChange={(e) => updateField('supplier', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Will auto-match or create a new supplier
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
                  <p className="mb-2">
                    Format: <code>description|qty|cost|part_no</code>
                  </p>
                  <p className="mb-1">Separate items with semicolons or new lines.</p>
                  <p className="text-xs">
                    Example:<br />
                    Oil Filter|2|5000|OF-123;<br />
                    Brake Pad|4|8500|BP-456
                  </p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder={`Oil Filter|2|5000|OF-123\nBrake Pad|4|8500|BP-456\nFan Belt|1|3200`}
              value={form.items}
              onChange={(e) => updateField('items', e.target.value)}
              rows={6}
              className="font-mono text-sm"
              required
            />
            <p className="text-xs text-muted-foreground mt-2">
              Format: <code>description|quantity|unit_cost|part_number</code> (part_number is optional).
              One item per line or separate with semicolons.
            </p>
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
                Creating...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Create Purchase Order
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
