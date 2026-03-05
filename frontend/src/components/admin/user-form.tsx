'use client'

import { useState } from 'react'
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
import { toast } from 'sonner'
import type { User } from '@/lib/api/admin'
import { useCreateUser, useUpdateUser } from '@/hooks/use-users'
import { useLocationsWithStats } from '@/hooks/use-locations'
import { Loader2 } from 'lucide-react'

const userFormSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Must contain at least one lowercase letter')
    .regex(/\d/, 'Must contain at least one number')
    .optional()
    .or(z.literal('')),
  full_name: z.string().min(2, 'Full name must be at least 2 characters'),
  role: z.enum(['admin', 'management', 'site_engineer']),
  location_id: z.string().optional(),
}).refine(
  (data) => data.role !== 'site_engineer' || !!data.location_id,
  { message: 'Site assignment is required for site engineers', path: ['location_id'] }
)

type UserFormValues = z.infer<typeof userFormSchema>

interface UserFormProps {
  user?: User
  onSuccess?: () => void
  onCancel?: () => void
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: 'Full access to all features and user management',
  management: 'Read access to plants, reports, and analytics',
  site_engineer: 'Can fill and submit weekly reports for their assigned site',
}

export function UserForm({ user, onSuccess, onCancel }: UserFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const createMutation = useCreateUser()
  const updateMutation = useUpdateUser(user?.id || '')
  const isEditing = !!user

  const { data: locationsData } = useLocationsWithStats()
  const locations = locationsData ?? []

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: {
      email: user?.email || '',
      password: '',
      full_name: user?.full_name || '',
      role: (user?.role as UserFormValues['role']) || 'management',
      location_id: user?.location_id || '',
    },
  })

  const watchedRole = form.watch('role')

  async function onSubmit(values: UserFormValues) {
    try {
      setIsSubmitting(true)

      if (isEditing) {
        const patch: Parameters<typeof updateMutation.mutateAsync>[0] = {
          full_name: values.full_name,
          role: values.role,
        }
        if (values.role === 'site_engineer') {
          patch.location_id = values.location_id || null
        } else {
          // If changing away from site_engineer, clear location
          if (user?.role === 'site_engineer') {
            patch.clear_location = true
          }
        }
        await updateMutation.mutateAsync(patch)
        toast.success('User updated successfully')
      } else {
        if (!values.password) {
          toast.error('Password is required for new users')
          setIsSubmitting(false)
          return
        }
        await createMutation.mutateAsync({
          email: values.email,
          password: values.password,
          full_name: values.full_name,
          role: values.role,
          location_id: values.role === 'site_engineer' ? (values.location_id || null) : null,
        })
        toast.success('User created successfully')
      }

      onSuccess?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An error occurred'
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  placeholder="user@example.com"
                  disabled={isEditing}
                  className="disabled:opacity-50"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {!isEditing && (
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Temporary Password</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="password"
                    placeholder="Min 6 chars, 1 uppercase, 1 lowercase, 1 number"
                    autoComplete="new-password"
                  />
                </FormControl>
                <FormDescription>
                  User will need to change this on first login.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="full_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full Name</FormLabel>
              <FormControl>
                <Input {...field} placeholder="John Doe" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Role</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="management">Management</SelectItem>
                  <SelectItem value="site_engineer">Site Engineer</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                {ROLE_DESCRIPTIONS[field.value] ?? ''}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {watchedRole === 'site_engineer' && (
          <FormField
            control={form.control}
            name="location_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Assigned Site</FormLabel>
                <Select value={field.value || ''} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a site…" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {locations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.location_name}
                        {loc.state_name ? ` — ${loc.state_name}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  Each site can only have one active site engineer.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isEditing ? 'Updating...' : 'Creating...'}
              </>
            ) : (
              isEditing ? 'Update User' : 'Create User'
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
