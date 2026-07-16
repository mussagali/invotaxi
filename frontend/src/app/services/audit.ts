import api from './api';
import type { PaginatedResponse } from './users';

export interface AuditActor {
  id: number;
  username: string;
  display_name: string;
  role: string;
  first_name?: string;
  last_name?: string;
}

export interface AuditLogEntry {
  id: number;
  created_at: string;
  category: string;
  category_display: string;
  action: string;
  description: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  actor: AuditActor;
  subject_user: AuditActor | null;
}

export interface GetAuditLogsParams {
  page?: number;
  page_size?: number;
  category?: string;
  search?: string;
  actor?: number;
  date_from?: string;
  date_to?: string;
}

export const PAGE_SIZE = 20;

export async function getAuditLogs(
  params: GetAuditLogsParams = {}
): Promise<PaginatedResponse<AuditLogEntry>> {
  const response = await api.get<PaginatedResponse<AuditLogEntry>>('/admin/audit-logs/', {
    params: {
      ...params,
      page_size: params.page_size ?? PAGE_SIZE,
    },
  });
  return response.data;
}
