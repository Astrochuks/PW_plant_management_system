'use client'

import { useState, useRef, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Search, Loader2, MapPin, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { useDebounce } from '@/hooks/use-debounce'
import { useCreateTransfer } from '@/hooks/use-transfers'
import { useLocationsWithStats } from '@/hooks/use-locations'
import { searchPlants, type PlantSummary } from '@/lib/api/plants'
import { getErrorMessage } from '@/lib/api/client'

export function CreateTransferDialog() {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PlantSummary[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [selectedPlant, setSelectedPlant] = useState<PlantSummary | null>(null)
  const [toLocationId, setToLocationId] = useState('')
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const resultsRef = useRef<HTMLDivElement>(null)

  const debouncedQuery = useDebounce(searchQuery, 300)
  const createMutation = useCreateTransfer()
  const { data: locations = [] } = useLocationsWithStats()

  // Filter out the plant's current location from the destination options
  const availableLocations = selectedPlant?.current_location_id
    ? locations.filter((l) => l.id !== selectedPlant.current_location_id)
    : locations

  // Search plants when query changes
  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setSearchResults([])
      return
    }

    let cancelled = false
    setIsSearching(true)

    searchPlants(debouncedQuery, { limit: 8 })
      .then((results) => {
        if (!cancelled) {
          setSearchResults(results)
          setShowResults(true)
        }
      })
      .catch(() => {
        if (!cancelled) setSearchResults([])
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false)
      })

    return () => { cancelled = true }
  }, [debouncedQuery])

  // Close results dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (resultsRef.current && !resultsRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSelectPlant = (plant: PlantSummary) => {
    setSelectedPlant(plant)
    setSearchQuery(plant.fleet_number)
    setShowResults(false)
    setToLocationId('')
  }

  const handleSubmit = () => {
    if (!selectedPlant || !toLocationId) return

    createMutation.mutate(
      {
        plant_id: selectedPlant.id,
        to_location_id: toLocationId,
        transfer_date: transferDate || undefined,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          toast.success(res.message)
          resetForm()
          setOpen(false)
        },
        onError: (err) => toast.error(getErrorMessage(err)),
      }
    )
  }

  const resetForm = () => {
    setSearchQuery('')
    setSearchResults([])
    setSelectedPlant(null)
    setToLocationId('')
    setTransferDate(new Date().toISOString().split('T')[0])
    setNotes('')
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          New Transfer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create Transfer</DialogTitle>
          <DialogDescription>
            Manually transfer a plant to a different site.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Plant search */}
          <div className="space-y-1.5">
            <Label htmlFor="plant-search">Plant</Label>
            <div className="relative" ref={resultsRef}>
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="plant-search"
                placeholder="Search by fleet number..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setSelectedPlant(null)
                  if (e.target.value.length >= 2) setShowResults(true)
                }}
                onFocus={() => { if (searchResults.length > 0) setShowResults(true) }}
                className="pl-9"
              />
              {isSearching && (
                <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {showResults && searchResults.length > 0 && !selectedPlant && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-52 overflow-y-auto">
                  {searchResults.map((plant) => (
                    <button
                      key={plant.id}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-center justify-between gap-2"
                      onClick={() => handleSelectPlant(plant)}
                    >
                      <div>
                        <span className="font-mono font-medium">{plant.fleet_number}</span>
                        {plant.description && (
                          <span className="text-muted-foreground ml-2 text-xs">{plant.description}</span>
                        )}
                      </div>
                      {plant.current_location && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 shrink-0">
                          <MapPin className="h-3 w-3" />
                          {plant.current_location}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {showResults && debouncedQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md p-3 text-center text-sm text-muted-foreground">
                  No plants found
                </div>
              )}
            </div>
          </div>

          {/* From → To display */}
          {selectedPlant && (
            <div className="rounded-md bg-muted/50 p-3 flex items-center gap-3 text-sm">
              <div className="flex-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">From</p>
                <p className="font-medium">{selectedPlant.current_location || 'Unknown'}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">To</p>
                {toLocationId ? (
                  <p className="font-medium">
                    {locations.find((l) => l.id === toLocationId)?.location_name || '-'}
                  </p>
                ) : (
                  <p className="text-muted-foreground">Select below</p>
                )}
              </div>
            </div>
          )}

          {/* Destination location */}
          <div className="space-y-1.5">
            <Label htmlFor="to-location">Destination</Label>
            <Select value={toLocationId} onValueChange={setToLocationId} disabled={!selectedPlant}>
              <SelectTrigger id="to-location">
                <SelectValue placeholder="Select destination site" />
              </SelectTrigger>
              <SelectContent>
                {availableLocations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.location_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Transfer date */}
          <div className="space-y-1.5">
            <Label htmlFor="transfer-date">Transfer Date</Label>
            <Input
              id="transfer-date"
              type="date"
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="Reason for transfer..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedPlant || !toLocationId || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Transfer'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
