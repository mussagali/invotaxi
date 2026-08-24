import api from './api';

export interface Driver {
  id: string;
  user: {
    id: string;
    username: string;
    phone: string;
    email?: string;
  };
  name: string;
  /** Поля центра приходят из RegionSerializer (город/регион в админке). */
  region?: {
    id: string;
    title: string;
    center_lat?: number;
    center_lon?: number;
    center?: { lat: number; lon: number };
    city?: {
      id?: string;
      title?: string;
      center_lat?: number;
      center_lon?: number;
      center?: { lat: number; lon: number };
    };
  };
  car_model: string;
  plate_number: string;
  capacity: number;
  is_online: boolean;
  current_lat?: number;
  current_lon?: number;
  current_position?: { lat: number; lon: number } | null;
  last_location_update?: string;
}

export interface UpdateLocationRequest {
  lat: number;
  lon: number;
}

export interface UpdateOnlineStatusRequest {
  is_online: boolean;
}

export const DRIVERS_PAGE_SIZE = 20;

export interface DriversStats {
  total: number;
  online: number;
  offline: number;
}

export interface DriversListParams {
  is_online?: boolean;
  region_id?: string;
  search?: string;
  page?: number;
  page_size?: number;
}

export interface CreateDriverRequest {
  name: string;
  phone: string;
  email?: string;
  password: string;
  region_id: string;
  car_model: string;
  plate_number: string;
  capacity: number;
  is_online?: boolean;
}

export interface UpdateDriverRequest {
  name?: string;
  phone?: string;
  email?: string;
  region_id?: string;
  car_model?: string;
  plate_number?: string;
  capacity?: number;
  is_online?: boolean;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

function adaptDriver(raw: any, position?: any): Driver {
  return {
    id: raw.user_id as any,
    user: { id: raw.user_id as any, username: raw.full_name, phone: raw.phone || "" },
    name: raw.full_name,
    region: {
      id: raw.region || "Атырау",
      title: raw.region || "Атырау",
      center_lat: 47.0945,
      center_lon: 51.9238,
      center: { lat: 47.0945, lon: 51.9238 },
    },
    car_model: raw.vehicle_model || "—",
    plate_number: raw.plate || "—",
    capacity: raw.capacity,
    is_online: raw.is_online,
    current_lat: position?.lat ?? raw.home_lat ?? undefined,
    current_lon: position?.lon ?? raw.home_lon ?? undefined,
    current_position: position ? { lat: position.lat, lon: position.lon } : null,
    last_location_update: position?.ts,
  };
}

async function loadDrivers(params?: DriversListParams): Promise<Driver[]> {
  const [driversResponse, liveResponse] = await Promise.all([
    api.get<any[]>("/drivers", { params: {
      limit: 200,
      is_online: params?.is_online,
      region: params?.region_id,
    } }),
    api.get<any[]>("/drivers/live").catch(() => ({ data: [] })),
  ]);
  const live = new Map(liveResponse.data.map((point: any) => [point.driver_id, point]));
  let drivers = driversResponse.data.map((item) => adaptDriver(item, live.get(item.user_id)));
  if (params?.search) {
    const query = params.search.toLowerCase();
    drivers = drivers.filter((item) => `${item.name} ${item.car_model} ${item.plate_number}`.toLowerCase().includes(query));
  }
  return drivers;
}

export const driversApi = {
  /**
   * Получить страницу списка водителей.
   */
  async getDriversPaginated(params?: DriversListParams): Promise<PaginatedResponse<Driver>> {
    const all = await loadDrivers(params);
    const start = ((params?.page ?? 1) - 1) * (params?.page_size ?? DRIVERS_PAGE_SIZE);
    const results = all.slice(start, start + (params?.page_size ?? DRIVERS_PAGE_SIZE));
    return { count: all.length, next: null, previous: null, results };
  },

  /**
   * Сводная статистика по водителям.
   */
  async getDriversStats(): Promise<DriversStats> {
    const drivers = await loadDrivers();
    const online = drivers.filter((item) => item.is_online).length;
    return { total: drivers.length, online, offline: drivers.length - online };
  },

  /**
   * Получить список водителей
   */
  async getDrivers(params?: DriversListParams): Promise<Driver[]> {
    return loadDrivers(params);
  },

  /**
   * Получить водителя по ID
   */
  async getDriver(driverId: string): Promise<Driver> {
    const driver = (await loadDrivers()).find((item) => String(item.id) === String(driverId));
    if (!driver) throw new Error("Водитель не найден");
    return driver;
  },

  /**
   * Очистить всех водителей (требует confirm: true)
   */
  async clearAllDrivers(confirm: boolean = false): Promise<{ success: boolean; deleted_count: number }> {
    const response = await api.post<{ success: boolean; deleted_count: number }>(
      '/drivers/clear-all/',
      { confirm }
    );
    return response.data;
  },

  /**
   * Обновить онлайн статус водителя
   */
  async updateOnlineStatus(driverId: string, data: UpdateOnlineStatusRequest): Promise<Driver> {
    const response = await api.patch(`/drivers/${driverId}`, data);
    return adaptDriver(response.data);
  },

  /**
   * Обновить позицию водителя
   */
  async updateLocation(driverId: string, data: UpdateLocationRequest): Promise<Driver> {
    const response = await api.patch(`/drivers/${driverId}`, {
      home_lat: data.lat,
      home_lon: data.lon,
    });
    return adaptDriver(response.data);
  },

  /**
   * Создать водителя
   */
  async createDriver(data: CreateDriverRequest): Promise<Driver> {
    const response = await api.post('/auth/users', {
      phone: data.phone,
      password: data.password,
      role: "driver",
      driver_profile: {
        full_name: data.name,
        region: data.region_id || "Атырау",
        vehicle_model: data.car_model,
        plate: data.plate_number,
        capacity: data.capacity === 6 ? 6 : 4,
      },
    });
    const created = (await loadDrivers()).find((item) => String(item.id) === String(response.data.user.id));
    if (!created) throw new Error("Водитель создан, но профиль не найден");
    return created;
  },

  /**
   * Обновить водителя
   */
  async updateDriver(driverId: string, data: UpdateDriverRequest): Promise<Driver> {
    const response = await api.patch(`/drivers/${driverId}`, {
      phone: data.phone,
      full_name: data.name,
      region: data.region_id,
      vehicle_model: data.car_model,
      plate: data.plate_number,
      capacity: data.capacity === undefined ? undefined : (data.capacity === 6 ? 6 : 4),
      is_online: data.is_online,
    });
    return adaptDriver(response.data);
  },

  /**
   * Удалить водителя
   */
  async deleteDriver(driverId: string): Promise<void> {
    await api.delete(`/drivers/${driverId}`);
  },

  /**
   * Экспорт водителей в Excel (данные профиля + текущая геопозиция)
   */
  async exportDrivers(params?: Omit<DriversListParams, 'page' | 'page_size'>): Promise<Blob> {
    const response = await api.get('/drivers/export/', {
      params,
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Скачать шаблон Excel для импорта водителей
   */
  async downloadTemplate(): Promise<Blob> {
    const response = await api.get('/drivers/template/', {
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Импорт водителей из Excel файла
   */
  async importDrivers(file: File, options?: { skipErrors?: boolean; dryRun?: boolean }): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.skipErrors) {
      formData.append('skip_errors', 'true');
    }
    if (options?.dryRun) {
      formData.append('dry_run', 'true');
    }

    // Не устанавливаем Content-Type вручную - axios автоматически установит его с правильным boundary для FormData
    const response = await api.post('/drivers/import/', formData);
    return response.data;
  },
};
