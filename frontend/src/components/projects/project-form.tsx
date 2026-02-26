'use client'

import { useRouter } from 'next/navigation'
import { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { useCreateProject, useUpdateProject } from '@/hooks/use-projects'
import { useStates } from '@/hooks/use-locations'
import type { Project, CreateProjectRequest } from '@/lib/api/projects'

interface ProjectFormProps {
  project?: Project
  mode: 'create' | 'edit'
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'retention_period', label: 'Retention Period' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'cancelled', label: 'Cancelled' },
]

function buildInitialForm(project?: Project): Record<string, any> {
  return {
    project_name: project?.project_name ?? '',
    client: project?.client ?? '',
    short_name: project?.short_name ?? '',
    state_id: project?.state_id ?? '',
    status: project?.status ?? 'active',
    is_legacy: project?.is_legacy ?? false,
    original_contract_sum: project?.original_contract_sum ?? '',
    variation_sum: project?.variation_sum ?? '',
    current_contract_sum: project?.current_contract_sum ?? '',
    has_award_letter: project?.has_award_letter ?? false,
    award_date: project?.award_date ?? '',
    commencement_date: project?.commencement_date ?? '',
    original_duration_months: project?.original_duration_months ?? '',
    original_completion_date: project?.original_completion_date ?? '',
    extension_of_time_months: project?.extension_of_time_months ?? '',
    revised_completion_date: project?.revised_completion_date ?? '',
    substantial_completion_cert: project?.substantial_completion_cert ?? '',
    substantial_completion_date: project?.substantial_completion_date ?? '',
    final_completion_cert: project?.final_completion_cert ?? '',
    final_completion_date: project?.final_completion_date ?? '',
    maintenance_cert: project?.maintenance_cert ?? '',
    maintenance_cert_date: project?.maintenance_cert_date ?? '',
    retention_application_date: project?.retention_application_date ?? '',
    retention_paid: project?.retention_paid ?? '',
    retention_amount_paid: project?.retention_amount_paid ?? '',
    works_vetted_certified: project?.works_vetted_certified ?? '',
    payment_received: project?.payment_received ?? '',
    outstanding_payment: project?.outstanding_payment ?? '',
    cost_to_date: project?.cost_to_date ?? '',
    revenue_to_date: project?.revenue_to_date ?? '',
    notes: project?.notes ?? '',
  }
}

const NUMERIC_FIELDS = [
  'original_contract_sum', 'variation_sum', 'current_contract_sum',
  'original_duration_months', 'extension_of_time_months',
  'retention_amount_paid', 'works_vetted_certified', 'payment_received',
  'outstanding_payment', 'cost_to_date', 'revenue_to_date',
]

export function ProjectForm({ project, mode }: ProjectFormProps) {
  const router = useRouter()
  const createMutation = useCreateProject()
  const updateMutation = useUpdateProject(project?.id ?? '')
  const { data: statesData } = useStates()
  const states = Array.isArray(statesData) ? statesData : []

  const [initialForm] = useState(() => buildInitialForm(project))
  const [form, setForm] = useState<Record<string, any>>(() => buildInitialForm(project))

  // Collapsible sections (in edit mode, start collapsed except Identification)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    mode === 'edit'
      ? { identification: true, contract: false, dates: false, certification: false, retention: false, financial: false, notes: false }
      : { identification: true, contract: true, dates: true, certification: true, retention: true, financial: true, notes: true }
  )

  // Track changed fields
  const changedFields = useMemo(() => {
    if (mode === 'create') return new Set<string>()
    const changed = new Set<string>()
    for (const key of Object.keys(form)) {
      const curr = String(form[key] ?? '')
      const init = String(initialForm[key] ?? '')
      if (curr !== init) changed.add(key)
    }
    return changed
  }, [form, initialForm, mode])

  const changedCount = changedFields.size

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  const handleChange = (field: string, value: any) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value }
      // Auto-compute current_contract_sum when original or variation changes
      if (field === 'original_contract_sum' || field === 'variation_sum') {
        const original = Number(next.original_contract_sum) || 0
        const variation = Number(next.variation_sum) || 0
        if (original > 0) {
          next.current_contract_sum = original + variation
        }
      }
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!form.project_name.trim() || !form.client.trim()) {
      toast.error('Project name and client are required')
      return
    }

    // Build payload — only include non-empty values
    const payload: Record<string, any> = {}
    for (const [key, value] of Object.entries(form)) {
      if (value === '' || value === null || value === undefined) continue
      if (key === 'state_id' && value === 'none') continue
      if (NUMERIC_FIELDS.includes(key)) {
        const num = Number(value)
        if (!isNaN(num)) payload[key] = num
        continue
      }
      payload[key] = value
    }

    try {
      if (mode === 'create') {
        const created = await createMutation.mutateAsync(payload as CreateProjectRequest)
        toast.success('Project created successfully')
        router.push(`/projects/${created.id}`)
      } else {
        await updateMutation.mutateAsync(payload)
        toast.success('Project updated successfully')
        router.push(`/projects/${project!.id}`)
      }
    } catch {
      toast.error(mode === 'create' ? 'Failed to create project' : 'Failed to update project')
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  function FieldDot({ field }: { field: string }) {
    if (mode === 'create' || !changedFields.has(field)) return null
    return <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-blue-500" />
  }

  function SectionHeader({ id, label }: { id: string; label: string }) {
    const isOpen = openSections[id]
    // Count changed fields in this section
    const sectionFields = SECTION_FIELDS[id] ?? []
    const sectionChanges = mode === 'edit' ? sectionFields.filter((f) => changedFields.has(f)).length : 0
    return (
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => toggleSection(id)}
      >
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {label}
          </span>
          {sectionChanges > 0 && (
            <span className="text-xs font-normal text-blue-600">{sectionChanges} changed</span>
          )}
        </CardTitle>
      </CardHeader>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl pb-20">
      {/* Identification */}
      <Card>
        <SectionHeader id="identification" label="Identification" />
        {openSections.identification && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 relative">
                <FieldDot field="project_name" />
                <Label htmlFor="project_name">Project Name *</Label>
                <Input
                  id="project_name"
                  value={form.project_name}
                  onChange={(e) => handleChange('project_name', e.target.value)}
                  placeholder="e.g. Construction of 6th Bridge over River Kaduna"
                  required
                />
              </div>
              <div className="relative">
                <FieldDot field="client" />
                <Label htmlFor="client">Client *</Label>
                <Input
                  id="client"
                  value={form.client}
                  onChange={(e) => handleChange('client', e.target.value)}
                  placeholder="e.g. FERMA"
                  required
                />
              </div>
              <div className="relative">
                <FieldDot field="short_name" />
                <Label htmlFor="short_name">Short Name</Label>
                <Input
                  id="short_name"
                  value={form.short_name}
                  onChange={(e) => handleChange('short_name', e.target.value)}
                  placeholder="e.g. 6th Bridge Kaduna"
                />
              </div>
              <div className="relative">
                <FieldDot field="state_id" />
                <Label htmlFor="state_id">State</Label>
                <Select
                  value={form.state_id || 'none'}
                  onValueChange={(v) => handleChange('state_id', v === 'none' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No state</SelectItem>
                    {(Array.isArray(states) ? states : []).map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="relative">
                <FieldDot field="status" />
                <Label htmlFor="status">Status</Label>
                <Select value={form.status} onValueChange={(v) => handleChange('status', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {mode === 'edit' && (
              <>
                <Separator />
                <div className="flex items-center gap-3">
                  <Switch
                    checked={form.is_legacy}
                    onCheckedChange={(v) => handleChange('is_legacy', v)}
                  />
                  <Label>Legacy Project</Label>
                  <span className="text-xs text-muted-foreground">Mark as legacy/historical record</span>
                </div>
              </>
            )}
          </CardContent>
        )}
      </Card>

      {/* Contract */}
      <Card>
        <SectionHeader id="contract" label="Contract Details" />
        {openSections.contract && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <FieldDot field="original_contract_sum" />
                <Label htmlFor="original_contract_sum">Original Contract Sum (₦)</Label>
                <Input
                  id="original_contract_sum"
                  type="number"
                  step="0.01"
                  value={form.original_contract_sum}
                  onChange={(e) => handleChange('original_contract_sum', e.target.value)}
                />
              </div>
              <div className="relative">
                <FieldDot field="variation_sum" />
                <Label htmlFor="variation_sum">Variation Sum (₦)</Label>
                <Input
                  id="variation_sum"
                  type="number"
                  step="0.01"
                  value={form.variation_sum}
                  onChange={(e) => handleChange('variation_sum', e.target.value)}
                />
              </div>
              <div className="relative">
                <FieldDot field="current_contract_sum" />
                <Label htmlFor="current_contract_sum">Current Contract Sum (₦)</Label>
                <Input
                  id="current_contract_sum"
                  type="number"
                  step="0.01"
                  value={form.current_contract_sum}
                  onChange={(e) => handleChange('current_contract_sum', e.target.value)}
                />
                {Number(form.original_contract_sum) > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Auto-computed: {Number(form.original_contract_sum) || 0} + {Number(form.variation_sum) || 0}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Dates & Duration */}
      <Card>
        <SectionHeader id="dates" label="Dates & Duration" />
        {openSections.dates && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <FieldDot field="award_date" />
                <Label htmlFor="award_date">Award Date</Label>
                <Input
                  id="award_date"
                  type="date"
                  value={form.award_date}
                  onChange={(e) => handleChange('award_date', e.target.value)}
                />
              </div>
              <div className="relative">
                <FieldDot field="commencement_date" />
                <Label htmlFor="commencement_date">Commencement Date</Label>
                <Input
                  id="commencement_date"
                  type="date"
                  value={form.commencement_date}
                  onChange={(e) => handleChange('commencement_date', e.target.value)}
                />
              </div>
              <div className="relative">
                <FieldDot field="original_duration_months" />
                <Label htmlFor="original_duration_months">Original Duration (months)</Label>
                <Input
                  id="original_duration_months"
                  type="number"
                  value={form.original_duration_months}
                  onChange={(e) => handleChange('original_duration_months', e.target.value)}
                />
              </div>
              <div className="relative">
                <FieldDot field="original_completion_date" />
                <Label htmlFor="original_completion_date">Original Completion Date</Label>
                <Input
                  id="original_completion_date"
                  type="date"
                  value={form.original_completion_date}
                  onChange={(e) => handleChange('original_completion_date', e.target.value)}
                />
              </div>
              <div className="relative">
                <FieldDot field="extension_of_time_months" />
                <Label htmlFor="extension_of_time_months">Extension of Time (months)</Label>
                <Input
                  id="extension_of_time_months"
                  type="number"
                  value={form.extension_of_time_months}
                  onChange={(e) => handleChange('extension_of_time_months', e.target.value)}
                />
              </div>
              <div className="relative">
                <FieldDot field="revised_completion_date" />
                <Label htmlFor="revised_completion_date">Revised Completion Date</Label>
                <Input
                  id="revised_completion_date"
                  type="date"
                  value={form.revised_completion_date}
                  onChange={(e) => handleChange('revised_completion_date', e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Certification */}
      <Card>
        <SectionHeader id="certification" label="Certification" />
        {openSections.certification && (
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                checked={form.has_award_letter}
                onCheckedChange={(v) => handleChange('has_award_letter', v)}
              />
              <Label>Has Award Letter</Label>
            </div>
            <Separator />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="relative">
                <FieldDot field="substantial_completion_cert" />
                <Label>Substantial Completion</Label>
                <Input
                  value={form.substantial_completion_cert}
                  onChange={(e) => handleChange('substantial_completion_cert', e.target.value)}
                  placeholder="e.g. yes, ongoing, pending"
                />
              </div>
              <div className="relative">
                <FieldDot field="substantial_completion_date" />
                <Label>Substantial Completion Date</Label>
                <Input
                  type="date"
                  value={form.substantial_completion_date}
                  onChange={(e) => handleChange('substantial_completion_date', e.target.value)}
                />
              </div>
              <div className="relative">
                <FieldDot field="final_completion_cert" />
                <Label>Final Completion</Label>
                <Input
                  value={form.final_completion_cert}
                  onChange={(e) => handleChange('final_completion_cert', e.target.value)}
                  placeholder="e.g. yes, none"
                />
              </div>
              <div className="relative">
                <FieldDot field="final_completion_date" />
                <Label>Final Completion Date</Label>
                <Input
                  type="date"
                  value={form.final_completion_date}
                  onChange={(e) => handleChange('final_completion_date', e.target.value)}
                />
              </div>
              <div className="relative">
                <FieldDot field="maintenance_cert" />
                <Label>Maintenance Certificate</Label>
                <Input
                  value={form.maintenance_cert}
                  onChange={(e) => handleChange('maintenance_cert', e.target.value)}
                  placeholder="e.g. yes, none"
                />
              </div>
              <div className="relative">
                <FieldDot field="maintenance_cert_date" />
                <Label>Maintenance Certificate Date</Label>
                <Input
                  type="date"
                  value={form.maintenance_cert_date}
                  onChange={(e) => handleChange('maintenance_cert_date', e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Retention */}
      <Card>
        <SectionHeader id="retention" label="Retention" />
        {openSections.retention && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <FieldDot field="retention_application_date" />
                <Label>Retention Application Date</Label>
                <Input
                  type="date"
                  value={form.retention_application_date}
                  onChange={(e) => handleChange('retention_application_date', e.target.value)}
                />
              </div>
              <div className="relative">
                <FieldDot field="retention_paid" />
                <Label>Paid</Label>
                <Select
                  value={form.retention_paid || 'none'}
                  onValueChange={(v) => handleChange('retention_paid', v === 'none' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not specified</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="relative">
                <FieldDot field="retention_amount_paid" />
                <Label>Amount Paid (₦)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.retention_amount_paid}
                  onChange={(e) => handleChange('retention_amount_paid', e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Financial Tracking */}
      <Card>
        <SectionHeader id="financial" label="Financial Tracking" />
        {openSections.financial && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="relative">
                <FieldDot field="works_vetted_certified" />
                <Label>Works Vetted & Certified (₦)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.works_vetted_certified}
                  onChange={(e) => handleChange('works_vetted_certified', e.target.value)}
                />
              </div>
              <div className="relative">
                <FieldDot field="payment_received" />
                <Label>Payment Received (₦)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.payment_received}
                  onChange={(e) => handleChange('payment_received', e.target.value)}
                />
              </div>
              <div className="relative">
                <FieldDot field="outstanding_payment" />
                <Label>Outstanding Payment (₦)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.outstanding_payment}
                  onChange={(e) => handleChange('outstanding_payment', e.target.value)}
                />
              </div>
              <div className="relative">
                <FieldDot field="cost_to_date" />
                <Label>Cost to Date (₦)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.cost_to_date}
                  onChange={(e) => handleChange('cost_to_date', e.target.value)}
                />
              </div>
              <div className="relative">
                <FieldDot field="revenue_to_date" />
                <Label>Revenue to Date (₦)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.revenue_to_date}
                  onChange={(e) => handleChange('revenue_to_date', e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Notes */}
      <Card>
        <SectionHeader id="notes" label="Notes" />
        {openSections.notes && (
          <CardContent>
            <Textarea
              value={form.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Additional notes about this project..."
              rows={4}
            />
          </CardContent>
        )}
      </Card>

      {/* Sticky Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t px-6 py-3 z-50">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {mode === 'edit' && changedCount > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                {changedCount} field{changedCount !== 1 ? 's' : ''} changed
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : mode === 'create' ? 'Create Project' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}

// Maps section IDs to their field names for change tracking
const SECTION_FIELDS: Record<string, string[]> = {
  identification: ['project_name', 'client', 'short_name', 'state_id', 'status', 'is_legacy'],
  contract: ['original_contract_sum', 'variation_sum', 'current_contract_sum'],
  dates: ['award_date', 'commencement_date', 'original_duration_months', 'original_completion_date', 'extension_of_time_months', 'revised_completion_date'],
  certification: ['has_award_letter', 'substantial_completion_cert', 'substantial_completion_date', 'final_completion_cert', 'final_completion_date', 'maintenance_cert', 'maintenance_cert_date'],
  retention: ['retention_application_date', 'retention_paid', 'retention_amount_paid'],
  financial: ['works_vetted_certified', 'payment_received', 'outstanding_payment', 'cost_to_date', 'revenue_to_date'],
  notes: ['notes'],
}
