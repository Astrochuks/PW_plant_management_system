'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Key,
  Plus,
  Copy,
  Check,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ProtectedRoute } from '@/components/protected-route'
import { useUploadTokens, useGenerateToken, type UploadToken } from '@/hooks/use-uploads'
import { useLocationsWithStats } from '@/hooks/use-locations'
import { getErrorMessage } from '@/lib/api/client'

function TokensContent() {
  const [showInactive, setShowInactive] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [generatedToken, setGeneratedToken] = useState<UploadToken | null>(null)
  const [copied, setCopied] = useState(false)

  // Form state
  const [name, setName] = useState('')
  const [locationId, setLocationId] = useState('')
  const [uploadTypes, setUploadTypes] = useState('')
  const [expiresInDays, setExpiresInDays] = useState('')

  const { data: tokens, isLoading } = useUploadTokens(!showInactive)
  const { data: locations = [] } = useLocationsWithStats()
  const generateMutation = useGenerateToken()

  const resetForm = useCallback(() => {
    setName('')
    setLocationId('')
    setUploadTypes('')
    setExpiresInDays('')
    setShowForm(false)
  }, [])

  const handleGenerate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('Token name is required')
      return
    }

    try {
      const token = await generateMutation.mutateAsync({
        name: name.trim(),
        ...(locationId && locationId !== 'none' ? { location_id: locationId } : {}),
        ...(uploadTypes.trim() ? { upload_types: uploadTypes.trim() } : {}),
        ...(expiresInDays ? { expires_in_days: Number(expiresInDays) } : {}),
      })
      setGeneratedToken(token)
      resetForm()
      toast.success('Token generated successfully')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }, [name, locationId, uploadTypes, expiresInDays, generateMutation, resetForm])

  const handleCopy = useCallback(() => {
    if (generatedToken) {
      navigator.clipboard.writeText(generatedToken.token)
      setCopied(true)
      toast.success('Token copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    }
  }, [generatedToken])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/uploads"
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Upload Tokens</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage API tokens for external upload access
            </p>
          </div>
        </div>
        {!showForm && !generatedToken && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Generate Token
          </Button>
        )}
      </div>

      {/* Generated Token Alert */}
      {generatedToken && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Key className="h-5 w-5 text-emerald-600" />
                <h3 className="font-semibold text-emerald-900">Token Generated</h3>
              </div>
              <p className="text-sm text-emerald-800">
                Copy this token now. It will not be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-white border rounded-lg px-4 py-2.5 text-sm font-mono break-all">
                  {generatedToken.token}
                </code>
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setGeneratedToken(null)}
                className="text-emerald-700"
              >
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generate Form */}
      {showForm && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Generate New Token</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleGenerate} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="token-name">Name *</Label>
                  <Input
                    id="token-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Site A Upload Key"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="token-location">Location (optional)</Label>
                  <Select value={locationId} onValueChange={setLocationId}>
                    <SelectTrigger id="token-location">
                      <SelectValue placeholder="Any location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Any location</SelectItem>
                      {locations.map((loc) => (
                        <SelectItem key={loc.id} value={loc.id}>{loc.location_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="upload-types">Upload Types (optional)</Label>
                  <Input
                    id="upload-types"
                    value={uploadTypes}
                    onChange={(e) => setUploadTypes(e.target.value)}
                    placeholder="e.g. weekly_report,spare_parts"
                  />
                  <p className="text-xs text-muted-foreground">
                    Comma-separated list of allowed upload types
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expires-days">Expires In (days, optional)</Label>
                  <Input
                    id="expires-days"
                    type="number"
                    min="1"
                    max="365"
                    value={expiresInDays}
                    onChange={(e) => setExpiresInDays(e.target.value)}
                    placeholder="No expiry"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={generateMutation.isPending}>
                  {generateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Generate
                </Button>
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Switch
          id="show-inactive-tokens"
          checked={showInactive}
          onCheckedChange={setShowInactive}
        />
        <Label htmlFor="show-inactive-tokens" className="text-sm">
          Show inactive tokens
        </Label>
      </div>

      {/* Tokens Table */}
      {isLoading ? (
        <Skeleton className="h-[300px] w-full" />
      ) : tokens && tokens.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {tokens.length} token{tokens.length !== 1 ? 's' : ''}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Token</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Types</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tokens.map((token) => (
                    <TableRow key={token.id}>
                      <TableCell className="font-medium">{token.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {token.token}
                      </TableCell>
                      <TableCell className="text-sm">
                        {token.location_name || 'Any'}
                      </TableCell>
                      <TableCell>
                        {token.upload_types.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {token.upload_types.map((t) => (
                              <Badge key={t} variant="outline" className="text-[10px]">
                                {t}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">All</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {token.expires_at
                          ? new Date(token.expires_at).toLocaleDateString('en-NG', {
                              day: '2-digit',
                              month: 'short',
                              year: '2-digit',
                            })
                          : 'Never'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={token.is_active ? 'default' : 'secondary'}>
                          {token.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(token.created_at).toLocaleDateString('en-NG', {
                          day: '2-digit',
                          month: 'short',
                          year: '2-digit',
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Key className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="font-medium">No tokens found</p>
            <p className="text-sm text-muted-foreground mt-1">
              Generate a token to enable external upload access.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default function TokensPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <TokensContent />
    </ProtectedRoute>
  )
}
