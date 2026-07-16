import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Clock, MapPin, User, Car, Phone, Check, X, Loader2, RefreshCw, Eye, Wifi, WifiOff, AlertCircle, Calendar, Navigation, Users, Route, Sparkles, Undo2, Upload } from "lucide-react";
import { DayRoutesPanel } from "./DayRoutesPanel";
import { DistributionProgressPanel } from "./DistributionProgressPanel";
import { PickupTimeAdjustmentsPanel } from "./PickupTimeAdjustmentsPanel";
import { Modal } from "./Modal";
import { RouteMapView } from "./RouteMapView";
import { ordersApi, Order } from "../services/orders";
import { dispatchApi, DailyRoute, DailyRouteOrder, DailyRoutesResponse, DashboardDistributionResponse, DispatchJobProgress, bumpHeavyJobPollGeneration, followDispatchJob, clearDispatchJobId, dispatchJobStorageKey, saveDispatchJobId } from "../services/dispatch";
import { driversApi, Driver } from "../services/drivers";
import { regionsApi, Region, City } from "../services/regions";
import { toast } from "sonner";
import { getDispatchMapWebSocket } from "../services/websocket";
import { loadYmaps } from "../../shared/yandex/loadYmaps";
import { ATYRAU_MAP_CENTER, YANDEX_OBLAST_BOUNDS } from "../../shared/yandex/bounds";
import { isSuspiciousStraightRoute } from "../../shared/yandex/drivingRoute";
import { fetchRoadRouteForMap } from "../../shared/routing/roadRoute";

/** Завтрашняя календарная дата YYYY-MM-DD в зоне Asia/Atyrau (заказы создаются на завтра) */
function getTomorrowDateInAtyrau(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Atyrau",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parseInt(parts.find((p) => p.type === "year")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "month")?.value ?? "0", 10);
  const day = parseInt(parts.find((p) => p.type === "day")?.value ?? "0", 10);
  const next = new Date(Date.UTC(y, m - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

/** Календарная дата подачи заказа YYYY-MM-DD в Asia/Atyrau */
function getOrderPlanDateInAtyrau(desiredPickupTime: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Atyrau",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(desiredPickupTime));
}

function orderMatchesPlanDate(order: { desired_pickup_time: string }, planDate: string): boolean {
  return getOrderPlanDateInAtyrau(order.desired_pickup_time) === planDate;
}

/** Статусы очереди и активных заказов на карте диспетчерской. */
const DISPATCH_QUEUE_STATUSES = new Set([
  "submitted",
  "awaiting_dispatcher_decision",
  "active_queue",
]);
const DISPATCH_ACTIVE_STATUSES = new Set([
  "assigned",
  "driver_en_route",
  "ride_ongoing",
]);
const DISPATCH_POLL_INTERVAL_MS = 20000;
const DRIVERS_POLL_INTERVAL_MS = 20000;

function dashboardToDayRoutes(dash: DashboardDistributionResponse): DailyRoutesResponse {
  return {
    date: dash.date,
    algorithm: "dispatcher_v1",
    config: {},
    total_orders: dash.summary.total,
    unassigned_count: dash.summary.unassigned,
    already_assigned_count: dash.summary.assigned,
    distributed_count: dash.summary.assigned,
    failed_count: dash.failed_count ?? dash.summary.unassigned,
    drivers_count: dash.summary.drivers_total,
    routes: dash.routes ?? [],
    assignments: [],
    unassigned_orders: dash.unassigned_orders ?? [],
    auto_assigned: false,
    statistics: dash.statistics,
  };
}

export function Dispatch({ initialTab }: { initialTab?: "queue" | "day" }) {
  const [queueOrdersData, setQueueOrdersData] = useState<Order[]>([]);
  const [activeOrdersData, setActiveOrdersData] = useState<Order[]>([]);
  const [allDrivers, setAllDrivers] = useState<Driver[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignModal, setAssignModal] = useState<string | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  const [orderDetailsModal, setOrderDetailsModal] = useState<string | null>(null);
  const [orderDetails, setOrderDetails] = useState<Order | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [wsStatus, setWsStatus] = useState<'connected' | 'connecting' | 'disconnected' | 'error'>('disconnected');
  const [wsReconnectAttempts, setWsReconnectAttempts] = useState(0);
  const [rejectModalOrderId, setRejectModalOrderId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [queueDecisionLoadingId, setQueueDecisionLoadingId] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState(() => getTomorrowDateInAtyrau());
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;
  const [dayRoutesData, setDayRoutesData] = useState<DailyRoutesResponse | null>(null);
  const [dayRoutesLoading, setDayRoutesLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeProgress, setOptimizeProgress] = useState<DispatchJobProgress | null>(null);
  const [activeJobLabel, setActiveJobLabel] = useState<string | null>(null);
  const [resetAssignmentsOpen, setResetAssignmentsOpen] = useState(false);
  const [resetAssignmentsLoading, setResetAssignmentsLoading] = useState(false);
  const [importingPlan, setImportingPlan] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const rejectModalOrder = useMemo(
    () => (rejectModalOrderId ? queueOrdersData.find((o) => o.id === rejectModalOrderId) ?? null : null),
    [rejectModalOrderId, queueOrdersData],
  );

  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null);

  const handleDriverSelect = useCallback((driverId: number) => {
    setSelectedDriverId(driverId);
  }, []);

  const selectedDriverRoute = useMemo(
    () => dayRoutesData?.routes.find((r) => r.driver.id === selectedDriverId) ?? null,
    [dayRoutesData, selectedDriverId],
  );

  useEffect(() => {
    setSelectedDriverId(null);
  }, [selectedDate]);

  const dayRoutesDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const dayRoutesRequestIdRef = useRef(0);
  const heavyJobRunningRef = useRef(false);
  const previewPollGenerationRef = useRef(0);
  const dispatchJobWatchRef = useRef(0);
  const loadOrdersRef = useRef<(planDate?: string) => Promise<void>>(async () => {});
  const loadDaySummaryRef = useRef<(planDate?: string) => Promise<void>>(async () => {});
  const lastProgressSlotsDoneRef = useRef(0);
  const lastProgressOrdersAssignedRef = useRef(0);
  const lastProgressMinivanAssignedRef = useRef(0);
  const lastProgressRefreshAtRef = useRef(0);

  const jobLabelText = (label: string | null | undefined): string => {
    if (!label) return "Распределение";
    if (label.startsWith("optimize_day")) return "Оптимизация дня";
    if (label.startsWith("daily_routes_apply")) return "Применение маршрутов";
    if (label.startsWith("daily_routes_preview")) return "Построение маршрутов";
    if (label.startsWith("distribute_slot_first")) return "Распределение первого слота";
    if (label.startsWith("distribute_slot_next")) return "Распределение следующего слота";
    if (label.startsWith("distribute_slot_specific")) return "Распределение слота";
    return "Распределение";
  };

  const runDispatchJobWatch = useCallback(
    async (jobId: string, planDate: string, options?: { optimize?: boolean; slot?: boolean; toastMessage?: string }) => {
      const watchId = ++dispatchJobWatchRef.current;
      dayRoutesRequestIdRef.current += 1;
      bumpHeavyJobPollGeneration();
      previewPollGenerationRef.current = bumpHeavyJobPollGeneration();
      heavyJobRunningRef.current = true;
      setOptimizing(true);
      setOptimizeProgress(null);
      lastProgressSlotsDoneRef.current = 0;
      lastProgressOrdersAssignedRef.current = 0;
      lastProgressMinivanAssignedRef.current = 0;
      lastProgressRefreshAtRef.current = 0;
      saveDispatchJobId(planDate, jobId);

      const toastId = options?.toastMessage
        ? toast.loading(options.toastMessage)
        : undefined;
      try {
        const result = await followDispatchJob(jobId, {
          optimize: options?.optimize,
          slot: options?.slot,
          onProgress: (progress) => {
            if (watchId !== dispatchJobWatchRef.current) return;
            setOptimizeProgress(progress);
            const done = progress.slots_done ?? 0;
            const assigned = progress.orders_assigned ?? 0;
            const minivanAssigned = progress.minivan_group_orders_assigned ?? 0;
            const hasProgressIncrease =
              done > lastProgressSlotsDoneRef.current
              || assigned > lastProgressOrdersAssignedRef.current
              || minivanAssigned > lastProgressMinivanAssignedRef.current;
            lastProgressSlotsDoneRef.current = Math.max(lastProgressSlotsDoneRef.current, done);
            lastProgressOrdersAssignedRef.current = Math.max(
              lastProgressOrdersAssignedRef.current,
              assigned,
            );
            lastProgressMinivanAssignedRef.current = Math.max(
              lastProgressMinivanAssignedRef.current,
              minivanAssigned,
            );
            if (hasProgressIncrease) {
              const now = Date.now();
              if (now - lastProgressRefreshAtRef.current >= 1000) {
                lastProgressRefreshAtRef.current = now;
                void loadOrdersRef.current(planDate);
                void loadDaySummaryRef.current(planDate);
              }
            }
          },
        });
        if (watchId !== dispatchJobWatchRef.current) return;
        setDayRoutesData(result);
        clearDispatchJobId(planDate);
        if (result.status === "complete") {
          if (toastId != null) {
            toast.success(result.message ?? "Все слоты обработаны", { id: toastId });
          }
          await loadOrdersRef.current();
          return;
        }
        if (toastId != null) {
          if (result.slot_start && result.slot_end) {
            const assigned = result.assigned_orders ?? result.distributed_count ?? 0;
            const total = result.total_orders ?? 0;
            const manual = result.manual_required_orders ?? 0;
            toast.success(
              `Слот ${result.slot_start}–${result.slot_end}: ${assigned}/${total} распределено${manual > 0 ? `, ${manual} вручную` : ""}`,
              { id: toastId },
            );
          } else {
            toast.success(
              `Готово: назначено ${result.distributed_count}, не распределено ${result.failed_count}`,
              { id: toastId },
            );
          }
        }
        await loadOrdersRef.current();
      } catch (err: any) {
        if (watchId !== dispatchJobWatchRef.current) return;
        clearDispatchJobId(planDate);
        if (toastId != null) {
          toast.error(err.response?.data?.error || err.message || "Ошибка распределения", { id: toastId });
        }
      } finally {
        if (watchId === dispatchJobWatchRef.current) {
          heavyJobRunningRef.current = false;
          setOptimizing(false);
          setOptimizeProgress(null);
          setActiveJobLabel(null);
        }
      }
    },
    [],
  );

  const loadDaySummary = useCallback(async (date?: string) => {
    const target = date ?? selectedDate;
    const requestId = ++dayRoutesRequestIdRef.current;
    setDayRoutesLoading(true);
    try {
      const dash = await dispatchApi.getDashboardDistribution(target);
      if (requestId !== dayRoutesRequestIdRef.current) return;
      setDayRoutesData(dashboardToDayRoutes(dash));
    } catch (err: any) {
      if (requestId !== dayRoutesRequestIdRef.current) return;
      console.error("Ошибка загрузки сводки дня:", err);
    } finally {
      if (requestId === dayRoutesRequestIdRef.current) {
        setDayRoutesLoading(false);
      }
    }
  }, [selectedDate]);

  /** Сводка из БД (мгновенно) + preview маршрутов (~30 сек). */
  const loadDayPlan = useCallback(async (date?: string) => {
    if (heavyJobRunningRef.current) return;
    const target = date ?? selectedDate;
    const requestId = ++dayRoutesRequestIdRef.current;
    setDayRoutesLoading(true);
    try {
      const dash = await dispatchApi.getDashboardDistribution(target);
      if (requestId !== dayRoutesRequestIdRef.current) return;
      setDayRoutesData(dashboardToDayRoutes(dash));

      // Если назначения уже в БД (после optimize-day) — не затираем preview'ем
      // встроенного алгоритма (там нет обедов/минивэн-рейсов из роутера).
      if ((dash.summary?.assigned ?? 0) > 0 && (dash.routes?.length ?? 0) > 0) {
        return;
      }

      if (heavyJobRunningRef.current) return;
      const pollGen = previewPollGenerationRef.current;
      const result = await dispatchApi.getDailyRoutes(target, { pollGeneration: pollGen });
      if (requestId !== dayRoutesRequestIdRef.current) return;
      setDayRoutesData(result);
    } catch (err: any) {
      if (requestId !== dayRoutesRequestIdRef.current) return;
      if (err?.message?.includes('Отменено:')) return;
      console.error("Ошибка загрузки плана дня:", err);
      toast.error(err.message || "Ошибка загрузки плана на день");
    } finally {
      if (requestId === dayRoutesRequestIdRef.current) {
        setDayRoutesLoading(false);
      }
    }
  }, [selectedDate]);

  const scheduleDayRoutesRefresh = useCallback(() => {
    const targetDate = selectedDateRef.current;
    const debounceMs = heavyJobRunningRef.current || optimizing ? 900 : 1500;
    if (dayRoutesDebounceRef.current) return;
    dayRoutesDebounceRef.current = setTimeout(() => {
      dayRoutesDebounceRef.current = null;
      void loadDaySummary(targetDate);
    }, debounceMs);
  }, [loadDaySummary, optimizing]);

  useEffect(() => {
    if (dayRoutesDebounceRef.current) clearTimeout(dayRoutesDebounceRef.current);
    dayRoutesDebounceRef.current = setTimeout(() => {
      dayRoutesDebounceRef.current = null;
      void loadDaySummary(selectedDate);
    }, 600);
    return () => {
      if (dayRoutesDebounceRef.current) clearTimeout(dayRoutesDebounceRef.current);
      dayRoutesRequestIdRef.current += 1;
    };
  }, [selectedDate, loadDaySummary]);

  useEffect(() => {
    const onOrdersGenerated = (event: Event) => {
      const detail = (event as CustomEvent<{ date?: string }>).detail;
      if (detail?.date && detail.date === selectedDate) {
        void loadDaySummary(selectedDate);
      }
    };
    window.addEventListener("invotaxi:orders-generated", onOrdersGenerated);
    return () => window.removeEventListener("invotaxi:orders-generated", onOrdersGenerated);
  }, [selectedDate, loadDaySummary]);

  /** Восстановить poll, если распределение уже идёт на сервере (ушли со страницы и вернулись). */
  useEffect(() => {
    let cancelled = false;
    const planDate = selectedDate;

    try {
      if (sessionStorage.getItem(dispatchJobStorageKey(planDate))) {
        heavyJobRunningRef.current = true;
        setOptimizing(true);
      }
    } catch {
      /* ignore */
    }

    void (async () => {
      try {
        const active = await dispatchApi.getActiveDispatchJob(planDate);
        if (cancelled) return;

        if (active?.status === "running" && active.job_id) {
          setActiveJobLabel(active.label ?? null);
          await runDispatchJobWatch(active.job_id, planDate, {
            optimize: (active.label ?? "").startsWith("optimize_day"),
            slot: (active.label ?? "").startsWith("distribute_slot"),
          });
          return;
        }

        clearDispatchJobId(planDate);
        heavyJobRunningRef.current = false;
        setOptimizing(false);
        setActiveJobLabel(null);
      } catch (err) {
        console.error("Не удалось восстановить задачу распределения:", err);
        if (!cancelled) {
          heavyJobRunningRef.current = false;
          setOptimizing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      dispatchJobWatchRef.current += 1;
    };
  }, [selectedDate, runDispatchJobWatch]);

  const handleResetAssignments = async () => {
    setResetAssignmentsLoading(true);
    try {
      const result = await dispatchApi.resetDriverAssignments(selectedDate);
      setResetAssignmentsOpen(false);
      toast.success(result.message || `Снято назначений: ${result.reset_count}`);
      previewPollGenerationRef.current = bumpHeavyJobPollGeneration();
      await Promise.all([
        loadOrders(),
        loadDaySummary(selectedDate),
      ]);
      setSelectedDriverId(null);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || "Не удалось сбросить назначения");
    } finally {
      setResetAssignmentsLoading(false);
    }
  };

  const handleOptimize = async () => {
    dayRoutesRequestIdRef.current += 1;
    setDayRoutesLoading(false);
    setActiveJobLabel(`optimize_day:${selectedDate}`);
    try {
      const jobId = await dispatchApi.startOptimizeDay(selectedDate);
      await runDispatchJobWatch(jobId, selectedDate, {
        optimize: true,
        toastMessage: `Оптимизация на ${selectedDate}… (до 30 мин для большого дня)`,
      });
    } catch (err: any) {
      clearDispatchJobId(selectedDate);
      toast.error(err.response?.data?.error || err.message || "Ошибка оптимизации");
    }
  };

  const handleImportPlanFile = async (file: File) => {
    setImportingPlan(true);
    const toastId = toast.loading(`Импорт плана «${file.name}»…`);
    try {
      const result = await dispatchApi.importDispatchPlan(file, { date: selectedDate });
      const parts = [
        `назначено ${result.assigned}`,
        `создано водителей ${result.drivers_created}`,
      ];
      if (result.not_found) parts.push(`не найдено ${result.not_found}`);
      if (result.errors) parts.push(`ошибок ${result.errors}`);
      toast.success(`План на ${result.plan_date}: ${parts.join(", ")}`, { id: toastId });
      previewPollGenerationRef.current = bumpHeavyJobPollGeneration();
      await Promise.all([loadOrders(selectedDate), loadDaySummary(selectedDate)]);
    } catch (err: any) {
      toast.error(
        err.response?.data?.error || err.message || "Не удалось импортировать план",
        { id: toastId },
      );
    } finally {
      setImportingPlan(false);
      if (importFileInputRef.current) importFileInputRef.current.value = "";
    }
  };

  // Ref для polling и отмены запросов
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const ordersAbortRef = useRef<AbortController | null>(null);
  const isModalOpenRef = useRef(false);
  const wsRef = useRef<ReturnType<typeof getDispatchMapWebSocket> | null>(null);
  
  // Дебаунсинг для обновлений локаций
  const locationUpdateTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const pendingLocationUpdatesRef = useRef<Map<string, any>>(new Map());

  // Функция загрузки заказов
  const loadOrders = useCallback(async (planDate?: string) => {
    ordersAbortRef.current?.abort();
    const controller = new AbortController();
    ordersAbortRef.current = controller;
    const date = planDate ?? selectedDate;
    try {
      setError(null);

      const { orders: allOrders, count: total } = await dispatchApi.getDayOrders(date);

      if (controller.signal.aborted) return;

      const queueData = allOrders.filter((o) => DISPATCH_QUEUE_STATUSES.has(o.status));
      const activeData = allOrders.filter((o) => DISPATCH_ACTIVE_STATUSES.has(o.status));

      setQueueOrdersData(queueData);
      setActiveOrdersData(activeData);
      setLastUpdate(new Date());

      if (total > allOrders.length) {
        console.warn(
          `Загружено ${allOrders.length} из ${total} заказов за ${date}.`,
        );
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || err?.code === "ERR_CANCELED") return;
      const errorMessage = err?.response?.data?.detail || err?.message || "Ошибка загрузки заказов";
      setError(errorMessage);
      console.error("Ошибка загрузки заказов:", err);
      setQueueOrdersData([]);
      setActiveOrdersData([]);
    }
  }, [selectedDate]);

  loadOrdersRef.current = loadOrders;
  loadDaySummaryRef.current = loadDaySummary;

  const refreshDrivers = useCallback(async () => {
    try {
      const list = await driversApi.getDrivers();
      setAllDrivers(Array.isArray(list) ? list : []);
      setLastUpdate(new Date());
    } catch (err) {
      console.error("Ошибка обновления водителей:", err);
    }
  }, []);

  // Загрузка водителей, регионов и городов
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        await Promise.all([
          loadOrders(),
          driversApi.getDrivers().then((list) => setAllDrivers(Array.isArray(list) ? list : [])),
          regionsApi.getRegions().then(setRegions),
          regionsApi.getCities().then(setCities),
        ]);
      } catch (err: any) {
        setError(err.message || "Ошибка загрузки данных");
        console.error("Ошибка загрузки данных:", err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [loadOrders]);

  // Периодически подтягиваем координаты водителей с API (мобильное приложение шлёт PATCH location;
  // без опроса карта не обновляется, если WebSocket недоступен или события не дошли).
  useEffect(() => {
    const id = setInterval(() => {
      void refreshDrivers();
    }, DRIVERS_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshDrivers]);

  // WebSocket для обновления данных в реальном времени
  useEffect(() => {
    const ws = getDispatchMapWebSocket();
    wsRef.current = ws;

    // Обработчик обновления заказа
    ws.on("order_update", (data: any) => {
      const planDate = selectedDateRef.current;
      if (data.desired_pickup_time && !orderMatchesPlanDate(data, planDate)) {
        setQueueOrdersData((prev) => prev.filter((o) => o.id !== data.id));
        setActiveOrdersData((prev) => prev.filter((o) => o.id !== data.id));
        return;
      }

      const queueStatuses = ["submitted", "awaiting_dispatcher_decision", "active_queue"];
      
      // Обновляем заказы в очереди
      setQueueOrdersData((prev) => {
        const index = prev.findIndex((o) => o.id === data.id);
        if (index !== -1) {
          const updated = [...prev];
          updated[index] = { ...updated[index], ...data };
          // Если статус изменился и заказ больше не в очереди, удаляем его
          if (!queueStatuses.includes(data.status)) {
            return prev.filter((o) => o.id !== data.id);
          }
          return updated;
        }
        // Если заказ в статусе очереди, добавляем его
        if (queueStatuses.includes(data.status)) {
          return [...prev, data as Order];
        }
        return prev;
      });

      // Обновляем активные заказы
      setActiveOrdersData((prev) => {
        const activeStatuses = ["assigned", "driver_en_route", "ride_ongoing"];
        const index = prev.findIndex((o) => o.id === data.id);
        
        if (index !== -1) {
          // Если статус изменился и заказ больше не активный, удаляем его
          if (!activeStatuses.includes(data.status)) {
            return prev.filter((o) => o.id !== data.id);
          }
          // Обновляем существующий заказ
          const updated = [...prev];
          updated[index] = { ...updated[index], ...data };
          return updated;
        }
        // Если заказ стал активным, добавляем его
        if (activeStatuses.includes(data.status)) {
          return [...prev, data as Order];
        }
        return prev;
      });
      
      setLastUpdate(new Date());
      scheduleDayRoutesRefresh();
    });

    // Обработчик создания нового заказа
    ws.on("order_created", (data: any) => {
      const planDate = selectedDateRef.current;
      if (data.desired_pickup_time && !orderMatchesPlanDate(data, planDate)) {
        return;
      }
      const queueStatuses = ["submitted", "awaiting_dispatcher_decision", "active_queue"];
      if (queueStatuses.includes(data.status)) {
        setQueueOrdersData((prev) => [...prev, data as Order]);
        setLastUpdate(new Date());
        scheduleDayRoutesRefresh();
      }
    });

    // Обработчик обновления локации водителя с дебаунсингом
    ws.on("driver_location_update", (data: any) => {
      const driverId = String(data.driver_id);
      
      // Сохраняем последнее обновление
      pendingLocationUpdatesRef.current.set(driverId, data);
      
      // Очищаем предыдущий таймаут для этого водителя
      const existingTimeout = locationUpdateTimeoutRef.current.get(driverId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }
      
      // Устанавливаем новый таймаут (дебаунсинг 500ms)
      const timeout = setTimeout(() => {
        const updateData = pendingLocationUpdatesRef.current.get(driverId);
        if (!updateData) return;
        
        setAllDrivers((prev) => {
          const index = prev.findIndex((d) => String(d.id) === driverId);
          if (index !== -1) {
            // Обновляем существующего водителя
            const updated = [...prev];
            updated[index] = {
              ...updated[index],
              current_lat: updateData.lat,
              current_lon: updateData.lon,
              last_location_update: updateData.timestamp || new Date().toISOString(),
              eta: updateData.eta, // Добавляем ETA если есть
            };
            return updated;
          }
          // Если водителя нет в списке, добавляем его (если есть локация)
          if (updateData.lat && updateData.lon) {
            return [...prev, {
              id: parseInt(driverId),
              user: {
                id: 0,
                username: '',
                phone: '',
              },
              name: updateData.name || 'Неизвестный водитель',
              car_model: updateData.car_model || '',
              plate_number: '',
              capacity: 4,
              is_online: updateData.is_online ?? true,
              current_lat: updateData.lat,
              current_lon: updateData.lon,
              last_location_update: updateData.timestamp || new Date().toISOString(),
              eta: updateData.eta,
            } as Driver];
          }
          return prev;
        });
        setLastUpdate(new Date());
        
        // Очищаем обработанное обновление
        pendingLocationUpdatesRef.current.delete(driverId);
        locationUpdateTimeoutRef.current.delete(driverId);
      }, 500);
      
      locationUpdateTimeoutRef.current.set(driverId, timeout);
    });
    
    // Обработчик обновления ETA
    ws.on("driver_eta_update", (data: any) => {
      setAllDrivers((prev) => {
        const index = prev.findIndex((d) => String(d.id) === String(data.driver_id));
        if (index !== -1) {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            eta: data,
          };
          return updated;
        }
        return prev;
      });
    });

    // Обработчик обновления статуса водителя (онлайн/оффлайн)
    ws.on("driver_status_update", (data: any) => {
      setAllDrivers((prev) => {
        const index = prev.findIndex((d) => String(d.id) === String(data.driver_id));
        if (index !== -1) {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            is_online: data.is_online,
          };
          return updated;
        }
        return prev;
      });
      setLastUpdate(new Date());
    });

    // Обновляем статус подключения
    const updateStatus = () => {
      setWsStatus(ws.getConnectionStatus());
      setWsReconnectAttempts(ws.getReconnectAttempts());
    };
    
    // Обновляем статус при изменении
    const statusInterval = setInterval(updateStatus, 1000);
    updateStatus(); // Первоначальное обновление
    
    // Подключаемся к WebSocket
    ws.connect().catch((error) => {
      console.error("WebSocket connection error:", error);
      updateStatus();
    });

    // Отключаемся при размонтировании
    return () => {
      clearInterval(statusInterval);
      ws.disconnect();
      // Очищаем все таймауты дебаунсинга
      locationUpdateTimeoutRef.current.forEach(timeout => clearTimeout(timeout));
      locationUpdateTimeoutRef.current.clear();
      pendingLocationUpdatesRef.current.clear();
    };
  }, [loadOrders, refreshDrivers, scheduleDayRoutesRefresh]);

  // Периодическое обновление: без WS — заказы+водители; с WS — только координаты водителей
  useEffect(() => {
    if (isModalOpenRef.current) return;

    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    const tick = () => {
      if (wsStatus === "connected") {
        void refreshDrivers();
      } else {
        void loadOrders();
        void refreshDrivers();
      }
    };

    pollingIntervalRef.current = setInterval(tick, DISPATCH_POLL_INTERVAL_MS);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [loadOrders, refreshDrivers, wsStatus]);

  // Отслеживание открытия модальных окон
  useEffect(() => {
    isModalOpenRef.current = assignModal !== null || orderDetailsModal !== null || rejectModalOrderId !== null;
  }, [assignModal, orderDetailsModal, rejectModalOrderId]);

  // Загрузка кандидатов при открытии модального окна назначения
  useEffect(() => {
    const loadCandidates = async () => {
      if (assignModal) {
        try {
          const data = await dispatchApi.getCandidates(assignModal);
          setCandidates(data.candidates || []);
        } catch (err: any) {
          console.error("Ошибка загрузки кандидатов:", err);
          toast.error("Ошибка загрузки кандидатов");
        }
      }
    };
    loadCandidates();
  }, [assignModal]);

  // Загрузка детальной информации о заказе
  useEffect(() => {
    const loadOrderDetails = async () => {
      if (orderDetailsModal) {
        try {
          const order = await ordersApi.getOrder(orderDetailsModal);
          setOrderDetails(order);
        } catch (err: any) {
          console.error("Ошибка загрузки деталей заказа:", err);
          toast.error("Ошибка загрузки деталей заказа");
        }
      }
    };
    loadOrderDetails();
  }, [orderDetailsModal]);

  const handleAssignOrder = async (orderId: string, driverId?: string) => {
    try {
      const result = await dispatchApi.assignOrder(orderId, driverId);
      
      // Проверяем результат назначения
      if (result.success && result.driver_id) {
        toast.success("Водитель успешно назначен");
        await loadOrders();
        void loadDaySummary(selectedDate);
        setAssignModal(null);
        setSelectedDriver(null);
      } else {
        const errorMsg = result.rejection_reason || result.reason || "Не удалось назначить водителя";
        toast.error(errorMsg);
        setError(errorMsg);
      }
    } catch (err: any) {
      // Извлекаем детальное сообщение об ошибке
      const errorMessage = err.response?.data?.rejection_reason || 
                          err.response?.data?.reason ||
                          err.message || 
                          "Ошибка назначения заказа";
      toast.error(errorMessage);
      setError(errorMessage);
    }
  };

  const handleAcceptToQueue = async (order: Order) => {
    if (order.status !== "submitted" && order.status !== "awaiting_dispatcher_decision") return;
    setQueueDecisionLoadingId(order.id);
    try {
      if (order.status === "submitted") {
        await ordersApi.updateOrderStatus(order.id, {
          status: "awaiting_dispatcher_decision",
          reason: "Принят диспетчером",
        });
        await ordersApi.updateOrderStatus(order.id, {
          status: "active_queue",
          reason: "В очередь на назначение водителя",
        });
      } else if (order.status === "awaiting_dispatcher_decision") {
        await ordersApi.updateOrderStatus(order.id, {
          status: "active_queue",
          reason: "В очередь на назначение водителя",
        });
      }
      toast.success("Заказ в очереди на назначение");
      await loadOrders();
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.detail ||
        err?.message ||
        "Не удалось перевести заказ в очередь";
      toast.error(typeof msg === "string" ? msg : "Не удалось перевести заказ в очередь");
      console.error(err);
    } finally {
      setQueueDecisionLoadingId(null);
    }
  };

  const handleConfirmReject = async () => {
    const id = rejectModalOrderId;
    if (!id) return;
    setQueueDecisionLoadingId(id);
    try {
      const reason = rejectReason.trim() || "Отклонено диспетчером";
      await ordersApi.updateOrderStatus(id, { status: "rejected", reason });
      toast.success("Заказ отклонён");
      setRejectModalOrderId(null);
      setRejectReason("");
      await loadOrders();
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.detail ||
        err?.message ||
        "Не удалось отклонить заказ";
      toast.error(typeof msg === "string" ? msg : "Не удалось отклонить заказ");
      console.error(err);
    } finally {
      setQueueDecisionLoadingId(null);
    }
  };

  const selectedOrder = queueOrdersData.find((order) => order.id === assignModal);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl dark:text-white">Диспетчеризация</h1>
              <p className="text-gray-600 dark:text-gray-400">
                План и карта за {selectedDate}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {optimizing && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300 rounded-lg text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{jobLabelText(activeJobLabel)}…</span>
                </div>
              )}
              {wsStatus === 'connected' && !optimizing && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm">
                  <Wifi className="w-4 h-4" />
                  <span>Подключено</span>
                </div>
              )}
              {wsStatus === 'connecting' && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-lg text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Подключение...</span>
                </div>
              )}
              {wsStatus === 'disconnected' && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-400 rounded-lg text-sm">
                  <WifiOff className="w-4 h-4" />
                  <span>Отключено</span>
                </div>
              )}
              {wsStatus === 'error' && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm">
                  <AlertCircle className="w-4 h-4" />
                  <span>Ошибка подключения</span>
                  {wsReconnectAttempts > 0 && (
                    <span className="text-xs">({wsReconnectAttempts} попыток)</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white text-sm"
          />
          <button
            onClick={() => void handleOptimize()}
            disabled={optimizing}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-50 text-sm"
          >
            {optimizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Оптимизировать
          </button>
          <button
            type="button"
            onClick={() => setResetAssignmentsOpen(true)}
            disabled={optimizing || resetAssignmentsLoading}
            className="bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 flex items-center gap-2 disabled:opacity-50 text-sm"
            title="Снять назначения водителей за выбранный день"
          >
            {resetAssignmentsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
            Сбросить назначения
          </button>
          <input
            ref={importFileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportPlanFile(file);
            }}
          />
          <button
            type="button"
            onClick={() => importFileInputRef.current?.click()}
            disabled={importingPlan || optimizing}
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 flex items-center gap-2 disabled:opacity-50 text-sm"
            title={`Загрузить Excel-план маршрутизации и применить на ${selectedDate}`}
          >
            {importingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Импорт плана
          </button>
          <button
            onClick={() => {
              void loadOrders();
              previewPollGenerationRef.current = bumpHeavyJobPollGeneration();
              void loadDayPlan(selectedDate);
            }}
            className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 flex items-center gap-2 text-sm"
            title="Обновить данные"
          >
            <RefreshCw className="w-4 h-4" />
            Обновить
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Последнее обновление: {lastUpdate.toLocaleTimeString("ru-RU")}
        </div>
        {error && (
          <div className="text-sm text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-1 rounded">
            ⚠️ {error}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="space-y-6 min-w-0">
      {/* Карта путевого листа */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="text-xl dark:text-white">Путевой лист на карте</h2>
            {selectedDriverRoute ? (
              <p className="text-sm text-indigo-600 dark:text-indigo-400 mt-1">
                {selectedDriverRoute.driver.name} · {selectedDriverRoute.total_orders} заказов
              </p>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Выберите водителя в «План на день» справа
              </p>
            )}
          </div>
          {selectedDriverId != null && (
            <button
              type="button"
              onClick={() => setSelectedDriverId(null)}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm"
            >
              Сбросить
            </button>
          )}
        </div>

        <div className="w-full h-[700px] rounded-lg overflow-hidden">
          <DispatchMap
            drivers={allDrivers}
            onDriverSelect={handleDriverSelect}
            onOrderClick={(orderId) => setOrderDetailsModal(orderId)}
            driverDayRoutes={dayRoutesData?.routes ?? []}
            selectedDriverId={selectedDriverId}
            waybillOnly
          />
        </div>
      </div>
        </div>

        <div className="min-w-0">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700 xl:sticky xl:top-4">
            <h2 className="text-lg font-semibold dark:text-white mb-4 flex items-center gap-2">
              <Route className="w-5 h-5" />
              План на {selectedDate}
            </h2>
            {optimizing && (
              <div className="mb-4">
                {optimizeProgress ? (
                  <DistributionProgressPanel
                    progress={optimizeProgress}
                    title={jobLabelText(activeJobLabel)}
                  />
                ) : (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50/80 p-4 text-sm text-indigo-900 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>{jobLabelText(activeJobLabel)}… подключение к задаче</span>
                  </div>
                )}
              </div>
            )}
            <DayRoutesPanel
              data={dayRoutesData}
              loading={dayRoutesLoading}
              compact
              selectedDriverId={selectedDriverId}
              onDriverSelect={handleDriverSelect}
              planDate={selectedDate}
              showExport
              onPlanChanged={() => {
                void loadOrders();
                void loadDaySummary(selectedDate);
              }}
            />
            <PickupTimeAdjustmentsPanel
              planDate={selectedDate}
              refreshKey={
                (dayRoutesData?.pickup_time_adjustments_count ?? 0) +
                (dayRoutesData?.distributed_count ?? 0)
              }
            />
          </div>
        </div>
      </div>

      <Modal
        isOpen={resetAssignmentsOpen}
        onClose={() => {
          if (!resetAssignmentsLoading) setResetAssignmentsOpen(false);
        }}
        title="Сбросить назначения водителей?"
        size="md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setResetAssignmentsOpen(false)}
              disabled={resetAssignmentsLoading}
              className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void handleResetAssignments()}
              disabled={resetAssignmentsLoading}
              className="px-6 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {resetAssignmentsLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Undo2 className="w-5 h-5" />
              )}
              Сбросить
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
          <p>
            Дата: <span className="font-medium text-gray-900 dark:text-white">{selectedDate}</span>
          </p>
          <p>
            Все заказы со статусом <strong>«Назначено»</strong> вернутся в очередь без водителя.
            Плановые маршруты и сдвиги времени подачи для них будут удалены.
          </p>
          <p className="text-amber-700 dark:text-amber-400">
            Заказы в пути и на поездке не затрагиваются.
          </p>
        </div>
      </Modal>

      {/* Отклонение заказа диспетчером */}
      <Modal
        isOpen={rejectModalOrderId !== null}
        onClose={() => {
          setRejectModalOrderId(null);
          setRejectReason("");
        }}
        title="Отклонить заказ?"
        size="md"
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setRejectModalOrderId(null);
                setRejectReason("");
              }}
              className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmReject()}
              disabled={queueDecisionLoadingId !== null && queueDecisionLoadingId === rejectModalOrderId}
              className="px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {queueDecisionLoadingId === rejectModalOrderId ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <X className="w-5 h-5" />
              )}
              Отклонить заказ
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {rejectModalOrder && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Заказ{" "}
              <span className="font-mono font-medium dark:text-gray-300">
                #{rejectModalOrder.id.split("_")[1] || rejectModalOrder.id}
              </span>
              {" — "}
              {rejectModalOrder.passenger.full_name}
            </p>
          )}
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Причина (видна в приложении пассажира)
          </label>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
            placeholder="Например: недоступен транспорт в регионе…"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-red-500/30 focus:border-red-500"
          />
        </div>
      </Modal>

      {/* Assign Driver Modal */}
      <Modal
        isOpen={assignModal !== null}
        onClose={() => {
          setAssignModal(null);
          setSelectedDriver(null);
        }}
        title="Назначить водителя на заказ"
        size="lg"
        footer={
          <>
            <button
              onClick={() => {
                setAssignModal(null);
                setSelectedDriver(null);
              }}
              className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={() => selectedDriver && assignModal && handleAssignOrder(assignModal, selectedDriver)}
              disabled={!selectedDriver}
              className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-5 h-5" />
              Назначить
            </button>
          </>
        }
      >
        {selectedOrder && (
          <div className="space-y-4">
            {/* Информация о заказе */}
            <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Заказ #{selectedOrder.id.split('_')[1] || selectedOrder.id}</p>
                  <p className="dark:text-white font-medium text-lg">{selectedOrder.passenger.full_name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-1">
                    <Phone className="w-3 h-3" />
                    {selectedOrder.passenger.user.phone}
                  </p>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <Clock className="w-4 h-4" />
                    {new Date(selectedOrder.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  {(() => {
                    const waitTime = Math.round((Date.now() - new Date(selectedOrder.created_at).getTime()) / 1000 / 60);
                    const waitTimeHours = Math.floor(waitTime / 60);
                    const waitTimeMinutes = waitTime % 60;
                    const waitTimeText = waitTimeHours > 0 
                      ? `${waitTimeHours} ч ${waitTimeMinutes} мин`
                      : `${waitTimeMinutes} мин`;
                    return (
                      <span className={`text-xs px-2 py-1 rounded mt-1 inline-block ${
                        waitTime > 30 
                          ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                          : waitTime > 15
                          ? "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
                          : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                      }`}>
                        Ожидание: {waitTimeText}
                      </span>
                    );
                  })()}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Откуда</p>
                  <p className="text-sm dark:text-gray-300 flex items-start gap-1">
                    <MapPin className="w-3 h-3 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                    {selectedOrder.pickup_title}
                  </p>
                </div>
                <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Куда</p>
                  <p className="text-sm dark:text-gray-300 flex items-start gap-1">
                    <MapPin className="w-3 h-3 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                    {selectedOrder.dropoff_title}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {selectedOrder.has_companion && (
                  <span className="text-xs px-2 py-1 bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 rounded flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    С сопровождением
                  </span>
                )}
                {selectedOrder.seats_needed > 1 && (
                  <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded">
                    Мест: {selectedOrder.seats_needed}
                  </span>
                )}
                {selectedOrder.distance_km && (
                  <span className="text-xs px-2 py-1 bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200 rounded flex items-center gap-1">
                    <Navigation className="w-3 h-3" />
                    {selectedOrder.distance_km.toFixed(1)} км
                  </span>
                )}
                {selectedOrder.note && (
                  <span className="text-xs px-2 py-1 bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200 rounded">
                    {selectedOrder.note}
                  </span>
                )}
              </div>
            </div>

            {/* Карта с маршрутом */}
            {selectedOrder.pickup_lat && selectedOrder.pickup_lon && selectedOrder.dropoff_lat && selectedOrder.dropoff_lon && (
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-sm font-medium dark:text-white">Маршрут заказа</p>
                </div>
                <div className="h-64">
                  <RouteMapView
                    pickupLat={selectedOrder.pickup_lat}
                    pickupLon={selectedOrder.pickup_lon}
                    dropoffLat={selectedOrder.dropoff_lat}
                    dropoffLon={selectedOrder.dropoff_lon}
                    distanceKm={selectedOrder.distance_km}
                    orderId={selectedOrder.id}
                  />
                </div>
              </div>
            )}

            {/* Список кандидатов */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Доступные водители ({candidates.length})</p>
                {candidates.length > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Сортировка: по приоритету
                  </p>
                )}
              </div>
              {candidates.length === 0 ? (
                <div className="text-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto mb-2" />
                  <p className="text-gray-500 dark:text-gray-400">Загрузка кандидатов...</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {candidates.map((driver, index) => {
                    const isSelected = selectedDriver === String(driver.driver_id);
                    const priorityScore = driver.priority?.region_match ? 3 : 0;
                    const priorityScoreText = index === 0 ? "Лучший вариант" : index < 3 ? "Хороший вариант" : "Доступен";
                    
                    return (
                      <button
                        key={driver.driver_id}
                        onClick={() => setSelectedDriver(String(driver.driver_id))}
                        disabled={!driver.is_online}
                        className={`w-full flex items-start gap-3 p-4 border-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed ${
                          isSelected
                            ? "border-green-500 dark:border-green-400 bg-green-50 dark:bg-green-900/20 shadow-md"
                            : "border-gray-200 dark:border-gray-600"
                        } ${index === 0 ? "ring-2 ring-indigo-200 dark:ring-indigo-800" : ""}`}
                      >
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold flex-shrink-0 ${
                          isSelected
                            ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300"
                            : "bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400"
                        }`}>
                          {driver.name[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <p className="dark:text-white font-medium">{driver.name}</p>
                            {index === 0 && (
                              <span className="text-xs px-2 py-1 bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200 rounded">
                                ⭐ {priorityScoreText}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mb-2">
                            <span className="flex items-center gap-1">
                              <Car className="w-3 h-3" />
                              {driver.car_model}
                            </span>
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              Вместимость: {driver.capacity}
                            </span>
                            <span className={`flex items-center gap-1 ${
                              driver.is_online
                                ? "text-green-600 dark:text-green-400"
                                : "text-gray-400"
                            }`}>
                              <span className={`w-2 h-2 rounded-full ${
                                driver.is_online
                                  ? "bg-green-600 dark:bg-green-400"
                                  : "bg-gray-400"
                              }`} />
                              {driver.is_online ? "Онлайн" : "Офлайн"}
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
                              <p className="text-gray-500 dark:text-gray-400 mb-0.5">Расстояние</p>
                              <p className="dark:text-white font-medium">
                                {driver.priority?.distance ? `${(driver.priority.distance / 1000).toFixed(1)} км` : "—"}
                              </p>
                            </div>
                            <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
                              <p className="text-gray-500 dark:text-gray-400 mb-0.5">Заказов сегодня</p>
                              <p className="dark:text-white font-medium">{driver.priority?.order_count || 0}</p>
                            </div>
                            <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
                              <p className="text-gray-500 dark:text-gray-400 mb-0.5">Регион</p>
                              <p className={`font-medium ${
                                driver.priority?.region_match
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-gray-500 dark:text-gray-400"
                              }`}>
                                {driver.priority?.region_match ? "✓ Совпадает" : "✗ Другой"}
                              </p>
                            </div>
                          </div>
                        </div>
                        {isSelected && (
                          <Check className="w-6 h-6 text-green-600 dark:text-green-400 flex-shrink-0 mt-1" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Order Details Modal */}
      <Modal
        isOpen={orderDetailsModal !== null}
        onClose={() => {
          setOrderDetailsModal(null);
          setOrderDetails(null);
        }}
        title="Детали заказа"
        size="lg"
        footer={
          <button
            onClick={() => {
              setOrderDetailsModal(null);
              setOrderDetails(null);
            }}
            className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            Закрыть
          </button>
        }
      >
        {orderDetails ? (
          <div className="space-y-6">
            {/* Пассажир */}
            <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
              <h3 className="font-semibold dark:text-white mb-3">Информация о пассажире</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Имя:</span>
                  <p className="dark:text-white font-medium">{orderDetails.passenger.full_name}</p>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Телефон:</span>
                  <p className="dark:text-white font-medium">{orderDetails.passenger.user.phone}</p>
                </div>
                {orderDetails.passenger.user.email && (
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Email:</span>
                    <p className="dark:text-white font-medium">{orderDetails.passenger.user.email}</p>
                  </div>
                )}
                {orderDetails.passenger.region && (
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Регион:</span>
                    <p className="dark:text-white font-medium">{orderDetails.passenger.region.title}</p>
                  </div>
                )}
                {orderDetails.passenger.disability_category && (
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Категория инвалидности:</span>
                    <p className="dark:text-white font-medium">{orderDetails.passenger.disability_category}</p>
                  </div>
                )}
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Сопровождение:</span>
                  <p className="dark:text-white font-medium">{orderDetails.has_companion ? "Требуется" : "Не требуется"}</p>
                </div>
              </div>
            </div>

            {/* Адреса */}
            <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <h3 className="font-semibold dark:text-white mb-3">Адреса</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Место забора:</p>
                  <p className="dark:text-white">{orderDetails.pickup_title}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Координаты: {orderDetails.pickup_lat.toFixed(6)}, {orderDetails.pickup_lon.toFixed(6)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Место доставки:</p>
                  <p className="dark:text-white">{orderDetails.dropoff_title}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Координаты: {orderDetails.dropoff_lat.toFixed(6)}, {orderDetails.dropoff_lon.toFixed(6)}
                  </p>
                </div>
                {orderDetails.distance_km && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Расстояние:</p>
                    <p className="dark:text-white font-medium">{orderDetails.distance_km.toFixed(2)} км</p>
                  </div>
                )}
              </div>
            </div>

            {/* Водитель */}
            {orderDetails.driver && (
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <h3 className="font-semibold dark:text-white mb-3">Назначенный водитель</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Имя:</span>
                    <p className="dark:text-white font-medium">{orderDetails.driver.name}</p>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Телефон:</span>
                    <p className="dark:text-white font-medium">{orderDetails.driver.user.phone}</p>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Машина:</span>
                    <p className="dark:text-white font-medium">{orderDetails.driver.car_model}</p>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Номер:</span>
                    <p className="dark:text-white font-medium">{orderDetails.driver.plate_number}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Цена */}
            {(orderDetails.estimated_price || orderDetails.final_price) && (
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                <h3 className="font-semibold dark:text-white mb-3">Информация о цене</h3>
                <div className="space-y-2 text-sm">
                  {orderDetails.final_price ? (
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">Финальная цена:</span>
                      <span className="dark:text-white font-bold text-lg">{orderDetails.final_price} тг</span>
                    </div>
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">Предварительная цена:</span>
                      <span className="dark:text-white font-bold">{orderDetails.estimated_price} тг</span>
                    </div>
                  )}
                  {orderDetails.price_breakdown && (
                    <div className="mt-3 pt-3 border-t border-yellow-200 dark:border-yellow-700">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Детализация:</p>
                      {Object.entries(orderDetails.price_breakdown).map(([key, value]) => (
                        <div key={key} className="flex justify-between text-xs">
                          <span className="text-gray-600 dark:text-gray-300">{key}:</span>
                          <span className="dark:text-white">{value} тг</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Статус и время */}
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <h3 className="font-semibold dark:text-white mb-3">Статус и время</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Статус:</span>
                  <p className="dark:text-white font-medium">{orderDetails.status}</p>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Создан:</span>
                  <p className="dark:text-white">{new Date(orderDetails.created_at).toLocaleString("ru-RU")}</p>
                </div>
                {orderDetails.assigned_at && (
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Назначен:</span>
                    <p className="dark:text-white">{new Date(orderDetails.assigned_at).toLocaleString("ru-RU")}</p>
                  </div>
                )}
                {orderDetails.completed_at && (
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Завершен:</span>
                    <p className="dark:text-white">{new Date(orderDetails.completed_at).toLocaleString("ru-RU")}</p>
                  </div>
                )}
                {orderDetails.assignment_reason && (
                  <div className="col-span-2">
                    <span className="text-gray-500 dark:text-gray-400">Причина назначения:</span>
                    <p className="dark:text-white">{orderDetails.assignment_reason}</p>
                  </div>
                )}
                {orderDetails.note && (
                  <div className="col-span-2">
                    <span className="text-gray-500 dark:text-gray-400">Примечание:</span>
                    <p className="dark:text-white">{orderDetails.note}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          </div>
        )}
      </Modal>
    </div>
  );
}

// Компонент карты для диспетчеризации
interface DispatchMapProps {
  orders?: Order[];
  activeOrders?: Order[];
  drivers: Driver[];
  onOrderClick?: (orderId: string) => void;
  onDriverSelect?: (driverId: number) => void;
  driverDayRoutes?: DailyRoute[];
  selectedDriverId?: number | null;
  waybillOnly?: boolean;
  showOrders?: boolean;
  showDrivers?: boolean;
  showRoutes?: boolean;
  cities?: City[];
  regions?: Region[];
  showCities?: boolean;
  showRegions?: boolean;
  showHeatmap?: boolean;
}

const WAYBILL_SKIP_STATUSES = new Set(["completed", "cancelled"]);

type WaybillLeg = {
  type: "deadhead" | "ride";
  from: [number, number];
  to: [number, number];
  orderIndex: number;
  order: DailyRouteOrder;
};

type WaybillStop = {
  type: "pickup" | "dropoff";
  pos: [number, number];
  index: number;
  total: number;
  order: DailyRouteOrder;
};

function buildWaybillPlan(
  driver: Driver,
  orders: DailyRouteOrder[],
): { legs: WaybillLeg[]; stops: WaybillStop[] } {
  const sorted = [...orders]
    .filter((o) => !WAYBILL_SKIP_STATUSES.has(o.status))
    .sort((a, b) => {
      const ta = a.desired_pickup_time ? new Date(a.desired_pickup_time).getTime() : 0;
      const tb = b.desired_pickup_time ? new Date(b.desired_pickup_time).getTime() : 0;
      return ta - tb;
    });

  if (sorted.length === 0) {
    return { legs: [], stops: [] };
  }

  const legs: WaybillLeg[] = [];
  const stops: WaybillStop[] = [];
  const total = sorted.length;

  let currentPos: [number, number] | null =
    driver.current_lat != null && driver.current_lon != null
      ? [driver.current_lat, driver.current_lon]
      : null;

  sorted.forEach((order, idx) => {
    const pickup: [number, number] = [order.pickup_lat, order.pickup_lon];
    const dropoff: [number, number] = [order.dropoff_lat, order.dropoff_lon];
    const orderIndex = idx + 1;

    if (order.status === "ride_ongoing" && currentPos) {
      legs.push({ type: "ride", from: currentPos, to: dropoff, orderIndex, order });
      stops.push({ type: "dropoff", pos: dropoff, index: orderIndex, total, order });
      currentPos = dropoff;
      return;
    }

    const start = currentPos ?? pickup;
    if (
      currentPos &&
      (Math.abs(start[0] - pickup[0]) > 1e-6 || Math.abs(start[1] - pickup[1]) > 1e-6)
    ) {
      legs.push({ type: "deadhead", from: start, to: pickup, orderIndex, order });
    }

    stops.push({ type: "pickup", pos: pickup, index: orderIndex, total, order });
    legs.push({ type: "ride", from: pickup, to: dropoff, orderIndex, order });
    stops.push({ type: "dropoff", pos: dropoff, index: orderIndex, total, order });
    currentPos = dropoff;
  });

  return { legs, stops };
}

function formatWaybillTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}


const WAYBILL_PALETTE = [
  "#2563eb",
  "#e11d48",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#c026d3",
  "#ca8a04",
  "#4f46e5",
  "#0d9488",
  "#be123c",
  "#7c3aed",
];

function getWaybillOrderColor(orderIndex: number): string {
  return WAYBILL_PALETTE[(orderIndex - 1) % WAYBILL_PALETTE.length];
}

function getOrderNumber(orderId: string): string {
  const match = orderId.match(/\d+/);
  if (match) {
    const num = match[0];
    return num.length > 4 ? num.slice(-4) : num;
  }
  return orderId.slice(-4).toUpperCase();
}

function DispatchMap({
  orders = [],
  activeOrders = [],
  drivers,
  onOrderClick = () => {},
  onDriverSelect,
  driverDayRoutes = [],
  selectedDriverId = null,
  waybillOnly = false,
  showOrders = true,
  showDrivers = true,
  showRoutes = true,
  cities = [],
  regions = [],
  showCities = true,
  showRegions = true,
  showHeatmap = false,
}: DispatchMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<ymaps.Map | null>(null);
  const orderMarkersRef = useRef<Map<string, ymaps.Placemark>>(new window.Map());
  const driverMarkersRef = useRef<Map<string, ymaps.Placemark>>(new window.Map());
  const driverRoutesRef = useRef<Map<string, ymaps.Polyline>>(new window.Map());
  const orderRoutesRef = useRef<Map<string, ymaps.Polyline>>(new window.Map());
  const waybillRoutesRef = useRef<Map<string, ymaps.GeoObject>>(new window.Map());
  const waybillMarkersRef = useRef<Map<string, ymaps.Placemark>>(new window.Map());
  const routeCacheRef = useRef<Map<string, any>>(new window.Map());
  const waybillRequestIdRef = useRef(0);
  const onDriverSelectRef = useRef(onDriverSelect);
  onDriverSelectRef.current = onDriverSelect;
  const onOrderClickRef = useRef(onOrderClick);
  onOrderClickRef.current = onOrderClick;
  const cityMarkersRef = useRef<Map<string, ymaps.Placemark>>(new window.Map());
  const regionLayersRef = useRef<Map<string, any>>(new window.Map());
  const heatmapLayersRef = useRef<any[]>([]);
  const [ymapsReady, setYmapsReady] = useState(false);
  const previousDataRef = useRef<{ orders: Set<string>, activeOrders: Set<string>, drivers: Set<string> }>({
    orders: new Set(),
    activeOrders: new Set(),
    drivers: new Set(),
  });

  // Инициализация Yandex Maps API
  useEffect(() => {
    loadYmaps().then(() => setYmapsReady(true)).catch(console.error);
  }, []);

  // Инициализация карты
  useEffect(() => {
    if (!ymapsReady || !mapRef.current || mapInstanceRef.current) return;

    const allOrders = [...orders, ...activeOrders];
    const centerLat = allOrders.length > 0
      ? allOrders.reduce((sum, o) => sum + o.pickup_lat, 0) / allOrders.length
      : ATYRAU_MAP_CENTER[0];
    const centerLon = allOrders.length > 0
      ? allOrders.reduce((sum, o) => sum + o.pickup_lon, 0) / allOrders.length
      : ATYRAU_MAP_CENTER[1];

    mapInstanceRef.current = new ymaps.Map(mapRef.current, {
      center: [centerLat, centerLon],
      zoom: 11,
      controls: ['zoomControl'],
      restrictMapArea: YANDEX_OBLAST_BOUNDS,
    });
  }, [ymapsReady]);

  // Сохраняем ссылку на карту в window для доступа извне
  useEffect(() => {
    if (mapInstanceRef.current) {
      (window as any).__mapInstance = mapInstanceRef.current;
    }
  }, [mapInstanceRef.current]);

  // Обработчик кастомного события orderClick из balloon content
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        onOrderClick(detail);
      }
    };
    window.addEventListener('orderClick', handler);
    return () => window.removeEventListener('orderClick', handler);
  }, [onOrderClick]);

  // Обновление маркеров заказов
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (waybillOnly || !showOrders) {
      orderMarkersRef.current.forEach(marker => {
        mapInstanceRef.current!.geoObjects.remove(marker);
      });
      orderMarkersRef.current.clear();
      return;
    }

    const currentOrderIds = new Set<string>();
    const allOrders = [...orders, ...activeOrders];

    allOrders.forEach(order => {
      const orderId = String(order.id);
      currentOrderIds.add(orderId);
      
      const existingMarker = orderMarkersRef.current.get(orderId);
      const isActiveOrder = activeOrders.some(o => String(o.id) === orderId);
      
      const isCompleted = ['assigned', 'driver_en_route', 'arrived_waiting', 'ride_ongoing'].includes(order.status);
      const preset = isCompleted ? 'islands#greenCircleDotIcon' : 'islands#orangeCircleDotIcon';

      const statusLabels: Record<string, string> = {
        'active_queue': 'В очереди',
        'submitted': 'Отправлен',
        'awaiting_dispatcher_decision': 'Ожидает решения',
        'assigned': 'Назначен',
        'driver_en_route': 'Водитель в пути',
        'arrived_waiting': 'Водитель прибыл',
        'ride_ongoing': 'Поездка началась',
      };
      const statusLabel = statusLabels[order.status] || order.status;
      
      const waitTime = order.created_at 
        ? Math.round((Date.now() - new Date(order.created_at).getTime()) / 1000 / 60)
        : 0;
      const waitTimeText = waitTime > 60 
        ? `${Math.floor(waitTime / 60)} ч ${waitTime % 60} мин`
        : `${waitTime} мин`;
      const waitTimeColor = waitTime > 30 ? '#ef4444' : waitTime > 15 ? '#f97316' : '#10b981';

      const balloonContent = isActiveOrder
        ? `
          <div style="min-width: 280px; font-family: system-ui, -apple-system, sans-serif;">
            <div style="margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb;">
              <h3 style="margin: 0 0 4px 0; font-weight: 600; font-size: 16px; color: #1f2937;">Заказ #${order.id.split('_')[1] || order.id}</h3>
              <span style="display: inline-block; padding: 4px 8px; background: #3b82f6; color: white; border-radius: 4px; font-size: 11px; font-weight: 500;">${statusLabel}</span>
            </div>
            <div style="margin-bottom: 8px; padding: 8px; background: #f3f4f6; border-radius: 6px;">
              <p style="margin: 4px 0; font-size: 13px;"><strong>👤 Пассажир:</strong> ${order.passenger?.full_name || 'Не указан'}</p>
              <p style="margin: 4px 0; font-size: 13px;"><strong>🚗 Водитель:</strong> ${order.driver?.name || 'Не назначен'}</p>
              ${order.driver?.car_model ? `<p style="margin: 4px 0; font-size: 12px; color: #6b7280;">Машина: ${order.driver.car_model}</p>` : ''}
            </div>
            ${order.pickup_title ? `<div style="margin: 6px 0; padding: 6px; background: #d1fae5; border-radius: 4px;"><p style="margin: 0; font-size: 12px;"><strong>📍 От:</strong> ${order.pickup_title}</p></div>` : ''}
            ${order.dropoff_title ? `<div style="margin: 6px 0; padding: 6px; background: #fee2e2; border-radius: 4px;"><p style="margin: 0; font-size: 12px;"><strong>🎯 До:</strong> ${order.dropoff_title}</p></div>` : ''}
            ${order.distance_km ? `<p style="margin: 6px 0; font-size: 12px; color: #6b7280;">📏 Расстояние: ${order.distance_km.toFixed(1)} км</p>` : ''}
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">
              <button onclick="window.dispatchEvent(new CustomEvent('orderClick', {detail: '${order.id}'}))" 
                      style="width: 100%; padding: 8px 12px; background: #4f46e5; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500;">
                📋 Просмотреть детали
              </button>
            </div>
          </div>
        `
        : `
          <div style="min-width: 280px; font-family: system-ui, -apple-system, sans-serif;">
            <div style="margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb;">
              <h3 style="margin: 0 0 4px 0; font-weight: 600; font-size: 16px; color: #1f2937;">Заказ #${order.id.split('_')[1] || order.id}</h3>
              <span style="display: inline-block; padding: 4px 8px; background: #f59e0b; color: white; border-radius: 4px; font-size: 11px; font-weight: 500;">${statusLabel}</span>
            </div>
            <div style="margin-bottom: 8px; padding: 8px; background: #fef3c7; border-radius: 6px;">
              <p style="margin: 4px 0; font-size: 13px;"><strong>👤 Пассажир:</strong> ${order.passenger?.full_name || 'Не указан'}</p>
              <p style="margin: 4px 0; font-size: 12px; color: ${waitTimeColor};"><strong>⏱️ Ожидание:</strong> ${waitTimeText}</p>
            </div>
            ${order.pickup_title ? `<div style="margin: 6px 0; padding: 6px; background: #d1fae5; border-radius: 4px;"><p style="margin: 0; font-size: 12px;"><strong>📍 От:</strong> ${order.pickup_title}</p></div>` : ''}
            ${order.dropoff_title ? `<div style="margin: 6px 0; padding: 6px; background: #fee2e2; border-radius: 4px;"><p style="margin: 0; font-size: 12px;"><strong>🎯 До:</strong> ${order.dropoff_title}</p></div>` : ''}
            ${order.distance_km ? `<p style="margin: 6px 0; font-size: 12px; color: #6b7280;">📏 Расстояние: ${order.distance_km.toFixed(1)} км</p>` : ''}
            ${order.seats_needed > 1 ? `<p style="margin: 6px 0; font-size: 12px; color: #6b7280;">💺 Мест: ${order.seats_needed}</p>` : ''}
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">
              <button onclick="window.dispatchEvent(new CustomEvent('orderClick', {detail: '${order.id}'}))" 
                      style="width: 100%; padding: 8px 12px; background: #4f46e5; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500;">
                📋 Просмотреть детали
              </button>
            </div>
          </div>
        `;

      if (existingMarker) {
        existingMarker.geometry.setCoordinates([order.pickup_lat, order.pickup_lon]);
        existingMarker.properties.set({ balloonContent });
        existingMarker.options.set('preset', preset);
      } else {
        const marker = new ymaps.Placemark(
          [order.pickup_lat, order.pickup_lon],
          { balloonContent, iconCaption: `#${getOrderNumber(orderId)}` },
          { preset }
        );
        marker.events.add('click', () => {
          onOrderClick(order.id);
        });
        orderMarkersRef.current.set(orderId, marker);
        mapInstanceRef.current!.geoObjects.add(marker);
      }
    });

    // Удаляем маркеры заказов, которых больше нет
    previousDataRef.current.orders.forEach(orderId => {
      if (!currentOrderIds.has(orderId)) {
        const marker = orderMarkersRef.current.get(orderId);
        if (marker && mapInstanceRef.current) {
          mapInstanceRef.current.geoObjects.remove(marker);
          orderMarkersRef.current.delete(orderId);
        }
      }
    });

    previousDataRef.current.orders = currentOrderIds;
  }, [orders, activeOrders, onOrderClick, showOrders, waybillOnly]);

  // Обновление маркеров водителей
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (waybillOnly || !showDrivers) {
      driverMarkersRef.current.forEach(marker => {
        mapInstanceRef.current!.geoObjects.remove(marker);
      });
      driverMarkersRef.current.clear();
      return;
    }

    const currentDriverIds = new Set<string>();
    // Родитель уже отфильтровал по онлайн/офлайн/региону; показываем всех переданных водителей с координатами
    const driversWithLocation = drivers.filter(
      (d) => d.current_lat != null && d.current_lon != null
    );

    driversWithLocation.forEach((driver) => {
      const driverId = String(driver.id);
      currentDriverIds.add(driverId);
      
      const existingMarker = driverMarkersRef.current.get(driverId);
      const newPos: [number, number] = [driver.current_lat!, driver.current_lon!];

      const hasActiveOrder = activeOrders.some(o => o.driver_id === driverId);
      const activeOrder = activeOrders.find(o => o.driver_id === driverId);

      let preset: string;
      if (!driver.is_online) {
        preset = 'islands#grayAutoIcon';
      } else if (hasActiveOrder) {
        preset = 'islands#redAutoIcon';
      } else {
        preset = 'islands#greenAutoIcon';
      }

      const lastUpdate = driver.last_location_update 
        ? new Date(driver.last_location_update).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        : 'Неизвестно';
      
      const etaInfo = (driver as any).eta;
      const etaText = etaInfo 
        ? `<div style="margin: 6px 0; padding: 6px; background: #dbeafe; border-radius: 4px;">
             <p style="margin: 2px 0; font-size: 12px;"><strong>⏱️ ETA:</strong> <span style="color: #3b82f6; font-weight: 600;">~${etaInfo.duration_minutes} мин</span></p>
             <p style="margin: 2px 0; font-size: 11px; color: #6b7280;">📏 Расстояние: ${etaInfo.distance_km?.toFixed(2) || '—'} км</p>
           </div>`
        : '';

      const balloonContent = `
        <div style="min-width: 260px; font-family: system-ui, -apple-system, sans-serif;">
          <div style="margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb;">
            <h3 style="margin: 0 0 4px 0; font-weight: 600; font-size: 16px; color: #1f2937;">${driver.name}</h3>
            <span style="display: inline-block; padding: 4px 8px; background: ${driver.is_online ? '#10b981' : '#6b7280'}; color: white; border-radius: 4px; font-size: 11px; font-weight: 500;">
              ${driver.is_online ? '🟢 Онлайн' : '⚫ Оффлайн'}
            </span>
            ${hasActiveOrder ? '<span style="display: inline-block; margin-left: 4px; padding: 4px 8px; background: #ef4444; color: white; border-radius: 4px; font-size: 11px; font-weight: 500;">🚕 На заказе</span>' : ''}
          </div>
          <div style="margin-bottom: 8px; padding: 8px; background: ${driver.is_online ? '#d1fae5' : '#f3f4f6'}; border-radius: 6px;">
            <p style="margin: 4px 0; font-size: 13px;"><strong>🚗 Машина:</strong> ${driver.car_model || 'Не указана'}</p>
            ${driver.plate_number ? `<p style="margin: 4px 0; font-size: 12px; color: #6b7280;">Номер: ${driver.plate_number}</p>` : ''}
            <p style="margin: 4px 0; font-size: 13px;"><strong>📍 Регион:</strong> ${driver.region?.title || 'Не указан'}</p>
            ${driver.capacity ? `<p style="margin: 4px 0; font-size: 12px; color: #6b7280;">💺 Вместимость: ${driver.capacity} мест</p>` : ''}
          </div>
          ${etaText}
          ${activeOrder ? `
            <div style="margin: 6px 0; padding: 6px; background: #fee2e2; border-radius: 4px;">
              <p style="margin: 2px 0; font-size: 12px;"><strong>📦 Активный заказ:</strong> #${activeOrder.id.split('_')[1] || activeOrder.id}</p>
              <p style="margin: 2px 0; font-size: 11px; color: #6b7280;">Пассажир: ${activeOrder.passenger?.full_name || 'Не указан'}</p>
            </div>
          ` : ''}
          <p style="margin: 6px 0; font-size: 11px; color: #6b7280;">🕐 Обновлено: ${lastUpdate}</p>
          ${driver.current_lat && driver.current_lon ? `<p style="margin: 4px 0; font-size: 10px; color: #9ca3af;">Координаты: ${driver.current_lat.toFixed(6)}, ${driver.current_lon.toFixed(6)}</p>` : ''}
        </div>
      `;

      if (existingMarker) {
        existingMarker.geometry.setCoordinates(newPos);
        existingMarker.properties.set({ balloonContent });
        existingMarker.options.set('preset', preset);
        if (!(existingMarker as any).__driverSelectBound) {
          existingMarker.events.add("click", () => {
            onDriverSelectRef.current?.(Number(driverId));
          });
          (existingMarker as any).__driverSelectBound = true;
        }
      } else {
        const marker = new ymaps.Placemark(
          newPos,
          { balloonContent, iconCaption: driver.name },
          { preset }
        );
        marker.events.add("click", () => {
          onDriverSelectRef.current?.(Number(driverId));
        });
        (marker as any).__driverSelectBound = true;
        driverMarkersRef.current.set(driverId, marker);
        mapInstanceRef.current!.geoObjects.add(marker);
      }
    });

    // Удаляем маркеры водителей, которых больше нет в списке или у них пропали координаты
    previousDataRef.current.drivers.forEach(driverId => {
      if (!currentDriverIds.has(driverId)) {
        const marker = driverMarkersRef.current.get(driverId);
        if (marker && mapInstanceRef.current) {
          mapInstanceRef.current.geoObjects.remove(marker);
          driverMarkersRef.current.delete(driverId);
        }
      }
    });

    previousDataRef.current.drivers = currentDriverIds;
  }, [drivers, activeOrders, showDrivers, selectedDriverId, waybillOnly]);

  const clearWaybillLayers = useCallback(() => {
    if (!mapInstanceRef.current) return;
    waybillRoutesRef.current.forEach((route) => {
      mapInstanceRef.current!.geoObjects.remove(route);
    });
    waybillRoutesRef.current.clear();
    waybillMarkersRef.current.forEach((marker) => {
      mapInstanceRef.current!.geoObjects.remove(marker);
    });
    waybillMarkersRef.current.clear();
  }, []);

  // Путевой лист выбранного водителя
  useEffect(() => {
    const showWaybill = waybillOnly || showRoutes;
    if (!mapInstanceRef.current || !showWaybill || selectedDriverId == null) {
      clearWaybillLayers();
      return;
    }

    const requestId = ++waybillRequestIdRef.current;
    const driverRoute = driverDayRoutes.find((r) => r.driver.id === selectedDriverId);
    const driver = drivers.find((d) => d.id === selectedDriverId);

    if (!driverRoute || !driver || driverRoute.orders.length === 0) {
      clearWaybillLayers();
      return;
    }

    const { legs, stops } = buildWaybillPlan(driver, driverRoute.orders);

    const drawWaybill = async () => {
      clearWaybillLayers();
      if (requestId !== waybillRequestIdRef.current || !mapInstanceRef.current) return;

      stops.forEach((stop) => {
        const stopKey = `stop_${stop.type}_${stop.index}_${stop.order.id}`;
        const isPickup = stop.type === "pickup";
        const label = isPickup ? "Подача" : "Высадка";
        const orderColor = getWaybillOrderColor(stop.index);
        const balloonContent = `
          <div style="min-width: 220px; font-family: system-ui, -apple-system, sans-serif;">
            <h4 style="margin: 0 0 8px 0; font-weight: 600; font-size: 14px; color: ${orderColor};">
              ${isPickup ? "●" : "■"} ${label} · заказ ${stop.index} из ${stop.total}
            </h4>
            <p style="margin: 4px 0; font-size: 12px;"><strong>Время:</strong> ${formatWaybillTime(stop.order.desired_pickup_time)}</p>
            <p style="margin: 4px 0; font-size: 12px;"><strong>От:</strong> ${stop.order.pickup_title}</p>
            <p style="margin: 4px 0; font-size: 12px;"><strong>До:</strong> ${stop.order.dropoff_title}</p>
            <p style="margin: 4px 0; font-size: 11px; color: #6b7280;">Пассажир: ${stop.order.passenger_name ?? "—"}</p>
            <p style="margin: 8px 0 0 0; font-size: 11px; color: #6b7280;">Нажмите на метку для деталей заказа</p>
          </div>
        `;
        const marker = new ymaps.Placemark(
          stop.pos,
          {
            balloonContent,
            iconContent: String(stop.index),
          },
          {
            preset: isPickup ? "islands#circleIcon" : "islands#squareIcon",
            iconColor: orderColor,
          },
        );
        marker.events.add("click", () => {
          onOrderClickRef.current?.(stop.order.id);
        });
        mapInstanceRef.current!.geoObjects.add(marker);
        waybillMarkersRef.current.set(stopKey, marker);
      });

      const boundsPoints: number[][] = stops.map((s) => s.pos);
      if (driver.current_lat != null && driver.current_lon != null) {
        boundsPoints.push([driver.current_lat, driver.current_lon]);
      }

      const drawLeg = async (leg: WaybillLeg) => {
        if (requestId !== waybillRequestIdRef.current || !mapInstanceRef.current) return;

        const cacheKey = `waybill_${selectedDriverId}_${leg.from[0].toFixed(5)},${leg.from[1].toFixed(5)}_${leg.to[0].toFixed(5)},${leg.to[1].toFixed(5)}`;
        const validationOptions = { legType: leg.type };
        const legKey = `waybill_leg_${leg.type}_${leg.orderIndex}_${leg.order.id}`;
        const isDeadhead = leg.type === "deadhead";
        const orderColor = getWaybillOrderColor(leg.orderIndex);
        const routeStyle = {
          strokeColor: orderColor,
          strokeWidth: isDeadhead ? 3 : 5,
          opacity: isDeadhead ? 0.55 : 0.9,
        };

        let routeData = routeCacheRef.current.get(cacheKey);
        if (
          routeData?.geometry_source === "straight" ||
          routeData?.geometry_source === "estimated" ||
          routeData?.geometry_source === "unavailable" ||
          (routeData?.route &&
            isSuspiciousStraightRoute(
              routeData.route as Array<[number, number]>,
              leg.from,
              leg.to,
              { distance_km: routeData.distance_km },
              validationOptions,
            ))
        ) {
          routeCacheRef.current.delete(cacheKey);
          routeData = undefined;
        }

        const addRouteLayer = (layer: ymaps.GeoObject, data: typeof routeData) => {
          if (requestId !== waybillRequestIdRef.current || !mapInstanceRef.current) return;
          layer.events.add("click", () => {
            onOrderClickRef.current?.(leg.order.id);
          });
          mapInstanceRef.current.geoObjects.add(layer);
          waybillRoutesRef.current.set(legKey, layer);
          if (data) routeCacheRef.current.set(cacheKey, data);
        };

        const addRoutePolyline = (
          points: Array<[number, number]>,
          data: typeof routeData,
          strokeStyle: "solid" | "dash" = "solid",
        ) => {
          if (requestId !== waybillRequestIdRef.current || !mapInstanceRef.current) return;
          const polyline = new ymaps.Polyline(
            points as number[][],
            {},
            {
              ...routeStyle,
              strokeStyle,
              cursor: "pointer",
            },
          );
          addRouteLayer(polyline, data);
        };

        const drawStraightFallback = (reason: string) => {
          console.warn("Waybill straight fallback:", leg.type, leg.orderIndex, reason);
          const straightRoute: Array<[number, number]> = [leg.from, leg.to];
          addRoutePolyline(
            straightRoute,
            {
              route: straightRoute,
              distance_km: 0,
              duration_minutes: 0,
              geometry_source: "straight",
            },
            "dash",
          );
        };

        if (
          routeData?.route &&
          !isSuspiciousStraightRoute(
            routeData.route as Array<[number, number]>,
            leg.from,
            leg.to,
            { distance_km: routeData.distance_km },
            validationOptions,
          )
        ) {
          addRoutePolyline(routeData.route as Array<[number, number]>, routeData);
          return;
        }

        const roadRoute = await fetchRoadRouteForMap(leg.from, leg.to, validationOptions);
        if (roadRoute) {
          addRoutePolyline(roadRoute.route, roadRoute);
          return;
        }

        drawStraightFallback('OSRM road route unavailable');
      };

      const LEG_BATCH = 3;
      for (let i = 0; i < legs.length; i += LEG_BATCH) {
        if (requestId !== waybillRequestIdRef.current || !mapInstanceRef.current) return;
        await Promise.all(legs.slice(i, i + LEG_BATCH).map((leg) => drawLeg(leg)));
      }

      if (boundsPoints.length >= 2 && mapInstanceRef.current) {
        const lats = boundsPoints.map((p) => p[0]);
        const lons = boundsPoints.map((p) => p[1]);
        mapInstanceRef.current.setBounds(
          [
            [Math.min(...lats), Math.min(...lons)],
            [Math.max(...lats), Math.max(...lons)],
          ],
          { checkZoomRange: true, zoomMargin: 60 },
        );
      }
    };

    void drawWaybill();

    return () => {
      waybillRequestIdRef.current += 1;
    };
  }, [selectedDriverId, driverDayRoutes, drivers, showRoutes, waybillOnly, clearWaybillLayers]);

  // Отображение маршрутов водителей до активных заказов
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (waybillOnly || !showRoutes || selectedDriverId != null) {
      driverRoutesRef.current.forEach((route) => {
        mapInstanceRef.current!.geoObjects.remove(route);
      });
      driverRoutesRef.current.clear();
      return;
    }

    const activeOrdersWithDrivers = activeOrders.filter(o => o.driver_id);
    
    activeOrdersWithDrivers.forEach(async (order) => {
      const driverId = order.driver_id!;
      const driver = drivers.find(d => String(d.id) === driverId);
      
      if (!driver || !driver.current_lat || !driver.current_lon) return;
      if (!order.pickup_lat || !order.pickup_lon) return;

      const routeKey = `driver_${driverId}_order_${order.id}`;
      
      if (routeCacheRef.current.has(routeKey)) {
        const cachedRoute = routeCacheRef.current.get(routeKey);
        const existingRoute = driverRoutesRef.current.get(routeKey);
        
        if (!existingRoute && cachedRoute && mapInstanceRef.current) {
          const polyline = new ymaps.Polyline(
            cachedRoute.route as number[][],
            {
              balloonContent: `
                <div style="min-width: 200px; font-family: system-ui, -apple-system, sans-serif;">
                  <h4 style="margin: 0 0 10px 0; font-weight: 600; font-size: 14px; color: #1f2937;">🚗 Маршрут водителя</h4>
                  <div style="padding: 8px; background: #dbeafe; border-radius: 6px;">
                    <p style="margin: 4px 0; font-size: 13px;"><strong>📏 Расстояние:</strong> ${cachedRoute.distance_km.toFixed(2)} км</p>
                    <p style="margin: 4px 0; font-size: 13px;"><strong>⏱️ Время в пути:</strong> ~${cachedRoute.duration_minutes} мин</p>
                  </div>
                  ${driver.name ? `<p style="margin: 8px 0 0 0; font-size: 12px; color: #6b7280;">Водитель: ${driver.name}</p>` : ''}
                </div>
              `,
            },
            {
              strokeColor: '#3b82f6',
              strokeWidth: 5,
              opacity: 0.8,
              strokeStyle: 'shortdash',
            }
          );
          mapInstanceRef.current.geoObjects.add(polyline);
          driverRoutesRef.current.set(routeKey, polyline);
        }
        return;
      }

      try {
        const routeData = await dispatchApi.getDriverRoute(driverId);
        routeCacheRef.current.set(routeKey, routeData);
        
        const existingRoute = driverRoutesRef.current.get(routeKey);
        if (existingRoute && mapInstanceRef.current) {
          mapInstanceRef.current.geoObjects.remove(existingRoute);
        }
        
        if (!mapInstanceRef.current) return;

        const polyline = new ymaps.Polyline(
          routeData.route as number[][],
          {
            balloonContent: `
              <div style="min-width: 200px; font-family: system-ui, -apple-system, sans-serif;">
                <h4 style="margin: 0 0 10px 0; font-weight: 600; font-size: 14px; color: #1f2937;">🚗 Маршрут водителя</h4>
                <div style="padding: 8px; background: #dbeafe; border-radius: 6px;">
                  <p style="margin: 4px 0; font-size: 13px;"><strong>📏 Расстояние:</strong> ${routeData.distance_km.toFixed(2)} км</p>
                  <p style="margin: 4px 0; font-size: 13px;"><strong>⏱️ Время в пути:</strong> ~${routeData.duration_minutes} мин</p>
                  <p style="margin: 4px 0; font-size: 12px; color: #6b7280;">ETA: ${routeData.eta || '—'}</p>
                </div>
                ${driver.name ? `<p style="margin: 8px 0 0 0; font-size: 12px; color: #6b7280;">Водитель: ${driver.name}</p>` : ''}
              </div>
            `,
          },
          {
            strokeColor: '#3b82f6',
            strokeWidth: 5,
            opacity: 0.8,
            strokeStyle: 'shortdash',
          }
        );
        
        mapInstanceRef.current.geoObjects.add(polyline);
        driverRoutesRef.current.set(routeKey, polyline);
      } catch (error) {
        console.error(`Error loading route for driver ${driverId}:`, error);
      }
    });

    // Удаляем маршруты для неактивных заказов
    driverRoutesRef.current.forEach((route, key) => {
      const parts = key.split('_');
      const driverId = parts[1];
      const orderId = parts[3];
      const orderExists = activeOrders.some(o => 
        String(o.id) === orderId && o.driver_id === driverId
      );
      
      if (!orderExists && mapInstanceRef.current) {
        mapInstanceRef.current.geoObjects.remove(route);
        driverRoutesRef.current.delete(key);
        routeCacheRef.current.delete(key);
      }
    });
  }, [activeOrders, drivers, showRoutes, selectedDriverId, waybillOnly]);

  // Отображение маршрутов заказов (от точки забора до высадки)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (waybillOnly || !showRoutes || selectedDriverId != null) {
      orderRoutesRef.current.forEach((route) => {
        mapInstanceRef.current!.geoObjects.remove(route);
      });
      orderRoutesRef.current.clear();
      return;
    }

    const ordersWithDropoff = activeOrders.filter(o => 
      o.pickup_lat && o.pickup_lon && o.dropoff_lat && o.dropoff_lon
    );

    ordersWithDropoff.forEach(async (order) => {
      const routeKey = `order_${order.id}`;
      
      if (routeCacheRef.current.has(routeKey)) {
        const cachedRoute = routeCacheRef.current.get(routeKey);
        const existingRoute = orderRoutesRef.current.get(routeKey);
        
        if (!existingRoute && cachedRoute && mapInstanceRef.current) {
          const polyline = new ymaps.Polyline(
            cachedRoute.route as number[][],
            {
              balloonContent: `
                <div style="min-width: 220px; font-family: system-ui, -apple-system, sans-serif;">
                  <h4 style="margin: 0 0 10px 0; font-weight: 600; font-size: 14px; color: #1f2937;">📦 Маршрут заказа</h4>
                  <div style="margin-bottom: 8px; padding: 6px; background: #d1fae5; border-radius: 4px;">
                    <p style="margin: 2px 0; font-size: 12px;"><strong>📍 От:</strong> ${order.pickup_title}</p>
                  </div>
                  <div style="margin-bottom: 8px; padding: 6px; background: #fee2e2; border-radius: 4px;">
                    <p style="margin: 2px 0; font-size: 12px;"><strong>🎯 До:</strong> ${order.dropoff_title}</p>
                  </div>
                  <div style="padding: 8px; background: #d1fae5; border-radius: 6px;">
                    <p style="margin: 4px 0; font-size: 13px;"><strong>📏 Расстояние:</strong> ${cachedRoute.distance_km.toFixed(2)} км</p>
                    <p style="margin: 4px 0; font-size: 13px;"><strong>⏱️ Время в пути:</strong> ~${cachedRoute.duration_minutes} мин</p>
                  </div>
                </div>
              `,
            },
            {
              strokeColor: '#10b981',
              strokeWidth: 5,
              opacity: 0.8,
            }
          );
          mapInstanceRef.current.geoObjects.add(polyline);
          orderRoutesRef.current.set(routeKey, polyline);
        }
        return;
      }

      try {
        const routeData = await dispatchApi.getOrderRoute(String(order.id));
        routeCacheRef.current.set(routeKey, routeData);
        
        const existingRoute = orderRoutesRef.current.get(routeKey);
        if (existingRoute && mapInstanceRef.current) {
          mapInstanceRef.current.geoObjects.remove(existingRoute);
        }
        
        if (!mapInstanceRef.current) return;

        const polyline = new ymaps.Polyline(
          routeData.route as number[][],
          {
            balloonContent: `
              <div style="min-width: 220px; font-family: system-ui, -apple-system, sans-serif;">
                <h4 style="margin: 0 0 10px 0; font-weight: 600; font-size: 14px; color: #1f2937;">📦 Маршрут заказа</h4>
                <div style="margin-bottom: 8px; padding: 6px; background: #d1fae5; border-radius: 4px;">
                  <p style="margin: 2px 0; font-size: 12px;"><strong>📍 От:</strong> ${order.pickup_title}</p>
                </div>
                <div style="margin-bottom: 8px; padding: 6px; background: #fee2e2; border-radius: 4px;">
                  <p style="margin: 2px 0; font-size: 12px;"><strong>🎯 До:</strong> ${order.dropoff_title}</p>
                </div>
                <div style="padding: 8px; background: #d1fae5; border-radius: 6px;">
                  <p style="margin: 4px 0; font-size: 13px;"><strong>📏 Расстояние:</strong> ${routeData.distance_km.toFixed(2)} км</p>
                  <p style="margin: 4px 0; font-size: 13px;"><strong>⏱️ Время в пути:</strong> ~${routeData.duration_minutes} мин</p>
                  <p style="margin: 4px 0; font-size: 12px; color: #6b7280;">ETA: ${routeData.eta || '—'}</p>
                </div>
              </div>
            `,
          },
          {
            strokeColor: '#10b981',
            strokeWidth: 5,
            opacity: 0.8,
          }
        );
        
        mapInstanceRef.current.geoObjects.add(polyline);
        orderRoutesRef.current.set(routeKey, polyline);
      } catch (error) {
        console.error(`Error loading route for order ${order.id}:`, error);
      }
    });

    // Удаляем маршруты для неактивных заказов
    orderRoutesRef.current.forEach((route, key) => {
      const parts = key.split('_');
      const orderId = parts[1];
      const orderExists = activeOrders.some(o => String(o.id) === orderId);
      
      if (!orderExists && mapInstanceRef.current) {
        mapInstanceRef.current.geoObjects.remove(route);
        orderRoutesRef.current.delete(key);
        routeCacheRef.current.delete(key);
      }
    });
  }, [activeOrders, showRoutes, selectedDriverId, waybillOnly]);

  // Отображение городов на карте
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    
    if (waybillOnly || !showCities) {
      cityMarkersRef.current.forEach(marker => {
        mapInstanceRef.current!.geoObjects.remove(marker);
      });
      cityMarkersRef.current.clear();
      return;
    }

    const currentCityIds = new Set<string>();

    cities.forEach(city => {
      if (!city.center_lat || !city.center_lon) return;
      
      const cityId = city.id;
      currentCityIds.add(cityId);
      
      const existingMarker = cityMarkersRef.current.get(cityId);
      const position: [number, number] = [city.center_lat, city.center_lon];

      const balloonContent = `
        <div style="min-width: 180px;">
          <h3 style="margin: 0 0 8px 0; font-weight: 600; color: #1f2937;">🏙️ ${city.title}</h3>
          <p style="margin: 4px 0; font-size: 12px; color: #6b7280;">ID: ${city.id}</p>
          <p style="margin: 4px 0; font-size: 12px; color: #6b7280;">
            Координаты: ${city.center_lat.toFixed(6)}, ${city.center_lon.toFixed(6)}
          </p>
        </div>
      `;

      if (existingMarker) {
        existingMarker.geometry.setCoordinates(position);
        existingMarker.properties.set({ balloonContent });
      } else {
        const marker = new ymaps.Placemark(
          position,
          { balloonContent, iconCaption: city.title },
          { preset: 'islands#blueCircleDotIcon' }
        );
        mapInstanceRef.current!.geoObjects.add(marker);
        cityMarkersRef.current.set(cityId, marker);
      }
    });

    // Удаляем маркеры городов, которых больше нет
    cityMarkersRef.current.forEach((marker, cityId) => {
      if (!currentCityIds.has(cityId) && mapInstanceRef.current) {
        mapInstanceRef.current.geoObjects.remove(marker);
        cityMarkersRef.current.delete(cityId);
      }
    });
  }, [cities, showCities, waybillOnly]);

  // Отображение регионов на карте
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    
    if (waybillOnly || !showRegions) {
      regionLayersRef.current.forEach((layer: any) => {
        mapInstanceRef.current!.geoObjects.remove(layer);
      });
      regionLayersRef.current.clear();
      return;
    }

    const currentRegionIds = new Set<string>();

    regions.forEach(region => {
      if (!region.center_lat || !region.center_lon) return;
      
      const regionId = region.id;
      currentRegionIds.add(regionId);
      
      const existingLayer = regionLayersRef.current.get(regionId);
      const position: [number, number] = [region.center_lat, region.center_lon];

      const balloonContent = `
        <div style="min-width: 200px;">
          <h3 style="margin: 0 0 8px 0; font-weight: 600; color: #1f2937;">📍 ${region.title}</h3>
          ${region.city ? `<p style="margin: 4px 0; font-size: 12px; color: #6b7280;">Город: ${region.city.title}</p>` : ''}
          <p style="margin: 4px 0; font-size: 12px; color: #6b7280;">ID: ${region.id}</p>
          <p style="margin: 4px 0; font-size: 12px; color: #6b7280;">
            Координаты: ${region.center_lat.toFixed(6)}, ${region.center_lon.toFixed(6)}
          </p>
          ${region.service_radius_meters ? `<p style="margin: 4px 0; font-size: 12px; color: #6b7280;">Радиус: ${region.service_radius_meters} м</p>` : ''}
        </div>
      `;

      if (existingLayer) {
        if (existingLayer.properties) {
          existingLayer.properties.set({ balloonContent });
        }
      } else {
        let layer: any;
        
        if (region.polygon_coordinates && region.polygon_coordinates.length >= 3) {
          const coords = region.polygon_coordinates.map(
            (p: number[]) => [p[0], p[1]] as [number, number]
          );
          layer = new ymaps.Polygon(
            [coords],
            { balloonContent },
            {
              fillColor: 'rgba(59, 130, 246, 0.2)',
              strokeColor: '#3b82f6',
              strokeWidth: 2,
            }
          );
        } else {
          const radius = region.service_radius_meters || 2000;
          layer = new ymaps.Circle(
            [position, radius],
            { balloonContent },
            {
              fillColor: 'rgba(59, 130, 246, 0.2)',
              strokeColor: '#3b82f6',
              strokeWidth: 2,
            }
          );
        }

        mapInstanceRef.current!.geoObjects.add(layer);
        regionLayersRef.current.set(regionId, layer);
      }
    });

    // Удаляем слои регионов, которых больше нет
    regionLayersRef.current.forEach((layer: any, regionId: string) => {
      if (!currentRegionIds.has(regionId) && mapInstanceRef.current) {
        mapInstanceRef.current.geoObjects.remove(layer);
        regionLayersRef.current.delete(regionId);
      }
    });
  }, [regions, showRegions, waybillOnly]);

  // Отображение тепловой карты спроса (через ymaps.Circle)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    
    if (waybillOnly || !showHeatmap) {
      heatmapLayersRef.current.forEach((layer: any) => {
        mapInstanceRef.current!.geoObjects.remove(layer);
      });
      heatmapLayersRef.current = [];
      return;
    }

    const allOrders = [...orders, ...activeOrders];
    const orderLocations = allOrders
      .filter(o => o.pickup_lat && o.pickup_lon)
      .map(o => ({ lat: o.pickup_lat!, lon: o.pickup_lon! }));

    const groupedLocations = new window.Map<string, { lat: number; lon: number; count: number }>();
    const clusterRadius = 0.01;

    orderLocations.forEach(loc => {
      const key = `${Math.round(loc.lat / clusterRadius)}_${Math.round(loc.lon / clusterRadius)}`;
      const existing = groupedLocations.get(key);
      if (existing) {
        existing.count++;
      } else {
        groupedLocations.set(key, { ...loc, count: 1 });
      }
    });

    // Удаляем старые слои
    heatmapLayersRef.current.forEach((layer: any) => {
      mapInstanceRef.current!.geoObjects.remove(layer);
    });
    heatmapLayersRef.current = [];

    groupedLocations.forEach((location) => {
      const intensity = Math.min(location.count / 5, 1);
      const radius = 200 + (intensity * 300);
      
      const hue = 240 - (intensity * 180);
      const color = `hsl(${hue}, 70%, 50%)`;
      
      const circle = new ymaps.Circle(
        [[location.lat, location.lon], radius],
        {
          balloonContent: `
            <div style="min-width: 150px; font-family: system-ui, -apple-system, sans-serif;">
              <h4 style="margin: 0 0 8px 0; font-weight: 600; font-size: 14px;">🔥 Тепловая карта</h4>
              <p style="margin: 4px 0; font-size: 13px;"><strong>Заказов в зоне:</strong> ${location.count}</p>
              <p style="margin: 4px 0; font-size: 12px; color: #6b7280;">Интенсивность: ${Math.round(intensity * 100)}%</p>
            </div>
          `,
        },
        {
          fillColor: color,
          fillOpacity: 0.3,
          strokeColor: color,
          strokeWidth: 2,
          strokeOpacity: 0.6,
        }
      );

      mapInstanceRef.current!.geoObjects.add(circle);
      heatmapLayersRef.current.push(circle);
    });
  }, [orders, activeOrders, showHeatmap, waybillOnly]);

  // Очистка при размонтировании
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.destroy();
        mapInstanceRef.current = null;
      }
      orderMarkersRef.current.clear();
      driverMarkersRef.current.clear();
      driverRoutesRef.current.clear();
      orderRoutesRef.current.clear();
      waybillRoutesRef.current.clear();
      waybillMarkersRef.current.clear();
      cityMarkersRef.current.clear();
      regionLayersRef.current.clear();
      routeCacheRef.current.clear();
      heatmapLayersRef.current = [];
    };
  }, []);

  return (
    <div className="relative w-full h-full rounded-lg">
      <div ref={mapRef} className="w-full h-full rounded-lg" />
      {waybillOnly && selectedDriverId == null && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[999]">
          <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-lg px-6 py-4 border border-gray-200 dark:border-gray-700 shadow-lg text-center max-w-sm">
            <p className="text-sm font-medium dark:text-white">Путевой лист не выбран</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Нажмите на водителя в «План на день»
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
