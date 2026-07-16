import api from './api';
import { ordersApi, type Order } from './orders';

export interface DispatchCandidate {
  driver_id: number;
  name: string;
  region_id: string;
  car_model: string;
  capacity: number;
  is_online: boolean;
  priority: {
    region_match: boolean;
    order_count: number;
    distance: number | null;
  };
}

export interface CandidatesResponse {
  order_id: string;
  candidates: DispatchCandidate[];
  count: number;
}

export interface AssignScheduleLeg {
  order_id: string;
  leg_index: number;
  arrival_at_pickup: string;
  desired_pickup_time: string;
  deadline_with_grace_min: number;
  deadline: string;
  minutes_to_pickup: number;
  feasible_for_this_order: boolean;
}

export interface AssignScheduleResult {
  feasible: boolean;
  message: string;
  timeline?: AssignScheduleLeg[];
  warnings?: string[];
  total_chain_minutes?: number;
}

export interface AssignOrderResponse {
  success: boolean;
  driver_id?: number;
  reason?: string;
  /** Расчёт очереди (ручное назначение с проверкой времени) */
  schedule?: AssignScheduleResult;
  order?: {
    id: string;
    status: string;
    driver: {
      id: number;
      name: string;
      car_model: string;
    };
  };
  rejection_reason?: string;
  error?: string;
  warnings?: string[];
}

export interface AutoAssignAllResponse {
  success: boolean;
  assigned: number;
  failed: number;
  total: number;
  failed_orders?: Array<{
    order_id: string;
    reason: string;
  }>;
  message?: string;
}

export interface DriverMarker {
  id: string;
  name: string;
  lat: number;
  lon: number;
  is_online: boolean;
  car_model: string;
  plate_number: string;
  region?: string;
  last_location_update?: string;
}

export interface OrderMarker {
  id: string;
  pickup_lat: number | null;
  pickup_lon: number | null;
  dropoff_lat: number | null;
  dropoff_lon: number | null;
  pickup_title: string;
  dropoff_title: string;
  status: string;
  driver_id?: string | null;
  passenger?: {
    id: string;
    full_name: string;
  } | null;
  created_at?: string;
}

export interface MapDataResponse {
  drivers: DriverMarker[];
  orders: OrderMarker[];
  drivers_count: number;
  orders_count: number;
}

export interface DayOrdersResponse {
  date: string;
  count: number;
  orders: Order[];
}

export interface RouteResponse {
  route: Array<[number, number]>;
  distance_m: number;
  distance_km: number;
  duration_seconds: number;
  duration_minutes: number;
  eta: string;
  /** yandex/osrm — по дорогам; straight — прямая (fallback, нет моста на карте) */
  geometry_source?: 'yandex' | 'osrm' | 'straight' | 'estimated';
}

export interface ETAResponse {
  eta: string;
  eta_timestamp: number;
  distance_m: number;
  distance_km: number;
  duration_minutes: number;
  duration_seconds: number;
}

export interface HeatmapDataPoint {
  lat: number;
  lon: number;
  intensity: number;
}

export interface HeatmapResponse {
  points: HeatmapDataPoint[];
}

export interface DispatcherScoreBreakdown {
  T_travel_min?: number;
  L_load?: number;
  D_delay_risk?: number;
  free_minutes_before_pickup?: number;
  orders_today_count?: number;
  total_score?: number;
  route_type?: string;
  pickup_batch_id?: string;
  pickup_batch_size?: number;
  group_size?: number;
  total_passengers?: number;
  fill_rate?: number;
  detour_percent?: number;
  trip_index?: number;
  is_minivan?: boolean;
  external?: boolean;
}

export interface DistributionCandidate {
  driver_id: number;
  driver_name: string;
  can_assign: boolean;
  reason_code?: string;
  reason?: string;
  score?: number;
  score_breakdown?: DispatcherScoreBreakdown;
  travel_to_pickup_minutes?: number;
}

export interface DailyRouteOrder {
  id: string;
  pickup_title: string;
  dropoff_title: string;
  pickup_lat: number;
  pickup_lon: number;
  dropoff_lat: number;
  dropoff_lon: number;
  desired_pickup_time: string | null;
  start_time?: string | null;
  finish_time?: string | null;
  status: string;
  passenger_name: string | null;
  has_companion: boolean;
  seats_needed: number;
  estimated_price: string | null;
  distance_km: number | null;
  note: string | null;
  score?: number;
  score_breakdown?: DispatcherScoreBreakdown;
  travel_to_pickup_minutes?: number;
  route_duration_minutes?: number;
  waiting_minutes?: number;
  /** Фактическое время подачи по плану */
  planned_pickup_time?: string | null;
  has_pickup_time_adjustment?: boolean;
  original_pickup_time?: string | null;
  adjusted_pickup_time?: string | null;
  pickup_time_offset_minutes?: number | null;
  pickup_batch_id?: string | null;
  pickup_batch_size?: number | null;
  trip_index?: number | null;
  is_minivan?: boolean;
}

export interface DriverLunchBreak {
  status: "natural" | "inserted" | string;
  start_min?: number;
  end_min?: number;
  start_time?: string;
  end_time?: string;
  label?: string;
}

export interface DailyRouteDriver {
  id: number;
  name: string;
  car_model: string;
  plate_number: string;
  phone: string | null;
  region: string | null;
  capacity: number;
  is_rental?: boolean;
}

export interface MLScoreDetails {
  cost: number;
  gap_min: number;
  gap_norm: number;
  deadhead_km: number;
  deadhead_norm: number;
  reject_norm: number;
  cancel_norm: number;
  fairness_norm: number;
  zone_norm: number;
  quality_norm: number;
  acceptance_rate: number;
  cancel_rate: number;
  rating: number;
  orders_so_far: number;
  weights: {
    w_eta: number;
    w_deadhead: number;
    w_reject: number;
    w_cancel: number;
    w_fairness: number;
    w_zone: number;
    w_quality: number;
  };
}

export interface DailyRoute {
  driver: DailyRouteDriver;
  orders: DailyRouteOrder[];
  scores: Array<{ order_id: string } & MLScoreDetails>;
  total_orders: number;
  total_distance_km: number;
  lunch?: DriverLunchBreak | null;
  is_minivan?: boolean;
  is_rental?: boolean;
}

export interface RentalVehicle {
  id: number;
  name: string;
  car_model: string;
  plate_number: string;
  capacity: number;
  is_rental: boolean;
  is_online?: boolean;
  region?: string | null;
  orders_count?: number;
  start_lat?: number | null;
  start_lon?: number | null;
}

export interface RentalAssignResponse {
  success: boolean;
  driver: RentalVehicle;
  assigned_order_ids: string[];
  routes?: DailyRoute[];
  message?: string;
  error?: string;
}

export interface DailyRoutesConfig {
  name?: string;
  shift_start?: string;
  shift_end?: string;
  load_per_order?: number;
  w_eta?: number;
  w_deadhead?: number;
  w_reject?: number;
  w_cancel?: number;
  w_fairness?: number;
  w_zone?: number;
  w_quality?: number;
}

export interface DailyRoutesResponse {
  date: string;
  algorithm: string;
  config: DailyRoutesConfig;
  total_orders: number;
  unassigned_count: number;
  already_assigned_count: number;
  distributed_count: number;
  failed_count: number;
  drivers_count: number;
  routes: DailyRoute[];
  assignments: Array<{
    order_id: string;
    driver_id: number;
    driver_name: string;
    ml_cost?: number;
    ml_details?: MLScoreDetails | DispatcherScoreBreakdown;
    score?: number;
    score_breakdown?: DispatcherScoreBreakdown;
    travel_to_pickup_minutes?: number;
    finish_time?: string;
  }>;
  unassigned_orders: Array<{
    id: string;
    reason: string;
    reason_code?: string;
    pickup_time?: string | null;
    pickup_title?: string;
    hour?: number;
    hour_label?: string;
    suggested_action?: string;
    candidates_checked?: DistributionCandidate[];
  }>;
  logs?: Array<{ id: number; order_id: string; status: string }>;
  auto_assigned: boolean;
  reoptimized?: boolean;
  reassigned_count?: number;
  locked_count?: number;
  flagged_for_dispatcher_count?: number;
  pickup_time_adjustments_count?: number;
  minivan_groups_assigned?: number;
  minivan_group_orders_assigned?: number;
  /** Статистика внешнего роутера (used_drivers, unused_driver_ids, …) */
  router_stats?: Record<string, unknown>;
  /** Водители, не получившие маршрут после оптимизации */
  unused_drivers?: Array<{ id: string; name: string; region: string | null }>;
  drivers_on_line?: number;
  drivers_total_pool?: number;
  statistics?: DistributionStatistics;
  /** Пошаговое распределение по 1-часовому слоту */
  status?: 'success' | 'empty' | 'complete';
  message?: string;
  slot_start?: string;
  slot_end?: string;
  slot_start_iso?: string;
  slot_end_iso?: string;
  assigned_orders?: number;
  manual_required_orders?: number;
  drivers?: SlotDriverSummary[];
  manual_required?: ManualRequiredItem[];
}

export interface ManualRequiredItem {
  order_id: string;
  reason: string;
}

export interface RouteSheetStop {
  type: 'pickup' | 'dropoff';
  order_id: string;
  time?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface SlotDriverSummary {
  driver_id: number;
  driver_name: string;
  car_model: string;
  capacity: number;
  assigned_orders: string[];
  total_passengers: number;
  route_status: string;
  route_sheet: RouteSheetStop[];
  slot_start?: string;
  slot_end?: string;
}

export type DayTimeSlotStatus = 'empty' | 'pending' | 'partial' | 'done';

export interface DayTimeSlot {
  slot_start: string;
  slot_end: string;
  slot_start_label: string;
  slot_end_label: string;
  label: string;
  orders_total: number;
  orders_assigned: number;
  orders_pending: number;
  status: DayTimeSlotStatus;
}

export interface DayTimeSlotsResponse {
  date: string;
  status: 'ok' | 'empty';
  message?: string;
  anchor_pickup?: string | null;
  slots: DayTimeSlot[];
}

export type DistributeSlotMode = 'first' | 'next' | 'specific';

export interface ImportPlanResponse {
  plan_date: string;
  file: string;
  rows: number;
  assigned: number;
  drivers_created: number;
  not_found: number;
  errors: number;
  not_found_ids: string[];
  created_drivers: string[];
  error_details: string[];
  dry_run: boolean;
}

export interface ResetAssignmentsResponse {
  date: string;
  reset_count: number;
  drivers_reset: number;
  locked_count: number;
  locked_order_ids: string[];
  message: string;
}

export interface PickupTimeAdjustmentItem {
  id: number;
  order_id: string;
  passenger_name: string | null;
  pickup_title: string;
  dropoff_title: string;
  original_pickup_time: string;
  adjusted_pickup_time: string;
  offset_minutes: number;
  driver_id: number | null;
  driver_name: string | null;
  passenger_notified: boolean;
  notified_at: string | null;
  source: string;
  plan_date: string;
}

export interface PickupTimeAdjustmentsResponse {
  plan_date: string;
  count: number;
  unnotified_count: number;
  items: PickupTimeAdjustmentItem[];
}

export interface DistributionHourlySlot {
  hour: number;
  label: string;
  total: number;
  assigned: number;
  unassigned: number;
}

export interface DistributionDriverStats {
  total: number;
  active: number;
  idle: number;
  distributed_orders: number;
  avg_orders_per_active_driver: number;
  max_orders_on_driver: number;
  recommended_extra_drivers: number;
}

export interface DistributionStatistics {
  hourly: DistributionHourlySlot[];
  peak_hours: DistributionHourlySlot[];
  peak_unassigned_hours: DistributionHourlySlot[];
  drivers: DistributionDriverStats;
  unassigned_by_hour: Array<{
    hour: number;
    label: string;
    count: number;
    orders: DailyRoutesResponse['unassigned_orders'];
  }>;
  reason_breakdown: Array<{
    reason_code: string;
    count: number;
    action: string;
    label: string;
    detail: string;
  }>;
  recommendations: Array<{ type: string; message: string }>;
  assigned_order_count: number;
}

export interface DashboardDistributionSummary {
  total: number;
  assigned: number;
  unassigned: number;
  drivers_total: number;
  drivers_active: number;
  drivers_idle: number;
  recommended_extra_drivers: number;
}

export interface DashboardDriverLoad {
  driver_id: number;
  driver_name: string;
  orders_count: number;
}

export interface DashboardHourOrder {
  id: string;
  pickup_time: string | null;
  pickup_title: string;
  dropoff_title: string;
  status: string;
  assigned: boolean;
  driver_id: number | null;
  driver_name: string | null;
  driver_region: string | null;
  passenger_region: string | null;
}

export interface DashboardDistributionResponse {
  date: string;
  source: 'database';
  summary: DashboardDistributionSummary;
  statistics: DistributionStatistics;
  driver_load: DashboardDriverLoad[];
  orders_by_hour: Record<string, DashboardHourOrder[]>;
  routes?: DailyRoute[];
  unassigned_orders?: DailyRoutesResponse["unassigned_orders"];
  failed_count?: number;
}

export interface DispatchConfigData {
  id: number;
  name: string;
  is_active: boolean;
  assignment_mode: 'direct' | 'offers';
  auto_dispatch_enabled: boolean;
  shift_start: string;
  shift_end: string;
  eta_max_seconds: number;
  max_deadhead_km: number | null;
  k_candidates: number;
  offer_timeout_seconds: number;
  w_eta: number;
  w_deadhead: number;
  w_reject: number;
  w_cancel: number;
  w_fairness: number;
  w_zone: number;
  w_quality: number;
}

export interface DispatchJobStartResponse {
  job_id: string;
  status: 'running';
}

export interface DispatchJobSlotProgress {
  slot_label: string;
  status: 'pending' | 'running' | 'done';
  orders_total: number;
  orders_assigned: number;
  orders_unassigned: number;
  radius_stage?: string | null;
}

export interface DispatchJobProgress {
  slots: DispatchJobSlotProgress[];
  slots_total: number;
  slots_done: number;
  percent: number;
  percent_mode?: 'orders' | 'slots';
  orders_assigned: number;
  orders_unassigned: number;
  orders_total: number;
  phase?: 'minivan_groups' | 'time_slots' | 'finalize';
  phase_updated_at?: string;
  minivan_groups_assigned?: number;
  minivan_group_orders_assigned?: number;
}

export interface DispatchJobStatusResponse {
  job_id: string;
  status: 'running' | 'completed' | 'failed';
  label?: string;
  started_at?: string;
  finished_at?: string;
  progress?: DispatchJobProgress;
  result?: DailyRoutesResponse | DistributionSnapshotExportResult;
  error?: string;
}

export interface DistributionSnapshotExportResult {
  json_body: string;
  filename: string;
  plan_date: string;
  size_bytes: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const HEAVY_JOB_POLL = { intervalMs: 2000, maxAttempts: 180 } as const;
/** Слот ~90 заказов: до 30 мин на сервере (swap + OSRM). */
const SLOT_JOB_POLL = { intervalMs: 2000, maxAttempts: 960 } as const;
/** Оптимизация ~800 заказов: до 30 мин на сервере (DISPATCH_HEAVY_SUBPROCESS_TIMEOUT). */
const OPTIMIZE_JOB_POLL = { intervalMs: 2000, maxAttempts: 960 } as const;

export function dispatchJobStorageKey(planDate: string): string {
  return `invotaxi:dispatch-job:${planDate}`;
}

export function saveDispatchJobId(planDate: string, jobId: string): void {
  try {
    sessionStorage.setItem(dispatchJobStorageKey(planDate), jobId);
  } catch {
    /* ignore */
  }
}

export function clearDispatchJobId(planDate: string): void {
  try {
    sessionStorage.removeItem(dispatchJobStorageKey(planDate));
  } catch {
    /* ignore */
  }
}

/** Увеличить при optimize — отменяет poll preview и не грузит daphne двумя job. */
let heavyJobPollGeneration = 0;

export function bumpHeavyJobPollGeneration(): number {
  heavyJobPollGeneration += 1;
  return heavyJobPollGeneration;
}

export async function followDispatchJob(
  jobId: string,
  options?: {
    intervalMs?: number;
    maxAttempts?: number;
    pollGeneration?: number;
    onProgress?: (progress: DispatchJobProgress) => void;
    optimize?: boolean;
    slot?: boolean;
  }
): Promise<DailyRoutesResponse> {
  const poll = options?.optimize
    ? OPTIMIZE_JOB_POLL
    : options?.slot
      ? SLOT_JOB_POLL
      : HEAVY_JOB_POLL;
  return waitForDispatchJob(jobId, {
    intervalMs: options?.intervalMs ?? poll.intervalMs,
    maxAttempts: options?.maxAttempts ?? poll.maxAttempts,
    pollGeneration: options?.pollGeneration,
    onProgress: options?.onProgress,
  });
}

async function waitForDispatchJob(
  jobId: string,
  options?: {
    intervalMs?: number;
    maxAttempts?: number;
    pollGeneration?: number;
    onProgress?: (progress: DispatchJobProgress) => void;
  }
): Promise<DailyRoutesResponse> {
  const intervalMs = options?.intervalMs ?? HEAVY_JOB_POLL.intervalMs;
  const maxAttempts = options?.maxAttempts ?? HEAVY_JOB_POLL.maxAttempts;
  const pollGeneration = options?.pollGeneration ?? heavyJobPollGeneration;
  const onProgress = options?.onProgress;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (pollGeneration !== heavyJobPollGeneration) {
      throw new Error('Отменено: запущена другая задача планирования');
    }
    const job = await dispatchApi.getDispatchJob(jobId);
    if (job.progress && onProgress) {
      onProgress(job.progress);
    }
    if (job.status === 'completed' && job.result) {
      return job.result as DailyRoutesResponse;
    }
    if (job.status === 'failed') {
      throw new Error(job.error || 'Ошибка фоновой задачи dispatch');
    }
    await sleep(intervalMs);
  }
  throw new Error('Превышено время ожидания задачи dispatch');
}

async function waitForSnapshotExportJob(
  jobId: string,
  options?: { intervalMs?: number; maxAttempts?: number },
): Promise<{ body: string; filename: string }> {
  const intervalMs = options?.intervalMs ?? HEAVY_JOB_POLL.intervalMs;
  const maxAttempts = options?.maxAttempts ?? HEAVY_JOB_POLL.maxAttempts;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const job = await dispatchApi.getDispatchJob(jobId);
    if (job.status === 'completed' && job.result) {
      const payload = job.result as DistributionSnapshotExportResult;
      if (typeof payload.json_body === 'string' && payload.json_body.length > 0) {
        return {
          body: payload.json_body,
          filename: payload.filename || 'distribution_snapshot.json',
        };
      }
      throw new Error('Пустой ответ снимка распределения');
    }
    if (job.status === 'failed') {
      throw new Error(job.error || 'Ошибка формирования JSON-снимка');
    }
    await sleep(intervalMs);
  }
  throw new Error('Превышено время ожидания формирования JSON-снимка');
}

export interface DriverWorkloadRow {
  driver_name: string;
  orders_count: number;
  avg_load_per_trip: number;
  hours_day: number;
  minutes_day: number;
  hours_week: number;
  minutes_week: number;
  avg_orders: number;
  km_week: number;
  km_day: number;
}

export interface DriverWorkloadReportResponse {
  headers: string[];
  rows: DriverWorkloadRow[];
  count: number;
  period: 'day' | 'week' | 'range';
  anchor_date: string;
  date_from: string | null;
  date_to: string | null;
}

async function loadCurrentPlan(date?: string): Promise<DailyRoutesResponse> {
  const planDate = date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Atyrau' });
  const [plansResponse, ordersResponse, driversResponse] = await Promise.all([
    api.get<any[]>('/plans', { params: { date: planDate } }),
    ordersApi.getOrders({ plan_date: planDate, page_size: 100 }),
    api.get<any[]>('/drivers', { params: { limit: 200 } }),
  ]);
  const summary = plansResponse.data.sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const plan = summary ? (await api.get<any>(`/plans/${summary.id}`)).data : null;
  const driverMap = new Map(driversResponse.data.map((d:any) => [d.user_id, d]));
  const orderMap = new Map(ordersResponse.map((o) => [o.id, o]));
  const assigned = new Set<string>();
  const routes: DailyRoute[] = (plan?.drivers || []).map((entry:any) => {
    const driver = driverMap.get(entry.driver_id) || {};
    const ids:string[] = (entry.blocks || []).flatMap((block:any) => block.order_ids || []);
    ids.forEach((id) => assigned.add(id));
    const routeOrders: DailyRouteOrder[] = ids.map((id) => orderMap.get(id)).filter(Boolean).map((order:any) => ({
      id: order.id, pickup_title: order.pickup_title, dropoff_title: order.dropoff_title,
      pickup_lat: order.pickup_lat, pickup_lon: order.pickup_lon, dropoff_lat: order.dropoff_lat, dropoff_lon: order.dropoff_lon,
      desired_pickup_time: order.desired_pickup_time, status: order.status,
      passenger_name: order.passenger?.full_name || null, has_companion: order.has_companion,
      seats_needed: order.seats_needed || 1, estimated_price: null, distance_km: null, note: order.note || null,
    }));
    return {
      driver: { id: entry.driver_id as any, name: driver.full_name || 'Водитель', car_model: driver.vehicle_model || '—', plate_number: driver.plate || '—', phone: null, region: driver.region || 'Атырау', capacity: driver.capacity || 4 },
      orders: routeOrders, scores: [], total_orders: routeOrders.length, total_distance_km: 0,
      lunch: entry.lunch ? { status: 'inserted', start_min: entry.lunch.start_min, end_min: entry.lunch.end_min } : null,
    };
  });
  const unassigned = ordersResponse.filter((o) => !assigned.has(o.id) && !['completed','cancelled'].includes(o.status));
  return {
    date: planDate, algorithm: 'invotaxi-routing', config: {}, total_orders: ordersResponse.length,
    unassigned_count: unassigned.length, already_assigned_count: assigned.size, distributed_count: assigned.size,
    failed_count: plan?.exceptions?.length || 0, drivers_count: routes.length, routes,
    assignments: routes.flatMap((r) => r.orders.map((o) => ({ order_id:o.id, driver_id:r.driver.id, driver_name:r.driver.name }))),
    unassigned_orders: unassigned.map((o) => ({ id:o.id, reason:'Не включён в опубликованный план', pickup_time:o.desired_pickup_time, pickup_title:o.pickup_title })),
    auto_assigned: Boolean(plan),
  };
}

export const dispatchApi = {
  /**
   * Получить кандидатов для заказа
   */
  async getCandidates(orderId: string): Promise<CandidatesResponse> {
    const response = await api.get<CandidatesResponse>(`/dispatch/candidates/${orderId}/`);
    return response.data;
  },

  /**
   * Назначить заказ водителю
   */
  async assignOrder(orderId: string, driverId?: string): Promise<AssignOrderResponse> {
    try {
      const response = await api.post<AssignOrderResponse>(`/dispatch/assign/${orderId}/`, driverId ? { driver_id: driverId } : {});
      const data = response.data;
      
      // Проверяем success: false даже при успешном HTTP-ответе
      if (data.success === false) {
        const errorMessage = data.rejection_reason || data.reason || data.error || 'Не удалось назначить водителя';
        const error: any = new Error(errorMessage);
        error.response = { data };
        throw error;
      }
      
      return data;
    } catch (err: any) {
      // Если это уже обработанная ошибка от axios interceptor, просто пробрасываем её
      if (err.response) {
        throw err;
      }
      // Иначе создаем ошибку с деталями
      throw err;
    }
  },

  /**
   * Автоматическое назначение всех заказов в очереди
   */
  async autoAssignAll(): Promise<AutoAssignAllResponse> {
    const response = await api.post<AutoAssignAllResponse>('/dispatch/auto-assign-all/');
    return response.data;
  },

  /**
   * Получить данные для карты диспетчеризации
   */
  async getMapData(): Promise<MapDataResponse> {
    const [drivers, live, orders] = await Promise.all([
      api.get<any[]>('/drivers', { params: { limit: 200 } }),
      api.get<any[]>('/drivers/live').catch(() => ({ data: [] })),
      api.get<any[]>('/orders', { params: { limit: 100 } }),
    ]);
    const liveMap = new Map(live.data.map((p:any) => [p.driver_id, p]));
    const driverMarkers = drivers.data.map((d:any) => { const p:any=liveMap.get(d.user_id); return {id:d.user_id,name:d.full_name,lat:p?.lat ?? d.home_lat ?? 0,lon:p?.lon ?? d.home_lon ?? 0,is_online:d.is_online,car_model:d.vehicle_model||'—',plate_number:d.plate||'—',region:d.region,last_location_update:p?.ts}; }).filter((d:any)=>d.lat&&d.lon);
    const orderMarkers = orders.data.map((o:any)=>({id:o.id,pickup_lat:o.pickup_lat,pickup_lon:o.pickup_lon,dropoff_lat:o.dropoff_lat,dropoff_lon:o.dropoff_lon,pickup_title:o.pickup_addr||'Адрес не указан',dropoff_title:o.dropoff_addr||'Адрес не указан',status:o.status,driver_id:null,passenger:{id:o.client_id,full_name:`Клиент ${String(o.client_id).slice(0,8)}`},created_at:o.created_at}));
    return {drivers:driverMarkers,orders:orderMarkers,drivers_count:driverMarkers.length,orders_count:orderMarkers.length};
  },

  /**
   * Все заказы дня для диспетчерской (один запрос, без пагинации).
   */
  async getDayOrders(date: string): Promise<DayOrdersResponse> {
    const orders = await ordersApi.getOrders({ plan_date: date, page_size: 100 });
    return { date, count: orders.length, orders };
  },

  /**
   * Получить маршрут между двумя точками
   */
  async getRoute(lat1: number, lon1: number, lat2: number, lon2: number): Promise<RouteResponse> {
    const response = await api.get<RouteResponse>('/dispatch/route/', {
      params: { lat1, lon1, lat2, lon2 }
    });
    return response.data;
  },

  /**
   * Получить маршрут водителя до активного заказа
   */
  async getDriverRoute(driverId: string): Promise<RouteResponse & { order_id: string }> {
    const response = await api.get<RouteResponse & { order_id: string }>(`/dispatch/driver-route/${driverId}/`);
    return response.data;
  },

  /**
   * Получить маршрут заказа (от точки забора до точки высадки)
   */
  async getOrderRoute(orderId: string): Promise<RouteResponse> {
    const response = await api.get<RouteResponse>(`/dispatch/order-route/${orderId}/`);
    return response.data;
  },

  /**
   * Получить расчетное время прибытия (ETA) водителя к заказу
   */
  async getETA(driverId: string, orderId: string): Promise<ETAResponse> {
    const response = await api.get<ETAResponse>(`/dispatch/eta/${driverId}/${orderId}/`);
    return response.data;
  },

  /**
   * Получить данные для тепловой карты спроса
   */
  async getHeatmapData(): Promise<HeatmapResponse> {
    const response = await api.get<HeatmapResponse>('/dispatch/heatmap/');
    return response.data;
  },

  /**
   * Получить предварительное распределение заказов на день (GET) — async job + poll
   */
  async getDailyRoutes(date?: string, options?: { pollGeneration?: number }): Promise<DailyRoutesResponse> {
    void options;
    return loadCurrentPlan(date);
  },

  /**
   * Применить распределение заказов на день (POST) — async job + poll
   */
  async applyDailyRoutes(date?: string): Promise<DailyRoutesResponse> {
    const planDate = date || new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Atyrau'});
    const started = await api.post<{job_id:string}>('/dispatch/jobs', { service_date:planDate, district:'Атырау', config_overrides:{} });
    for(let attempt=0;attempt<450;attempt++){
      const job=(await api.get<any>(`/dispatch/jobs/${started.data.job_id}`)).data;
      if(job.status==='done') return loadCurrentPlan(planDate);
      if(job.status==='failed') throw new Error('Распределение завершилось с ошибкой');
      await sleep(2000);
    }
    throw new Error('Превышено время ожидания распределения');
  },

  async getDispatchJob(jobId: string): Promise<DispatchJobStatusResponse> {
    const job=(await api.get<any>(`/dispatch/jobs/${jobId}`)).data;
    return {job_id:job.id,status:job.status==='done'?'completed':job.status,error:job.error};
  },

  async getActiveDispatchJob(date?: string): Promise<DispatchJobStatusResponse | null> {
    void date;
    return null;
  },

  /**
   * Экспорт маршрутов дня: ZIP с отдельным XLSX для каждого водителя
   */
  async exportDailyRoutes(date?: string): Promise<Blob> {
    const params = date ? { date } : {};
    const response = await api.get('/dispatch/daily-routes-export/', {
      params,
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Пакет отчётов на день: ZIP (summary, assignments, unassigned, adjustments, workload, routes).
   * Быстро, из БД — без симуляции.
   */
  async exportDayReports(date?: string): Promise<Blob> {
    const params = date ? { date } : {};
    const response = await api.get('/dispatch/day-reports-export/', {
      params,
      responseType: 'blob',
      timeout: 120_000,
    });
    return response.data;
  },

  /** XLSX нераспределённых заказов на день. */
  async exportUnassignedOrders(date?: string): Promise<Blob> {
    const params = date ? { date } : {};
    const response = await api.get('/dispatch/unassigned-export/', {
      params,
      responseType: 'blob',
      timeout: 60_000,
    });
    return response.data;
  },

  /**
   * Полный JSON-снимок распределения на день (заказы, водители, логи, маршруты из БД).
   */
  async exportDistributionSnapshot(
    date?: string,
    options?: { preview?: boolean; workload?: boolean },
  ): Promise<Blob> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (options?.preview) params.preview = '1';
    // По умолчанию без workload — быстрее и надёжнее для анализа алгоритма.
    if (options?.workload === true) {
      params.workload = '1';
    } else {
      params.workload = '0';
    }

    const response = await api.get<DispatchJobStartResponse>('/dispatch/distribution-snapshot/', {
      params,
      timeout: 60_000,
    });

    if (response.status === 202 && response.data?.job_id) {
      const pollOptions = options?.preview
        ? { intervalMs: 2000, maxAttempts: 300 }
        : { intervalMs: 1500, maxAttempts: 120 };
      const { body } = await waitForSnapshotExportJob(response.data.job_id, pollOptions);
      return new Blob([body], { type: 'application/json;charset=utf-8' });
    }

    throw new Error('Сервер не запустил задачу экспорта JSON');
  },

  /**
   * Быстрая сводка распределения на день для главной панели (без OSRM).
   */
  async getDashboardDistribution(date?: string): Promise<DashboardDistributionResponse> {
    const planDate=date||new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Atyrau'});
    const [orders,drivers,plan]=await Promise.all([
      ordersApi.getOrders({plan_date:planDate,page_size:100}),
      api.get<any[]>('/drivers',{params:{limit:200}}),
      loadCurrentPlan(planDate),
    ]);
    const driverByOrder=new Map<string,DailyRoute>();
    plan.routes.forEach(route=>route.orders.forEach(order=>driverByOrder.set(order.id,route)));
    const ordersByHour:Record<string,DashboardHourOrder[]>={};
    for(const order of orders){
      const hour=String(new Date(order.desired_pickup_time).getHours()).padStart(2,'0');
      const route=driverByOrder.get(order.id);
      (ordersByHour[hour]??=[]).push({id:order.id,pickup_time:order.desired_pickup_time,pickup_title:order.pickup_title,dropoff_title:order.dropoff_title,status:order.status,assigned:Boolean(route),driver_id:route?.driver.id??null,driver_name:route?.driver.name??null,driver_region:route?.driver.region??null,passenger_region:'Атырау'});
    }
    const hourly=Array.from({length:24},(_,hour)=>{const items=ordersByHour[String(hour).padStart(2,'0')]||[];const assigned=items.filter(i=>i.assigned).length;return {hour,label:`${String(hour).padStart(2,'0')}:00`,total:items.length,assigned,unassigned:items.length-assigned};});
    const active=plan.routes.filter(r=>r.total_orders>0).length;
    const stats:DistributionStatistics={hourly,peak_hours:[...hourly].sort((a,b)=>b.total-a.total).slice(0,3),peak_unassigned_hours:[...hourly].sort((a,b)=>b.unassigned-a.unassigned).slice(0,3),drivers:{total:drivers.data.length,active,idle:Math.max(0,drivers.data.length-active),distributed_orders:plan.distributed_count,avg_orders_per_active_driver:active?plan.distributed_count/active:0,max_orders_on_driver:Math.max(0,...plan.routes.map(r=>r.total_orders)),recommended_extra_drivers:0},unassigned_by_hour:[],reason_breakdown:[],recommendations:[],assigned_order_count:plan.distributed_count};
    return {date:planDate,source:'database',summary:{total:orders.length,assigned:plan.distributed_count,unassigned:plan.unassigned_count,drivers_total:drivers.data.length,drivers_active:active,drivers_idle:Math.max(0,drivers.data.length-active),recommended_extra_drivers:0},statistics:stats,driver_load:plan.routes.map(r=>({driver_id:r.driver.id,driver_name:r.driver.name,orders_count:r.total_orders})),orders_by_hour:ordersByHour,routes:plan.routes,unassigned_orders:plan.unassigned_orders,failed_count:plan.failed_count};
  },

  /**
   * JSON-отчёт по нагрузке водителей (таблица в Analytics).
   */
  async getDriverWorkloadReport(params: {
    period: 'day' | 'week' | 'range';
    date: string;
    date_from?: string;
    date_to?: string;
    driver_filter?: 'with_orders' | 'all' | 'active';
  }): Promise<DriverWorkloadReportResponse> {
    const plan=await loadCurrentPlan(params.date);
    const rows=plan.routes.map((r)=>({driver_name:r.driver.name,orders_count:r.total_orders,avg_load_per_trip:r.total_orders?1:0,hours_day:0,minutes_day:0,hours_week:0,minutes_week:0,avg_orders:r.total_orders,km_week:r.total_distance_km,km_day:r.total_distance_km}));
    return {headers:['Водитель','Заказы'],rows,count:rows.length,period:params.period,anchor_date:params.date,date_from:params.date_from||null,date_to:params.date_to||null};
  },

  /**
   * XLSX-отчёт по нагрузке водителей (выполненные заказы).
   */
  async exportDriverWorkloadReport(params: {
    period: 'day' | 'week' | 'range';
    date: string;
    date_from?: string;
    date_to?: string;
    driver_filter?: 'with_orders' | 'all' | 'active';
  }): Promise<Blob> {
    const report=await this.getDriverWorkloadReport(params);
    const csv=`\uFEFFdriver,orders,km\n${report.rows.map(r=>`${r.driver_name},${r.orders_count},${r.km_day}`).join('\n')}`;
    return new Blob([csv],{type:'text/csv;charset=utf-8'});
  },

  async getDispatchConfig(): Promise<DispatchConfigData> {
    const response = await api.get<DispatchConfigData>('/dispatch/config/');
    return response.data;
  },

  async updateDispatchConfig(
    partial: Partial<Pick<DispatchConfigData, 'auto_dispatch_enabled' | 'assignment_mode'>>
  ): Promise<DispatchConfigData> {
    const response = await api.patch<DispatchConfigData>('/dispatch/config/', partial);
    return response.data;
  },

  /** Список арендных машин (с числом заказов на дату, если date задан). */
  async listRentalVehicles(date?: string): Promise<{ date: string | null; vehicles: RentalVehicle[] }> {
    const params = date ? { date } : {};
    const response = await api.get<{ date: string | null; vehicles: RentalVehicle[] }>(
      '/dispatch/rental-vehicles/',
      { params },
    );
    return response.data;
  },

  /** Создать арендную машину. */
  async createRentalVehicle(payload?: {
    date?: string;
    name?: string;
    plate_number?: string;
    capacity?: number;
  }): Promise<{ success: boolean; driver: RentalVehicle; vehicles: RentalVehicle[] }> {
    const response = await api.post<{ success: boolean; driver: RentalVehicle; vehicles: RentalVehicle[] }>(
      '/dispatch/rental-vehicles/',
      payload ?? {},
    );
    return response.data;
  },

  /**
   * Распределить нераспределённый заказ(ы) на арендную машину.
   * Если rental_driver_id не указан — берётся свободная аренда или создаётся новая.
   */
  async assignToRental(payload: {
    date: string;
    order_id?: string;
    order_ids?: string[];
    rental_driver_id?: number;
  }): Promise<RentalAssignResponse> {
    const response = await api.post<RentalAssignResponse>('/dispatch/rental-assign/', payload);
    return response.data;
  },

  async startOptimizeDay(date?: string): Promise<string> {
    bumpHeavyJobPollGeneration();
    const params = date ? { date } : {};
    const response = await api.post<DispatchJobStartResponse>('/dispatch/optimize-day/', {}, { params });
    if (response.status === 202 && response.data.job_id) {
      if (date) saveDispatchJobId(date, response.data.job_id);
      return response.data.job_id;
    }
    throw new Error('Сервер не запустил оптимизацию');
  },

  async optimizeDay(
    date?: string,
    options?: {
      onProgress?: (progress: DispatchJobProgress) => void;
      onJobStarted?: (jobId: string) => void;
    }
  ): Promise<DailyRoutesResponse> {
    bumpHeavyJobPollGeneration();
    const params = date ? { date } : {};
    const response = await api.post<DispatchJobStartResponse>('/dispatch/optimize-day/', {}, { params });
    if (response.status === 202 && response.data.job_id) {
      if (date) saveDispatchJobId(date, response.data.job_id);
      options?.onJobStarted?.(response.data.job_id);
      return followDispatchJob(response.data.job_id, {
        optimize: true,
        onProgress: options?.onProgress,
      });
    }
    return response.data as unknown as DailyRoutesResponse;
  },

  async getPickupTimeAdjustments(
    planDate: string,
    options?: { notified?: boolean }
  ): Promise<PickupTimeAdjustmentsResponse> {
    const params: Record<string, string> = { plan_date: planDate };
    if (options?.notified === false) params.notified = '0';
    if (options?.notified === true) params.notified = '1';
    const response = await api.get<PickupTimeAdjustmentsResponse>(
      '/dispatch/pickup-time-adjustments/',
      { params }
    );
    return response.data;
  },

  async markPickupTimeNotified(adjustmentId: number): Promise<{ success: boolean }> {
    const response = await api.post<{ success: boolean }>(
      `/dispatch/pickup-time-adjustments/${adjustmentId}/mark-notified/`
    );
    return response.data;
  },

  async getDayTimeSlots(date?: string): Promise<DayTimeSlotsResponse> {
    const params = date ? { date } : {};
    const response = await api.get<DayTimeSlotsResponse>('/dispatch/day-time-slots/', { params });
    return response.data;
  },

  async startDistributeSlot(
    date: string,
    options: {
      mode: DistributeSlotMode;
      slot_start?: string;
      auto_assign?: boolean;
    },
  ): Promise<string> {
    bumpHeavyJobPollGeneration();
    const params: Record<string, string> = { date, mode: options.mode };
    if (options.slot_start) params.slot_start = options.slot_start;
    if (options.auto_assign === false) params.auto_assign = 'false';
    const response = await api.post<DispatchJobStartResponse | DailyRoutesResponse>(
      '/dispatch/distribute-slot/',
      {},
      { params },
    );
    if (response.status === 202 && 'job_id' in response.data && response.data.job_id) {
      saveDispatchJobId(date, response.data.job_id);
      return response.data.job_id;
    }
    throw new Error(
      (response.data as { message?: string; error?: string }).message
        || (response.data as { error?: string }).error
        || 'Сервер не запустил распределение слота',
    );
  },

  async distributeSlot(
    date: string,
    options: {
      mode: DistributeSlotMode;
      slot_start?: string;
      auto_assign?: boolean;
      onProgress?: (progress: DispatchJobProgress) => void;
      onJobStarted?: (jobId: string) => void;
    },
  ): Promise<DailyRoutesResponse> {
    const jobId = await dispatchApi.startDistributeSlot(date, options);
    options.onJobStarted?.(jobId);
    return followDispatchJob(jobId, {
      onProgress: options.onProgress,
    });
  },

  /**
   * Загрузить готовый Excel-план маршрутизации и применить как диспетчеризацию.
   * Заказы сопоставляются по их ID, недостающие водители создаются автоматически.
   */
  async importDispatchPlan(
    file: File,
    options?: { date?: string; dryRun?: boolean; defaultRegion?: string },
  ): Promise<ImportPlanResponse> {
    const form = new FormData();
    form.append('file', file);
    if (options?.date) form.append('date', options.date);
    if (options?.dryRun) form.append('dry_run', '1');
    if (options?.defaultRegion) form.append('default_region', options.defaultRegion);
    const response = await api.post<ImportPlanResponse>('/dispatch/import-plan/', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 180_000,
    });
    return response.data;
  },

  async resetDriverAssignments(date: string): Promise<ResetAssignmentsResponse> {
    const response = await api.post<ResetAssignmentsResponse>(
      '/dispatch/reset-assignments/',
      {},
      { params: { date } },
    );
    return response.data;
  },
};
