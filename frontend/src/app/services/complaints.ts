import api from './api';

export type ComplaintSource = 'passenger' | 'driver';

export interface ComplaintReporter {
  name: string;
  phone: string;
}

export interface ComplaintRow {
  source: ComplaintSource;
  id: number;
  created_at: string;
  category: string;
  status: string;
  description: string;
  order_id: string;
  pickup_title: string;
  dropoff_title: string;
  reporter: ComplaintReporter;
  attachment_url: string | null;
}

export interface ComplaintsListResponse {
  count: number;
  page: number;
  page_size: number;
  results: ComplaintRow[];
}

export interface GetComplaintsParams {
  page?: number;
  page_size?: number;
  source?: 'all' | ComplaintSource;
  status?: string;
}

export const COMPLAINTS_PAGE_SIZE = 20;

export async function getComplaints(
  params: GetComplaintsParams = {}
): Promise<ComplaintsListResponse> {
  const response = await api.get<ComplaintsListResponse>('/dispatch/complaints/', {
    params: {
      page: params.page ?? 1,
      page_size: params.page_size ?? COMPLAINTS_PAGE_SIZE,
      ...(params.source && params.source !== 'all' ? { source: params.source } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
  });
  return response.data;
}
