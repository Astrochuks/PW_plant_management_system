/**
 * React Query hooks for suppliers
 */

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  getSuppliers,
  getSupplier,
  getSupplierPOs,
  createSupplier,
  updateSupplier,
  type SuppliersListParams,
  type CreateSupplierRequest,
  type UpdateSupplierRequest,
} from '@/lib/api/suppliers';

export const suppliersKeys = {
  all: ['suppliers'] as const,
  lists: () => [...suppliersKeys.all, 'list'] as const,
  list: (params: SuppliersListParams) => [...suppliersKeys.lists(), params] as const,
  detail: (id: string) => [...suppliersKeys.all, 'detail', id] as const,
  pos: (id: string, params?: Record<string, unknown>) => [...suppliersKeys.detail(id), 'pos', params] as const,
};

export function useSuppliers(params: SuppliersListParams = {}) {
  return useQuery({
    queryKey: suppliersKeys.list(params),
    queryFn: () => getSuppliers(params),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useSupplier(id: string | null) {
  return useQuery({
    queryKey: suppliersKeys.detail(id!),
    queryFn: () => getSupplier(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSupplierPOs(supplierId: string | null, params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: suppliersKeys.pos(supplierId!, params),
    queryFn: () => getSupplierPOs(supplierId!, params),
    enabled: !!supplierId,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useCreateSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSupplierRequest) => createSupplier(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: suppliersKeys.lists() });
    },
  });
}

export function useUpdateSupplier(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateSupplierRequest) => updateSupplier(id, data),
    onSuccess: (data) => {
      queryClient.setQueryData(suppliersKeys.detail(id), data);
      queryClient.invalidateQueries({ queryKey: suppliersKeys.lists() });
    },
  });
}

export type { Supplier, SupplierPO, SuppliersListParams, CreateSupplierRequest, UpdateSupplierRequest } from '@/lib/api/suppliers';
