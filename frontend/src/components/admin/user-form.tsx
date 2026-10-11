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
import { ROLE_DESCRIPTIONS, ROLE_LABELS, USER_ROLES } from '@/lib/roles'
import { useCreateUser, useUpdateUser } from '@/hooks/use-users'
import { useProjects } from '@/hooks/use-projects'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  role: z.enum(USER_ROLES),
  project_scope: z.enum(['all', 'assigned']),
  project_ids: z.array(z.string()),
}).superRefine((data, ctx) => {
  // PRD v2 §3.5: a project-scoped PM and every site engineer need ≥ 1 project
  const scoped = data.role === 'site_engineer' || (data.role === 'project_manager' && data.project_scope === 'assigned')
  if (scoped && data.project_ids.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['project_ids'], message: 'Select at least one project' })
  }
})

type UserFormValues = z.infer<typeof userFormSchema>

interface UserFormProps {
  user?: User
  onSuccess?: () => void
  onCancel?: () => void
}

export function UserForm({ user, onSuccess, onCancel }: UserFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const createMutation = useCreateUser()
  const updateMutation = useUpdateUser(user?.id || '')
  const isEditing = !!user

  // A parked role on an existing row (MD/GPM before migration 035) is shown
  // as what it now is — project manager — so saving the form writes a
  // valid value.
  const initialRole: UserFormValues['role'] =
    user && (USER_ROLES as readonly string[]).includes(user.role)
      ? (user.role as UserFormValues['role'])
      : user
        ? 'project_manager'
        : 'site_engineer'

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: {
      email: user?.email || '',
      password: '',
      full_name: user?.full_name || '',
      role: initialRole,
      project_scope: user?.project_scope ?? (initialRole === 'site_engineer' ? 'assigned' : 'all'),
      project_ids: user?.projects?.map((p) => p.id) ?? [],
    },
  })

  const watchedRole = form.watch('role')
  const watchedScope = form.watch('project_scope')
  // the picker lists the live register only — legacy rows are history, not assignable
  const { data: projectsData } = useProjects({ is_legacy: false, limit: 100, sort_by: 'project_name', sort_order: 'asc' })
  const assignable = projectsData?.data ?? []
  const isScopedRole =
    watchedRole === 'site_engineer' || (watchedRole === 'project_manager' && watchedScope === 'assigned')

  async function onSubmit(values: UserFormValues) {
    try {
      setIsSubmitting(true)

      if (isEditing) {
        // Roles v3: site engineers are scoped by project assignment, not by
        // a plant location — a legacy location link is cleared on edit.
        const scope = values.role === 'site_engineer' ? 'assigned' : values.role === 'project_manager' ? values.project_scope : 'all'
        const patch: Parameters<typeof updateMutation.mutateAsync>[0] = {
          full_name: values.full_name,
          role: values.role,
          project_scope: scope,
          project_ids: scope === 'assigned' ? values.project_ids : [],
          ...(user?.location_id ? { clear_location: true } : {}),
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
          location_id: null,
          project_scope: values.role === 'site_engineer' ? 'assigned' : values.role === 'project_manager' ? values.project_scope : 'all',
          project_ids:
            values.role === 'site_engineer' || (values.role === 'project_manager' && values.project_scope === 'assigned')
              ? values.project_ids
              : [],
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
                  {USER_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                {ROLE_DESCRIPTIONS[field.value] ?? ''}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {watchedRole === 'project_manager' && (
          <FormField
            control={form.control}
            name="project_scope"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Scope</FormLabel>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['all', 'All projects', 'General Project Manager — every site, with a picker to focus one'],
                    ['assigned', 'Selected projects', 'Only the projects chosen below'],
                  ] as const).map(([value, label, hint]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => field.onChange(value)}
                      className={cn(
                        'rounded-md border p-3 text-left transition-colors',
                        field.value === value ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                      )}
                    >
                      <div className="text-sm font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground">{hint}</div>
                    </button>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {isScopedRole && (
          <FormField
            control={form.control}
            name="project_ids"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {watchedRole === 'site_engineer' ? 'Project' : 'Projects'}{' '}
                  <span className="font-normal text-muted-foreground">({field.value.length} selected)</span>
                </FormLabel>
                <div className="max-h-56 overflow-y-auto rounded-md border">
                  {assignable.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">No live projects in the register yet.</p>
                  ) : (
                    assignable.map((p) => {
                      const checked = field.value.includes(p.id)
                      return (
                        <label
                          key={p.id}
                          className="flex cursor-pointer items-start gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/50"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 accent-primary"
                            checked={checked}
                            onChange={(e) =>
                              field.onChange(
                                e.target.checked
                                  ? [...field.value, p.id]
                                  : field.value.filter((id: string) => id !== p.id)
                              )
                            }
                          />
                          <span>
                            <span className="font-medium">{p.short_name || p.project_name}</span>
                            {p.short_name && (
                              <span className="block text-xs text-muted-foreground">{p.project_name}</span>
                            )}
                          </span>
                        </label>
                      )
                    })
                  )}
                </div>
                <FormDescription>
                  {watchedRole === 'site_engineer'
                    ? 'The engineer sees only these projects — their bills and, later, the weekly form.'
                    : 'This project manager sees only these projects.'}
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
