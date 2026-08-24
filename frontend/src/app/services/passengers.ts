import api from './api';

export interface Passenger {
  id: string;
  user: { id: string; username: string; phone: string; email?: string };
  full_name: string;
  region?: { id: string; title: string };
  disability_category?: string;
  allowed_companion?: boolean;
  is_verified?: boolean;
  total_orders?: number;
  notes?: string;
}

interface BackendClient {
  user_id: string;
  phone: string;
  full_name: string;
  needs_escort: boolean;
  notes?: string | null;
  orders_count: number;
  status: string;
}

export interface PassengersListParams {
  region_id?: string;
  search?: string;
  disability_category?: string;
  page?: number;
  page_size?: number;
  phone?: string;
}
export const PASSENGERS_PAGE_SIZE = 20;
export interface PassengersStats { total: number; with_companion: number; total_orders: number; category_i: number }
export interface PaginatedResponse<T> { count: number; next: string | null; previous: string | null; results: T[] }

function adapt(raw: BackendClient): Passenger {
  return {
    id: raw.user_id,
    user: { id: raw.user_id, username: raw.phone, phone: raw.phone },
    full_name: raw.full_name,
    region: { id: 'atyrau', title: 'Атырау' },
    allowed_companion: raw.needs_escort,
    is_verified: raw.status === 'active',
    total_orders: raw.orders_count,
    notes: raw.notes ?? undefined,
  };
}

async function load(params?: PassengersListParams): Promise<Passenger[]> {
  const response = await api.get<BackendClient[]>('/clients', {
    params: { search: params?.phone || params?.search, limit: 500 },
  });
  return response.data.map(adapt);
}

export const passengersApi = {
  async getPassengersPaginated(params?: PassengersListParams): Promise<PaginatedResponse<Passenger>> {
    const all = await load(params);
    const page = Math.max(1, params?.page ?? 1);
    const size = params?.page_size ?? PASSENGERS_PAGE_SIZE;
    const start = (page - 1) * size;
    return {
      count: all.length,
      next: start + size < all.length ? String(page + 1) : null,
      previous: page > 1 ? String(page - 1) : null,
      results: all.slice(start, start + size),
    };
  },
  async getPassengersStats(): Promise<PassengersStats> {
    return (await api.get<PassengersStats>('/clients/stats')).data;
  },
  getPassengers: load,
  async getPassenger(passengerId: string): Promise<Passenger> {
    return adapt((await api.get<BackendClient>(`/clients/${passengerId}`)).data);
  },
  async createPassenger(data: {
    full_name: string; region_id: string; disability_category: string;
    allowed_companion?: boolean; phone: string; email?: string;
  }): Promise<Passenger> {
    const created = await api.post<{ user: { id: string } }>('/auth/users', {
      phone: data.phone,
      password: '1111',
      role: 'client',
      client_profile: {
        full_name: data.full_name,
        needs_escort: Boolean(data.allowed_companion),
        notes: data.disability_category || null,
      },
    });
    return this.getPassenger(created.data.user.id);
  },
  async updatePassenger(passengerId: string, data: {
    full_name?: string; region_id?: string; disability_category?: string;
    allowed_companion?: boolean; is_verified?: boolean; phone?: string; email?: string;
  }): Promise<Passenger> {
    const response = await api.patch<BackendClient>(`/clients/${passengerId}`, {
      phone: data.phone,
      full_name: data.full_name,
      needs_escort: data.allowed_companion,
      notes: data.disability_category,
    });
    return adapt(response.data);
  },
  async deletePassenger(passengerId: string): Promise<void> {
    await api.delete(`/clients/${passengerId}`);
  },
  async searchPassengersByPhone(phone: string): Promise<Passenger[]> {
    return phone.trim() ? load({ phone: phone.trim() }) : [];
  },
  async downloadTemplate(): Promise<Blob> {
    const csv = '\uFEFFphone,full_name,needs_escort\n+77000000000,Иван Иванов,false\n';
    return new Blob([csv], { type: 'text/csv;charset=utf-8' });
  },
  async importPassengers(): Promise<never> {
    throw new Error('Импорт клиентов будет добавлен после утверждения формата CSV');
  },
  async clearAllPassengers(): Promise<never> {
    throw new Error('Массовое удаление отключено: используйте удаление аккаунта с обезличиванием');
  },
};
