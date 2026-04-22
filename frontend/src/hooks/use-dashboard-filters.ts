'use client'

import { create } from 'zustand'

interface DashboardFilters {
  locationId: string | null
  stateId: string | null
  fleetType: string | null
  year: number

  setLocationId: (id: string | null) => void
  setStateId: (id: string | null) => void
  setFleetType: (type: string | null) => void
  setYear: (year: number) => void
  reset: () => void
}

export const useDashboardFilters = create<DashboardFilters>((set) => ({
  locationId: null,
  stateId: null,
  fleetType: null,
  year: new Date().getFullYear(),

  setLocationId: (locationId) => set({ locationId }),
  setStateId: (stateId) => set({ stateId }),
  setFleetType: (fleetType) => set({ fleetType }),
  setYear: (year) => set({ year }),
  reset: () =>
    set({
      locationId: null,
      stateId: null,
      fleetType: null,
      year: new Date().getFullYear(),
    }),
}))
