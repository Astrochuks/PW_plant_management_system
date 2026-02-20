'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ProtectedRoute } from '@/components/protected-route'
import { useCreateSupplier } from '@/hooks/use-suppliers'
import { getErrorMessage } from '@/lib/api/client'

function CreateSupplierContent() {
  const router = useRouter()
  const createMutation = useCreateSupplier()

  const [name, setName] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (name.trim().length < 2) {
      toast.error('Supplier name must be at least 2 characters')
      return
    }

    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        ...(contactPerson.trim() ? { contact_person: contactPerson.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
      })
      toast.success(`Supplier "${name.trim()}" created`)
      router.push('/suppliers')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/suppliers"
          className="p-2 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Add Supplier</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Create a new supplier for purchase orders
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Supplier Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. ABC Industrial Supplies"
                required
                minLength={2}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contact-person">Contact Person</Label>
                <Input
                  id="contact-person"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  placeholder="e.g. John Doe"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. +234 xxx xxxx"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. contact@supplier.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. 123 Industrial Ave, Lagos"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Supplier
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default function CreateSupplierPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <CreateSupplierContent />
    </ProtectedRoute>
  )
}
