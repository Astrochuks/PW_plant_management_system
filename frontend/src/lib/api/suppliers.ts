/**
 * Suppliers API functions
 */

import apiClient from './client';

// ============================================================================
// Types
// ============================================================================

export interface Supplier {
  id: string;
  name: string;
  name_normalized?: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // from v_supplier_stats view
  items_count: number;
  po_count: number;
  total_spend: number;
}

export interface SupplierPO {
  po_number: string;
  po_date: string | null;
  location: string | null;
  items_count: number;
  total_amount: number;
}

export interface SuppliersListParams {
  page?: number;
  limit?: number;
  search?: string;
  active_only?: boolean;
}

export interface CreateSupplierRequest {
  name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface UpdateSupplierRequest {
  name?: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
  is_active?: boolean;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

// API Response wrappers
interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  meta: PaginationMeta;
}

// ============================================================================
// API Functions
// ============================================================================

export async function getSuppliers(params: SuppliersListParams = {}): Promise<{
  data: Supplier[];
  meta: PaginationMeta;
}> {
  const queryParams: Record<string, string> = {};
  if (params.page) queryParams.page = String(params.page);
  if (params.limit) queryParams.limit = String(params.limit);
  if (params.search) queryParams.search = params.search;
  if (params.active_only !== undefined) queryParams.active_only = String(params.active_only);

  const response = await apiClient.get<PaginatedApiResponse<Supplier>>('/suppliers', {
    params: queryParams,
  });
  return { data: response.data.data, meta: response.data.meta };
}

export async function getSupplier(id: string): Promise<Supplier> {
  const response = await apiClient.get<ApiResponse<Supplier>>(`/suppliers/${id}`);
  return response.data.data;
}

export async function getSupplierPOs(supplierId: string, params: {
  page?: number;
  limit?: number;
} = {}): Promise<{
  data: SupplierPO[];
  meta: PaginationMeta & { supplier: { id: string; name: string } };
}> {
  const queryParams: Record<string, string> = {};
  if (params.page) queryParams.page = String(params.page);
  if (params.limit) queryParams.limit = String(params.limit);

  const response = await apiClient.get<{
    success: boolean;
    data: SupplierPO[];
    meta: PaginationMeta & { supplier: { id: string; name: string } };
  }>(`/suppliers/${supplierId}/pos`, { params: queryParams });
  return { data: response.data.data, meta: response.data.meta };
}

export async function createSupplier(data: CreateSupplierRequest): Promise<Supplier> {
  const queryParams: Record<string, string> = {};
  queryParams.name = data.name;
  if (data.contact_person) queryParams.contact_person = data.contact_person;
  if (data.phone) queryParams.phone = data.phone;
  if (data.email) queryParams.email = data.email;
  if (data.address) queryParams.address = data.address;

  const response = await apiClient.post<ApiResponse<Supplier>>('/suppliers', null, {
    params: queryParams,
  });
  return response.data.data;
}

export async function updateSupplier(id: string, data: UpdateSupplierRequest): Promise<Supplier> {
  const queryParams: Record<string, string> = {};
  if (data.name) queryParams.name = data.name;
  if (data.contact_person !== undefined) queryParams.contact_person = data.contact_person || '';
  if (data.phone !== undefined) queryParams.phone = data.phone || '';
  if (data.email !== undefined) queryParams.email = data.email || '';
  if (data.address !== undefined) queryParams.address = data.address || '';
  if (data.is_active !== undefined) queryParams.is_active = String(data.is_active);

  const response = await apiClient.patch<ApiResponse<Supplier>>(`/suppliers/${id}`, null, {
    params: queryParams,
  });
  return response.data.data;
}

export async function getSupplierAutocomplete(q: string, limit: number = 10): Promise<Supplier[]> {
  const response = await apiClient.get<ApiResponse<Supplier[]>>('/suppliers/autocomplete', {
    params: { q, limit: String(limit), fuzzy: 'true' },
  });
  return response.data.data;
}
