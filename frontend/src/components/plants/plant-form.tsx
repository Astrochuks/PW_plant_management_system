'use client'

import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { useLocations, useFleetTypes, useCreatePlant, useUpdatePlant } from '@/hooks/use-plants'
import type { PlantSummary } from '@/lib/api/plants'
import { getErrorMessage } from '@/lib/api/client'
import { Loader2 } from 'lucide-react'

const NONE_VALUE = '__none__'

const CONDITIONS = [
  { value: 'working', label: 'Working' },
  { value: 'standby', label: 'Standby' },
  { value: 'under_repair', label: 'Under Repair' },
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'faulty', label: 'Faulty' },
  { value: 'scrap', label: 'Scrap' },
  { value: 'missing', label: 'Missing' },
  { value: 'off_hire', label: 'Off Hire' },
  { value: 'gpm_assessment', label: 'GPM Assessment' },
  { value: 'unverified', label: 'Unverified' },
] as const

const plantFormSchema = z.object({
  fleet_number: z.string().min(1, 'Fleet number is required').max(50),
  description: z.string().max(255).optional(),
  fleet_type: z.string().max(100).optional(),
  make: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  chassis_number: z.string().max(100).optional(),
  year_of_manufacture: z.string().optional(),
  purchase_year: z.string().optional(),
  purchase_cost: z.string().optional(),
  serial_m: z.string().max(100).optional(),
  serial_e: z.string().max(100).optional(),
  remarks: z.string().optional(),
  current_location_id: z.string().optional(),
  // Edit-only fields
  condition: z.string().optional(),
  physical_verification: z.boolean().optional(),
})

type PlantFormValues = z.infer<typeof plantFormSchema>

interface PlantFormProps {
  plant?: PlantSummary
  onSuccess?: () => void
  onCancel?: () => void
}

export function PlantForm({ plant, onSuccess, onCancel }: PlantFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { data: locations = [] } = useLocations()
  const { data: fleetTypes = [] } = useFleetTypes()
  const createMutation = useCreatePlant()
  const updateMutation = useUpdatePlant(plant?.id || '')
  const isEditing = !!plant

  // Deduplicate fleet types by name (some types have multiple prefixes)
  const uniqueFleetTypes = useMemo(() => {
    const seen = new Set<string>()
    return fleetTypes.filter((ft) => {
      if (seen.has(ft.name)) return false
      seen.add(ft.name)
      return true
    })
  }, [fleetTypes])

  const form = useForm<PlantFormValues>({
    resolver: zodResolver(plantFormSchema),
    defaultValues: {
      fleet_number: plant?.fleet_number || '',
      description: plant?.description || '',
      fleet_type: plant?.fleet_type || '',
      make: plant?.make || '',
      model: plant?.model || '',
      chassis_number: plant?.chassis_number || '',
      year_of_manufacture: plant?.year_of_manufacture ? String(plant.year_of_manufacture) : '',
      purchase_year: plant?.purchase_year ? String(plant.purchase_year) : '',
      purchase_cost: plant?.purchase_cost ? String(plant.purchase_cost) : '',
      serial_m: plant?.serial_m || '',
      serial_e: plant?.serial_e || '',
      remarks: plant?.remarks || '',
      current_location_id: plant?.current_location_id || '',
      condition: plant?.condition || '',
      physical_verification: plant?.physical_verification ?? false,
    },
  })

  async function onSubmit(raw: PlantFormValues) {
    try {
      setIsSubmitting(true)

      // Normalize text fields to uppercase to match existing data display
      const values = {
        ...raw,
        fleet_number: raw.fleet_number.trim().toUpperCase(),
        description: raw.description?.trim().toUpperCase() || '',
        make: raw.make?.trim().toUpperCase() || '',
        model: raw.model?.trim().toUpperCase() || '',
        chassis_number: raw.chassis_number?.trim().toUpperCase() || '',
        serial_m: raw.serial_m?.trim().toUpperCase() || '',
        serial_e: raw.serial_e?.trim().toUpperCase() || '',
      }

      if (isEditing) {
        // Build update data — only send changed fields
        const data: Record<string, unknown> = {}
        if (values.description !== (plant?.description || '')) data.description = values.description || undefined
        if (values.fleet_type !== (plant?.fleet_type || '')) data.fleet_type = values.fleet_type || undefined
        if (values.make !== (plant?.make || '')) data.make = values.make || undefined
        if (values.model !== (plant?.model || '')) data.model = values.model || undefined
        if (values.chassis_number !== (plant?.chassis_number || '')) data.chassis_number = values.chassis_number || undefined
        if (values.year_of_manufacture !== (plant?.year_of_manufacture ? String(plant.year_of_manufacture) : ''))
          data.year_of_manufacture = values.year_of_manufacture ? Number(values.year_of_manufacture) : undefined
        if (values.purchase_year !== (plant?.purchase_year ? String(plant.purchase_year) : ''))
          data.purchase_year = values.purchase_year ? Number(values.purchase_year) : undefined
        if (values.purchase_cost !== (plant?.purchase_cost ? String(plant.purchase_cost) : ''))
          data.purchase_cost = values.purchase_cost ? Number(values.purchase_cost) : undefined
        if (values.serial_m !== (plant?.serial_m || '')) data.serial_m = values.serial_m || undefined
        if (values.serial_e !== (plant?.serial_e || '')) data.serial_e = values.serial_e || undefined
        if (values.remarks !== (plant?.remarks || '')) data.remarks = values.remarks || undefined
        if (values.current_location_id !== (plant?.current_location_id || ''))
          data.current_location_id = values.current_location_id || undefined
        if (values.condition !== (plant?.condition || '')) data.condition = values.condition || undefined
        if (values.physical_verification !== plant?.physical_verification)
          data.physical_verification = values.physical_verification

        if (Object.keys(data).length === 0) {
          toast.info('No changes to save')
          return
        }

        await updateMutation.mutateAsync(data as any)
        toast.success(`Plant ${values.fleet_number} updated successfully`)
      } else {
        const data: any = {
          fleet_number: values.fleet_number,
          description: values.description || undefined,
          fleet_type: values.fleet_type || undefined,
          make: values.make || undefined,
          model: values.model || undefined,
          chassis_number: values.chassis_number || undefined,
          year_of_manufacture: values.year_of_manufacture ? Number(values.year_of_manufacture) : undefined,
          purchase_year: values.purchase_year ? Number(values.purchase_year) : undefined,
          purchase_cost: values.purchase_cost ? Number(values.purchase_cost) : undefined,
          serial_m: values.serial_m || undefined,
          serial_e: values.serial_e || undefined,
          remarks: values.remarks || undefined,
          current_location_id: values.current_location_id || undefined,
        }
        await createMutation.mutateAsync(data)
        toast.success(`Plant ${values.fleet_number} created successfully`)
      }

      onSuccess?.()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* ── Identification ── */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Identification</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="fleet_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fleet Number *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="e.g., AF25, T468, E25"
                      disabled={isEditing}
                      className="disabled:opacity-50"
                    />
                  </FormControl>
                  <FormDescription>Unique identifier for the plant/equipment</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., CAT 320 Excavator" maxLength={255} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <Separator />

        {/* ── Classification ── */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Classification</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="fleet_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fleet Type</FormLabel>
                  <Select
                    value={field.value || NONE_VALUE}
                    onValueChange={(v) => field.onChange(v === NONE_VALUE ? '' : v)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Auto-detected from fleet number" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>Auto-Detect</SelectItem>
                      {uniqueFleetTypes.map((type) => (
                        <SelectItem key={type.id} value={type.name}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>Auto-detected from fleet number if not specified</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="current_location_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Site</FormLabel>
                  <Select
                    value={field.value || NONE_VALUE}
                    onValueChange={(v) => field.onChange(v === NONE_VALUE ? '' : v)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select site" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>No Site</SelectItem>
                      {locations.map((loc) => (
                        <SelectItem key={loc.id} value={loc.id}>
                          {loc.location_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="make"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Make</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., Caterpillar, Toyota" maxLength={100} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="model"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Model</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., 320D, Hilux" maxLength={100} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <Separator />

        {/* ── Serial Numbers ── */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Serial Numbers</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="chassis_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Chassis Number</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="VIN / Chassis number" maxLength={100} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="serial_m"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Serial Number (Mechanical)</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Mechanical serial number" maxLength={100} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="serial_e"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Serial Number (Electrical)</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Electrical serial number" maxLength={100} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <Separator />

        {/* ── Purchase & Manufacturing ── */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Purchase & Manufacturing</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="year_of_manufacture"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Year of Manufacture</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" placeholder="e.g., 2018" min={1900} max={2100} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="purchase_year"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Purchase Year</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" placeholder="e.g., 2020" min={1900} max={2100} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="purchase_cost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Purchase Cost (₦)</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" placeholder="0.00" step="0.01" min={0} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* ── Condition & Verification (Edit only) ── */}
        {isEditing && (
          <>
            <Separator />
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Status</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="condition"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Condition</FormLabel>
                      <Select
                        value={field.value || NONE_VALUE}
                        onValueChange={(v) => field.onChange(v === NONE_VALUE ? '' : v)}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select condition" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={NONE_VALUE}>Not Set</SelectItem>
                          {CONDITIONS.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="physical_verification"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <FormLabel className="text-sm font-medium">Physical Verification</FormLabel>
                        <FormDescription className="text-xs">
                          Has this plant been physically verified?
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* ── Remarks ── */}
        <FormField
          control={form.control}
          name="remarks"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Remarks</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  placeholder="Additional notes about the plant"
                  className="min-h-24 resize-none"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ── Action Buttons ── */}
        <div className="flex gap-3 pt-4">
          <Button
            type="submit"
            disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isEditing ? 'Updating...' : 'Creating...'}
              </>
            ) : isEditing ? (
              'Update Plant'
            ) : (
              'Create Plant'
            )}
          </Button>
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Form>
  )
}
