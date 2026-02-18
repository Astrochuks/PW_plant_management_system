'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
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
import { toast } from 'sonner'
import { useStates, useCreateLocation, useUpdateLocation } from '@/hooks/use-locations'
import type { LocationStats } from '@/lib/api/locations'
import { getErrorMessage } from '@/lib/api/client'
import { Loader2 } from 'lucide-react'

const NONE_VALUE = '__none__'

const locationFormSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  state_id: z.string().optional(),
})

type LocationFormValues = z.infer<typeof locationFormSchema>

interface LocationFormProps {
  location?: LocationStats
  onSuccess?: () => void
  onCancel?: () => void
}

export function LocationForm({ location, onSuccess, onCancel }: LocationFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { data: states = [] } = useStates()
  const createMutation = useCreateLocation()
  const updateMutation = useUpdateLocation(location?.id || '')
  const isEditing = !!location

  const form = useForm<LocationFormValues>({
    resolver: zodResolver(locationFormSchema),
    defaultValues: {
      name: location?.location_name || '',
      state_id: location?.state_id || NONE_VALUE,
    },
  })

  async function onSubmit(raw: LocationFormValues) {
    try {
      setIsSubmitting(true)

      const values = {
        ...raw,
        name: raw.name.trim().toUpperCase(),
        state_id: raw.state_id === NONE_VALUE ? undefined : raw.state_id,
      }

      if (isEditing) {
        // Only send changed fields
        const changes: Record<string, string | undefined> = {}
        if (values.name !== location.location_name) changes.name = values.name
        if (values.state_id !== (location.state_id || undefined)) changes.state_id = values.state_id

        if (Object.keys(changes).length === 0) {
          toast.info('No changes to save')
          return
        }

        await updateMutation.mutateAsync(changes)
        toast.success('Site updated successfully')
      } else {
        await createMutation.mutateAsync(values)
        toast.success('Site created successfully')
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
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Site Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. ABUJA" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="state_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>State</FormLabel>
              <Select
                onValueChange={field.onChange}
                value={field.value || NONE_VALUE}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a state" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>No State</SelectItem>
                  {states
                    .filter((s) => s.is_active)
                    .map((state) => (
                      <SelectItem key={state.id} value={state.id}>
                        {state.name} {state.code ? `(${state.code})` : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEditing ? 'Update Site' : 'Create Site'}
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
