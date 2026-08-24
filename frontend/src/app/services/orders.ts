import api from './api';

export interface Order {
  id: string;
  passenger: {
    id: string;
    full_name: string;
    user: {
      id: string;
      phone: string;
      email?: string;
    };
    region?: {
      id: string;
      title: string;
    };
    disability_category?: string;
    allowed_companion?: boolean;
  };
  driver?: {
    id: string;
    name: string;
    car_model: string;
    plate_number: string;
    user: {
      id: string;
      phone: string;
    };
  } | null;
  region?: {
    id: string;
    title: string;
  };
  pickup_title: string;
  pickup_object_name?: string;
  dropoff_title: string;
  dropoff_object_name?: string;
  pickup_lat: number;
  pickup_lon: number;
  dropoff_lat: number;
  dropoff_lon: number;
  pickup_coordinate: { lat: number; lon: number };
  dropoff_coordinate: { lat: number; lon: number };
  desired_pickup_time: string;
  has_companion: boolean;
  note?: string;
  status: string;
  created_at: string;
  assigned_at?: string;
  completed_at?: string;
  assignment_reason?: string;
  rejection_reason?: string;
  /** ID водителя (строка) — для карты и WebSocket-обновлений */
  driver_id?: string | null;
  video_recording?: boolean;
  upload_started?: boolean;
  cabin_recording?: CabinRecordingInfo;
  seats_needed: number;
  distance_km?: number;
  waiting_time_minutes?: number;
  estimated_price?: number;
  final_price?: number;
  price_breakdown?: {
    base_distance_price: number;
    waiting_time_price: number;
    companion_fee: number;
    disability_multiplier: number;
    night_multiplier: number;
    weekend_multiplier: number;
    subtotal: number;
    minimum_fare_adjustment: number;
    total: number;
  };
}

export interface CreateOrderRequest {
  pickup_title: string;
  pickup_object_name?: string;
  dropoff_title: string;
  dropoff_object_name?: string;
  pickup_lat: number;
  pickup_lon: number;
  dropoff_lat: number;
  dropoff_lon: number;
  desired_pickup_time: string;
  has_companion?: boolean;
  note?: string;
  region_id?: string;
  passenger_id?: string;
  // Поля для создания нового пассажира
  passenger_phone?: string;
  passenger_name?: string;
  passenger_region_id?: string;
  passenger_disability_category?: string;
  passenger_allowed_companion?: boolean;
}

export interface UpdateOrderStatusRequest {
  status: string;
  reason?: string;
}

export const ORDERS_PAGE_SIZE = 20;
export const ORDERS_MAX_PAGE_SIZE = 50;

export interface OrdersListParams {
  status?: string;
  passenger_id?: string;
  driver_id?: string;
  page?: number;
  page_size?: number;
  search?: string;
  /** Календарная дата плана YYYY-MM-DD (фильтр по desired_pickup_time, Asia/Atyrau) */
  plan_date?: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface GenerateAtyrauOrdersResponse {
  success: boolean;
  error?: string;
  date: string;
  created_count: number;
  skipped_count?: number;
  deleted_count?: number;
  orders_per_slot: number;
  max_per_slot: number;
  hour_start: number;
  hour_end: number;
  slots_count: number;
  total_possible: number;
  slot_stats?: Record<string, number>;
  passengers_used?: number;
  routes_in_catalog?: number;
  warnings?: string[];
  auto_dispatch?: {
    status: string;
  };
}

export interface ImportResult {
  success: number;
  failed: number;
  errors: ImportError[];
  imported_ids: string[];
  dry_run?: boolean;
}

export interface ImportError {
  row: number;
  message: string;
}

export interface ExportParams {
  status?: string;
  driver_id?: string;
  date_from?: string;
  date_to?: string;
  /** Все статусы (не только назначенные/в пути) */
  all_statuses?: boolean;
  /** Только заказы с назначенным водителем */
  assigned_only?: boolean;
}

export interface GeocodeResult {
  status: 'ok' | 'not_found' | 'error';
  lat?: number;
  lon?: number;
  display_name?: string;
  error?: string;
}

export interface CabinRecordingSegmentInfo {
  index: number;
  url: string;
  uploaded_at?: string | null;
  duration_seconds?: number | null;
}

export interface CabinRecordingInfo {
  is_recording: boolean;
  is_live: boolean;
  live_frame_url?: string | null;
  live_frame_at?: string | null;
  video_url?: string | null;
  playable_url?: string | null;
  poster_url?: string | null;
  segments?: CabinRecordingSegmentInfo[];
  segment_count?: number;
  merge_status?: string | null;
  duration_seconds?: number | null;
  recording_started_at?: string | null;
  recording_ended_at?: string | null;
  upload_started?: boolean;
}

export interface AddressSuggestion {
  display_name: string;
  lat: number;
  lon: number;
}

function backendStatus(status: string): string {
  return status === "ride_ongoing" ? "picked_up" : status === "pending" ? "created" : status;
}

const backendStatusGroups: Record<string, string[]> = {
  waiting: ["created", "scheduled", "assigned"],
  on_the_way: ["driver_en_route", "picked_up"],
};

function adaptOrder(raw: any): Order {
  const pickupLat = raw.pickup_lat ?? 0;
  const pickupLon = raw.pickup_lon ?? 0;
  const dropoffLat = raw.dropoff_lat ?? 0;
  const dropoffLon = raw.dropoff_lon ?? 0;
  const status = raw.status === "picked_up" ? "ride_ongoing" : raw.status;
  return {
    id: raw.id,
    passenger: {
      id: raw.client_id as any,
      full_name: `Клиент ${String(raw.client_id).slice(0, 8)}`,
      user: { id: raw.client_id as any, phone: "" },
      region: { id: "Атырау", title: "Атырау" },
      allowed_companion: raw.escort,
    },
    driver: raw.assigned_driver ? {
      id: raw.assigned_driver.id,
      name: raw.assigned_driver.name,
      car_model: raw.assigned_driver.car_model || "—",
      plate_number: raw.assigned_driver.plate_number || "—",
      user: { id: raw.assigned_driver.id, phone: raw.assigned_driver.phone || "" },
    } : null,
    driver_id: raw.assigned_driver?.id || null,
    region: { id: "Атырау", title: "Атырау" },
    pickup_title: raw.pickup_addr || "Адрес не указан",
    dropoff_title: raw.dropoff_addr || "Адрес не указан",
    pickup_lat: pickupLat,
    pickup_lon: pickupLon,
    dropoff_lat: dropoffLat,
    dropoff_lon: dropoffLon,
    pickup_coordinate: { lat: pickupLat, lon: pickupLon },
    dropoff_coordinate: { lat: dropoffLat, lon: dropoffLon },
    desired_pickup_time: `${raw.service_date}T${raw.desired_time}+05:00`,
    has_companion: Boolean(raw.escort),
    seats_needed: raw.seats || (raw.escort ? 2 : 1),
    status,
    note: raw.cancel_reason || undefined,
    created_at: raw.created_at,
    completed_at: status === "completed" ? raw.updated_at : undefined,
  };
}

async function loadOrders(params?: OrdersListParams, signal?: AbortSignal): Promise<Order[]> {
  const requestedStatus = params?.status;
  const statuses = requestedStatus ? backendStatusGroups[requestedStatus] : undefined;
  const response = await api.get<any[]>("/orders", {
    params: {
      limit: 100,
      offset: ((params?.page ?? 1) - 1) * (params?.page_size ?? ORDERS_PAGE_SIZE),
      status: requestedStatus && !statuses ? backendStatus(requestedStatus) : undefined,
      client_id: params?.passenger_id,
      service_date: params?.plan_date,
    },
    signal,
  });
  let orders = response.data.map(adaptOrder);
  if (statuses) {
    orders = orders.filter((item) => statuses.includes(backendStatus(item.status)));
  }
  if (params?.search) {
    const query = params.search.toLowerCase();
    orders = orders.filter((item) => `${item.id} ${item.pickup_title} ${item.dropoff_title}`.toLowerCase().includes(query));
  }
  return orders;
}

export const ordersApi = {
  /**
   * Получить список заказов (с пагинацией)
   */
  async getOrders(params?: OrdersListParams): Promise<Order[]> {
    return loadOrders(params);
  },

  /**
   * Получить список заказов с пагинацией (count, next, previous, results)
   */
  async getOrdersPaginated(
    params?: OrdersListParams,
    signal?: AbortSignal,
  ): Promise<PaginatedResponse<Order>> {
    const results = await loadOrders(params, signal);
    return { count: results.length, next: null, previous: null, results };
  },

  /**
   * Все заказы по фильтру (обходит пагинацию API, с ограничением числа страниц).
   */
  async getAllOrders(
    params?: OrdersListParams,
    options?: { maxPages?: number; signal?: AbortSignal },
  ): Promise<{ orders: Order[]; total: number }> {
    const pageSize = Math.min(ORDERS_MAX_PAGE_SIZE, params?.page_size ?? ORDERS_MAX_PAGE_SIZE);
    const maxPages = options?.maxPages ?? 20;
    const signal = options?.signal;
    const all: Order[] = [];
    let page = 1;
    let total = 0;

    for (;;) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const res = await this.getOrdersPaginated({ ...params, page, page_size: pageSize }, signal);
      total = res.count;
      all.push(...res.results);
      if (!res.next || res.results.length < pageSize) {
        break;
      }
      page += 1;
      if (page > maxPages) {
        break;
      }
    }

    return { orders: all, total };
  },

  /**
   * Получить заказ по ID
   */
  async getOrder(orderId: string): Promise<Order> {
    return adaptOrder((await api.get(`/orders/${orderId}`)).data);
  },

  /**
   * Создать новый заказ
   */
  async createOrder(data: CreateOrderRequest): Promise<Order> {
    let clientId = data.passenger_id;
    if (!clientId && data.passenger_phone?.trim()) {
      const digits = data.passenger_phone.replace(/\D/g, '').slice(-10);
      const clients = (await api.get<any[]>('/clients', {
        params: { search: digits, limit: 20 },
      })).data;
      const existing = clients.find((client) =>
        String(client.phone || '').replace(/\D/g, '').slice(-10) === digits
      );
      if (existing) {
        clientId = existing.user_id;
      } else {
        const created = await api.post<{ user: { id: string } }>('/auth/users', {
          phone: data.passenger_phone,
          password: '1111',
          role: 'client',
          client_profile: {
            full_name: data.passenger_name?.trim() || `Пассажир ${data.passenger_phone}`,
            needs_escort: Boolean(data.passenger_allowed_companion),
            notes: data.passenger_disability_category || null,
          },
        });
        clientId = created.data.user.id;
      }
    }
    if (!clientId) {
      throw new Error('Выберите существующего пассажира или укажите телефон нового пассажира');
    }
    const desired = new Date(data.desired_pickup_time);
    const serviceDate = Number.isNaN(desired.getTime())
      ? data.desired_pickup_time.slice(0, 10)
      : desired.toLocaleDateString("en-CA", { timeZone: "Asia/Atyrau" });
    const desiredTime = Number.isNaN(desired.getTime())
      ? data.desired_pickup_time.slice(11, 19)
      : desired.toLocaleTimeString("en-GB", { timeZone: "Asia/Atyrau", hour12: false });
    const response = await api.post("/orders", {
      client_id: clientId,
      service_date: serviceDate,
      desired_time: desiredTime,
      pickup_addr: data.pickup_title,
      pickup_lat: data.pickup_lat,
      pickup_lon: data.pickup_lon,
      dropoff_addr: data.dropoff_title,
      dropoff_lat: data.dropoff_lat,
      dropoff_lon: data.dropoff_lon,
      escort: Boolean(data.has_companion),
    });
    return adaptOrder(response.data);
  },

  /**
   * Обновить статус заказа
   */
  async updateOrderStatus(orderId: string, data: UpdateOrderStatusRequest): Promise<Order> {
    const status = backendStatus(data.status);
    if (status === "cancelled") {
      return adaptOrder((await api.post(`/orders/${orderId}/cancel`, { reason: data.reason || "Отменено диспетчером" })).data);
    }
    return adaptOrder((await api.post(`/orders/${orderId}/transition`, { to: status, meta: { reason: data.reason } })).data);
  },

  /**
   * Обновить заказ
   */
  async updateOrder(orderId: string, data: Partial<CreateOrderRequest>): Promise<Order> {
    const desired = data.desired_pickup_time ? new Date(data.desired_pickup_time) : null;
    const response = await api.patch(`/orders/${orderId}`, {
      pickup_addr: data.pickup_title,
      pickup_lat: data.pickup_lat,
      pickup_lon: data.pickup_lon,
      dropoff_addr: data.dropoff_title,
      dropoff_lat: data.dropoff_lat,
      dropoff_lon: data.dropoff_lon,
      escort: data.has_companion,
      desired_time: desired && !Number.isNaN(desired.getTime())
        ? desired.toLocaleTimeString("en-GB", { timeZone: "Asia/Atyrau", hour12: false })
        : undefined,
    });
    return adaptOrder(response.data);
  },

  /**
   * Пересчитать цену заказа
   */
  async calculatePrice(orderId: string, actualDistance?: number, actualWaitingTime?: number): Promise<Order> {
    const response = await api.post<Order>(`/orders/${orderId}/calculate-price/`, {
      actual_distance_km: actualDistance,
      actual_waiting_time_minutes: actualWaitingTime,
    });
    return response.data;
  },

  /**
   * Импорт заказов из CSV
   */
  async importOrders(
    file: File,
    options?: { dryRun?: boolean; skipErrors?: boolean }
  ): Promise<ImportResult> {
    const formData = new FormData();
    formData.append('file', file);
    
    if (options?.dryRun) {
      formData.append('dry_run', 'true');
    }
    if (options?.skipErrors) {
      formData.append('skip_errors', 'true');
    }
    
    // Не устанавливаем Content-Type вручную - axios автоматически установит его с правильным boundary для FormData
    const response = await api.post<ImportResult>('/orders/import/', formData);
    return response.data;
  },

  /**
   * Очистить все заказы (требует confirm: true)
   */
  async clearAllOrders(confirm: boolean = false): Promise<{ success: boolean; deleted_count: number }> {
    const response = await api.post<{ success: boolean; deleted_count: number }>('/orders/clear-all/', { confirm });
    return response.data;
  },

  async generateAtyrauOrders(params: {
    date?: string;
    orders_per_slot?: number;
    replace?: boolean;
  }): Promise<GenerateAtyrauOrdersResponse> {
    const response = await api.post<GenerateAtyrauOrdersResponse>('/orders/generate-atyrau/', params);
    return response.data;
  },

  /**
   * Экспорт заказов в Excel (полные данные: адреса, координаты, водитель, статус, цены)
   */
  async exportExcelTemplate(params?: ExportParams): Promise<Blob> {
    const response = await api.get('/orders/export-excel-template/', {
      params,
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Экспорт заказов по водителям
   */
  async exportOrdersByDrivers(params?: ExportParams): Promise<Blob> {
    const response = await api.get('/orders/export-by-drivers/', {
      params,
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Геокодировать адрес через Nominatim API
   */
  async geocodeAddress(address: string): Promise<GeocodeResult> {
    const response = await api.post<GeocodeResult>('/orders/geocode/', {
      address,
    });
    return response.data;
  },

  /**
   * Подсказки адресов для автодополнения
   */
  async suggestAddresses(query: string): Promise<AddressSuggestion[]> {
    const response = await api.post<{ suggestions: AddressSuggestion[] }>('/orders/geocode-suggest/', {
      query,
    });
    return response.data.suggestions ?? [];
  },

  async getCabinRecording(orderId: string): Promise<CabinRecordingInfo> {
    const response = await api.get<CabinRecordingInfo>(`/orders/${orderId}/cabin-recording/`);
    return response.data;
  },
};
