'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { User, Mail, Shield, Clock, Calendar, Lock, Eye, EyeOff, Check } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { useAuth } from '@/providers/auth-provider'
import {
  getProfile,
  updateProfile,
  changePassword,
  type ProfileData,
  type ChangePasswordData,
} from '@/lib/api/auth'
import { getErrorMessage } from '@/lib/api/client'

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  return new Date(dateStr).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ProfilePage() {
  const { refreshUser } = useAuth()

  // Profile data
  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: getProfile,
    staleTime: 60 * 1000,
  })

  // Edit name state
  const [isEditingName, setIsEditingName] = useState(false)
  const [editName, setEditName] = useState('')

  const updateNameMutation = useMutation({
    mutationFn: (data: { full_name: string }) => updateProfile(data),
    onSuccess: () => {
      toast.success('Name updated successfully')
      setIsEditingName(false)
      refreshUser()
    },
    onError: (err) => {
      toast.error(getErrorMessage(err))
    },
  })

  // Change password state
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)

  const changePasswordMutation = useMutation({
    mutationFn: (data: ChangePasswordData) => changePassword(data),
    onSuccess: () => {
      toast.success('Password changed successfully')
      setShowPasswordForm(false)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    },
    onError: (err) => {
      toast.error(getErrorMessage(err))
    },
  })

  const handleStartEditName = () => {
    setEditName(profile?.full_name || '')
    setIsEditingName(true)
  }

  const handleSaveName = () => {
    if (editName.trim().length < 2) {
      toast.error('Name must be at least 2 characters')
      return
    }
    updateNameMutation.mutate({ full_name: editName.trim() })
  }

  const handleChangePassword = () => {
    if (!currentPassword) {
      toast.error('Current password is required')
      return
    }
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters')
      return
    }
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      toast.error('Password must contain uppercase, lowercase, and a number')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    changePasswordMutation.mutate({
      current_password: currentPassword,
      new_password: newPassword,
    })
  }

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-2xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Your account information
        </p>
      </div>

      {/* Profile Info */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Account Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Name */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Full Name</p>
                {isEditingName ? (
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8 w-[220px]"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      onClick={handleSaveName}
                      disabled={updateNameMutation.isPending}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      onClick={() => setIsEditingName(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <p className="font-medium">{profile?.full_name || 'Not set'}</p>
                )}
              </div>
            </div>
            {!isEditingName && (
              <Button variant="ghost" size="sm" onClick={handleStartEditName}>
                Edit
              </Button>
            )}
          </div>

          <Separator />

          {/* Email */}
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <Mail className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="font-medium">{profile?.email}</p>
            </div>
          </div>

          <Separator />

          {/* Role */}
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <Shield className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Role</p>
              <Badge variant="secondary" className="mt-0.5 capitalize">
                {profile?.role}
              </Badge>
            </div>
          </div>

          <Separator />

          {/* Last Login */}
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last Login</p>
              <p className="font-medium">{formatDate(profile?.last_login_at ?? null)}</p>
            </div>
          </div>

          <Separator />

          {/* Account Created */}
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Account Created</p>
              <p className="font-medium">{formatDate(profile?.created_at ?? null)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Password</CardTitle>
            {!showPasswordForm && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPasswordForm(true)}
              >
                <Lock className="h-4 w-4 mr-2" />
                Change Password
              </Button>
            )}
          </div>
        </CardHeader>
        {showPasswordForm && (
          <CardContent className="space-y-4">
            {/* Current Password */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">Current Password</label>
              <div className="relative">
                <Input
                  type={showCurrentPw ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                  onClick={() => setShowCurrentPw(!showCurrentPw)}
                >
                  {showCurrentPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            {/* New Password */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">New Password</label>
              <div className="relative">
                <Input
                  type={showNewPw ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                  onClick={() => setShowNewPw(!showNewPw)}
                >
                  {showNewPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Min 6 characters, must include uppercase, lowercase, and a number
              </p>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">Confirm New Password</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={handleChangePassword}
                disabled={changePasswordMutation.isPending}
              >
                {changePasswordMutation.isPending ? 'Changing...' : 'Change Password'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowPasswordForm(false)
                  setCurrentPassword('')
                  setNewPassword('')
                  setConfirmPassword('')
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
