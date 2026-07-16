import { useCallback, useEffect, useState } from "react";
import {
  Calendar, MapPin, Clock, User, Loader2, AlertCircle, Route, Users, Navigation, Brain, CheckCircle,
  BarChart3, TrendingUp, Lightbulb, Download, FileSpreadsheet, Coffee, Truck, Plus,
} from "lucide-react";
import {
  DailyRoutesResponse,
  DailyRoute,
  DailyRouteOrder,
  DriverLunchBreak,
  RentalVehicle,
  MLScoreDetails,
  DispatcherScoreBreakdown,
  DistributionCandidate,
  dispatchApi,
} from "../services/dispatch";
import { toast } from "sonner";

export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function statusLabel(status: string): string {
  const m: Record<string, string> = {
    submitted: "Новый",
    active_queue: "В очереди",
    awaiting_dispatcher_decision: "Ожидает",
    assigned: "Назначен",
    driver_en_route: "В пути",
    ride_ongoing: "Поездка",
    completed: "Завершён",
    cancelled: "Отменён",
  };
  return m[status] || status;
}

export function statusColor(status: string): string {
  if (["assigned", "driver_en_route", "ride_ongoing"].includes(status))
    return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  if (["submitted", "active_queue", "awaiting_dispatcher_decision"].includes(status))
    return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
  return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
}

function isMinivanGroupOrder(order: DailyRouteOrder): boolean {
  if (order.is_minivan || order.score_breakdown?.is_minivan) return true;
  const routeType = order.score_breakdown?.route_type;
  if (routeType === "minivan_group") return true;
  const batchId = order.pickup_batch_id ?? order.score_breakdown?.pickup_batch_id;
  return (
    typeof batchId === "string" &&
    (batchId.startsWith("minivan-group:") || batchId.startsWith("minivan-trip:"))
  );
}

function orderTripIndex(order: DailyRouteOrder): number | null {
  const ti = order.trip_index ?? order.score_breakdown?.trip_index;
  return typeof ti === "number" ? ti : null;
}

function lunchLabel(lunch: DriverLunchBreak | null | undefined): string | null {
  if (!lunch) return null;
  if (lunch.label) return lunch.label;
  if (lunch.start_time && lunch.end_time) {
    return `${formatTime(lunch.start_time)}–${formatTime(lunch.end_time)}`;
  }
  return null;
}

function ScoreBar({ label, value, color, extra }: { label: string; value: number; color: string; extra?: string }) {
  const pct = Math.round(value * 100);
  const colorMap: Record<string, string> = {
    blue: "bg-blue-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
    orange: "bg-orange-500",
    green: "bg-green-500",
    purple: "bg-purple-500",
  };
  const bgColor = colorMap[color] || "bg-gray-500";
  return (
    <div>
      <div className="flex justify-between mb-0.5">
        <span className="text-gray-600 dark:text-gray-400">{label}</span>
        <span className="font-mono text-gray-800 dark:text-gray-200">{pct}%</span>
      </div>
      <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${bgColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      {extra && <p className="text-gray-400 dark:text-gray-500 mt-0.5">{extra}</p>}
    </div>
  );
}

function DispatcherScorePanel({ breakdown, total }: { breakdown: DispatcherScoreBreakdown; total?: number }) {
  const score = total ?? breakdown.total_score ?? 0;
  return (
    <div className="mt-2 p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-md border border-indigo-100 dark:border-indigo-800 text-xs">
      <p className="font-medium text-indigo-700 dark:text-indigo-300 mb-1">
        Score: {typeof score === "number" ? score.toFixed(1) : score} (T+L+D)
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-gray-600 dark:text-gray-400">
        <span>Доезд: +{breakdown.T_travel_min ?? 0} мин</span>
        <span>Нагрузка: +{breakdown.L_load ?? 0}</span>
        <span>Риск: +{breakdown.D_delay_risk ?? 0}</span>
      </div>
      {breakdown.free_minutes_before_pickup != null && (
        <p className="text-gray-500 mt-1">Запас до подачи: {breakdown.free_minutes_before_pickup} мин</p>
      )}
    </div>
  );
}

export interface DayRoutesPanelProps {
  data: DailyRoutesResponse | null;
  loading?: boolean;
  compact?: boolean;
  selectedDriverId?: number | null;
  onDriverSelect?: (driverId: number) => void;
  planDate?: string;
  showExport?: boolean;
  /** После назначения на аренду — обновить план дня */
  onPlanChanged?: () => void;
}

export function DayRoutesPanel({
  data,
  loading = false,
  compact = false,
  selectedDriverId = null,
  onDriverSelect,
  planDate,
  showExport = false,
  onPlanChanged,
}: DayRoutesPanelProps) {
  const [expandedDriver, setExpandedDriver] = useState<number | null>(null);
  const [expandedUnassigned, setExpandedUnassigned] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingUnassigned, setExportingUnassigned] = useState(false);
  const [rentalVehicles, setRentalVehicles] = useState<RentalVehicle[]>([]);
  const [selectedRentalId, setSelectedRentalId] = useState<number | "auto">("auto");
  const [rentalBusy, setRentalBusy] = useState(false);
  const [assigningOrderId, setAssigningOrderId] = useState<string | null>(null);

  const dateForRental = planDate || data?.date;

  const refreshRentalVehicles = useCallback(async () => {
    if (!dateForRental) return;
    try {
      const res = await dispatchApi.listRentalVehicles(dateForRental);
      setRentalVehicles(res.vehicles);
    } catch {
      /* список аренды не критичен для отображения плана */
    }
  }, [dateForRental]);

  useEffect(() => {
    void refreshRentalVehicles();
  }, [refreshRentalVehicles]);

  const handleAddRentalVehicle = async () => {
    if (!dateForRental) {
      toast.error("Выберите дату плана");
      return;
    }
    setRentalBusy(true);
    try {
      const res = await dispatchApi.createRentalVehicle({ date: dateForRental });
      setRentalVehicles(res.vehicles);
      setSelectedRentalId(res.driver.id);
      toast.success(`Добавлена ${res.driver.name} (${res.driver.plate_number})`);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data
          ?.error ||
        (err instanceof Error ? err.message : "Не удалось создать арендную машину");
      toast.error(message);
    } finally {
      setRentalBusy(false);
    }
  };

  const handleAssignToRental = async (orderId: string) => {
    if (!dateForRental) {
      toast.error("Выберите дату плана");
      return;
    }
    setAssigningOrderId(orderId);
    try {
      const res = await dispatchApi.assignToRental({
        date: dateForRental,
        order_id: orderId,
        rental_driver_id: selectedRentalId === "auto" ? undefined : selectedRentalId,
      });
      toast.success(res.message || `Назначен на ${res.driver.name}`);
      await refreshRentalVehicles();
      onPlanChanged?.();
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data
          ?.error ||
        (err instanceof Error ? err.message : "Не удалось распределить на аренду");
      toast.error(message);
    } finally {
      setAssigningOrderId(null);
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const handleExportUnassigned = async () => {
    const date = planDate || data?.date;
    if (!date) {
      toast.error("Выберите дату для экспорта");
      return;
    }
    setExportingUnassigned(true);
    toast.info("Формируем список нераспределённых…");
    try {
      const blob = await dispatchApi.exportUnassignedOrders(date);
      downloadBlob(blob, `unassigned_${date}.xlsx`);
      toast.success("Список нераспределённых скачан");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Ошибка экспорта";
      toast.error(message);
    } finally {
      setExportingUnassigned(false);
    }
  };

  const exportBusy = exporting || exportingUnassigned;

  const exportButtons = () => (
    <div className="flex flex-wrap justify-end gap-2">
      <button
        type="button"
        onClick={() => void handleExportUnassigned()}
        disabled={exportBusy}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
        title="Excel: заказы без водителя, причина и время подачи"
      >
        {exportingUnassigned ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
        Нераспределённые (XLSX)
      </button>
      <button
        type="button"
        onClick={() => void handleExportRoutes()}
        disabled={exportBusy}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        title="Маршрутные листы по водителям (XLSX в ZIP)"
      >
        {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        Маршруты (ZIP)
      </button>
    </div>
  );

  const handleExportRoutes = async () => {
    const date = planDate || data?.date;
    if (!date) {
      toast.error("Выберите дату для экспорта");
      return;
    }
    setExporting(true);
    try {
      const blob = await dispatchApi.exportDailyRoutes(date);
      downloadBlob(blob, `daily_routes_${date}.zip`);
      toast.success("Маршрутные листы экспортированы");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Ошибка экспорта";
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  const isDispatcherV1 = data?.algorithm === "dispatcher_v1";
  const minivanOrderCountFromRoutes = (data?.routes ?? []).reduce((acc, route) => {
    return acc + route.orders.filter((order) => isMinivanGroupOrder(order)).length;
  }, 0);
  const minivanGroupCountFromRoutes = new Set(
    (data?.routes ?? [])
      .flatMap((route) => route.orders)
      .filter((order) => isMinivanGroupOrder(order))
      .map((order) => order.pickup_batch_id || order.score_breakdown?.pickup_batch_id || order.id),
  ).size;
  const minivanOrderCount = data?.minivan_group_orders_assigned ?? minivanOrderCountFromRoutes;
  const minivanGroupCount = data?.minivan_groups_assigned ?? minivanGroupCountFromRoutes;
  const driversOnLine =
    data?.drivers_on_line ??
    (data?.router_stats?.used_drivers as number | undefined) ??
    data?.routes?.length ??
    0;
  const driversTotalPool =
    data?.drivers_total_pool ??
    (data?.router_stats?.total_drivers as number | undefined) ??
    data?.drivers_count ??
    0;
  const unusedDrivers = data?.unused_drivers ?? [];
  const minivanRoutes = (data?.routes ?? []).filter(
    (route) => route.is_minivan || route.orders.some(isMinivanGroupOrder),
  );
  const sedanRoutes = (data?.routes ?? []).filter(
    (route) => !(route.is_minivan || route.orders.some(isMinivanGroupOrder)),
  );

  const renderRouteList = (routes: DailyRoute[], title: string, icon: JSX.Element) =>
    routes.length > 0 ? (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold dark:text-white flex items-center gap-2">
          {icon}
          {title} ({routes.length})
        </h3>
        <div className={`space-y-2 ${compact ? "max-h-[calc(100vh-420px)] overflow-y-auto pr-1" : ""}`}>
          {routes.map((route) => (
            <DriverRouteCard
              key={route.driver.id}
              route={route}
              expanded={expandedDriver === route.driver.id}
              selected={selectedDriverId === route.driver.id}
              onSelect={onDriverSelect ? () => onDriverSelect(route.driver.id) : undefined}
              onToggle={() =>
                setExpandedDriver(expandedDriver === route.driver.id ? null : route.driver.id)
              }
            />
          ))}
        </div>
      </div>
    ) : null;

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
          Выберите дату и нажмите «Обновить» для загрузки маршрутов
        </div>
        {showExport && planDate && exportButtons()}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.algorithm && !compact && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-3 border border-indigo-200 dark:border-indigo-800 text-xs">
          <div className="flex items-center gap-2 mb-1">
            <Brain className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span className="font-medium text-indigo-800 dark:text-indigo-200">
              {isDispatcherV1 ? "dispatcher_v1" : "ML-алгоритм"}
            </span>
          </div>
          {isDispatcherV1 && (
            <p className="text-indigo-700 dark:text-indigo-300">
              score = T + L + D · смена {data.config.shift_start ?? "08:00"}–{data.config.shift_end ?? "18:00"}
            </p>
          )}
        </div>
      )}

      <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4"}`}>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">Всего</p>
          <p className="text-lg font-semibold dark:text-white">{data.total_orders}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-green-600 dark:text-green-400">Распределено</p>
          <p className="text-lg font-semibold text-green-700 dark:text-green-300">{data.distributed_count}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-red-600 dark:text-red-400">Не распределено</p>
          <p className="text-lg font-semibold text-red-700 dark:text-red-300">{data.failed_count}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-blue-600 dark:text-blue-400">На линии</p>
          <p className="text-lg font-semibold text-blue-700 dark:text-blue-300">
            {driversOnLine} из {driversTotalPool}
          </p>
        </div>
      </div>
      {unusedDrivers.length > 0 && (
        <div className="bg-slate-50 dark:bg-slate-900/30 rounded-lg p-3 border border-slate-200 dark:border-slate-700 text-xs">
          <p className="font-medium text-slate-800 dark:text-slate-200 mb-1">
            Не вышли ({unusedDrivers.length})
          </p>
          <p className="text-slate-600 dark:text-slate-400 line-clamp-3">
            {unusedDrivers
              .slice(0, 8)
              .map((d) => `${d.name}${d.region ? ` (${d.region})` : ""}`)
              .join(" · ")}
            {unusedDrivers.length > 8 ? ` · +${unusedDrivers.length - 8}` : ""}
          </p>
        </div>
      )}
      {(minivanOrderCount > 0 || minivanGroupCount > 0) && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-2.5 border border-indigo-200 dark:border-indigo-800 text-xs text-indigo-800 dark:text-indigo-200">
          Минивэн-фаза: групп {minivanGroupCount}, заказов {minivanOrderCount}
        </div>
      )}

      {showExport && (planDate || data.date) && exportButtons()}

      {data.statistics && !compact && (
        <DistributionStatisticsSection statistics={data.statistics} failedCount={data.failed_count} />
      )}

      {data.reoptimized && (
        <p className="text-xs text-indigo-600 dark:text-indigo-400">
          Перераспределено: {data.reassigned_count ?? 0} · зафиксировано в пути: {data.locked_count ?? 0}
        </p>
      )}

      {data.routes.length === 0 && loading && (data.distributed_count ?? 0) > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700 text-center">
          <Loader2 className="w-8 h-8 mx-auto text-indigo-500 animate-spin mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Загрузка маршрутов на {data.date}…
          </p>
        </div>
      )}

      {data.routes.length === 0 && !loading && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-8 shadow-sm border border-gray-200 dark:border-gray-700 text-center">
          <Calendar className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {(data.distributed_count ?? 0) > 0
              ? `Назначено ${data.distributed_count} заказов — нажмите «Обновить» для загрузки маршрутов`
              : `Нет маршрутов на ${data.date}`}
          </p>
        </div>
      )}

      {data.routes.length > 0 && (
        <div className="space-y-4">
          {onDriverSelect && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Кликните водителя, чтобы показать путевой лист на карте
            </p>
          )}
          {renderRouteList(
            minivanRoutes,
            "Минивэны",
            <Users className="w-4 h-4 text-violet-600" />,
          )}
          {renderRouteList(
            sedanRoutes,
            "Седаны",
            <Route className="w-4 h-4" />,
          )}
        </div>
      )}

      {data.unassigned_orders.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 border border-red-200 dark:border-red-800">
          <h3 className="text-xs font-medium text-red-800 dark:text-red-200 mb-1">
            <AlertCircle className="w-3 h-3 inline mr-1" />
            Нераспределённые ({data.unassigned_orders.length})
          </h3>
          {data.unassigned_orders.some((o) => o.reason_code === "rental_recommended") && (
            <p className="text-[10px] text-amber-700 dark:text-amber-300 mb-2 flex items-center gap-1">
              <Truck className="w-3 h-3" />
              Часть заказов — рекомендация аренды (не влезают реальным водителям)
            </p>
          )}
          {data.flagged_for_dispatcher_count != null && data.flagged_for_dispatcher_count > 0 && (
            <p className="text-[10px] text-red-600 dark:text-red-400 mb-2">
              {data.flagged_for_dispatcher_count} переведено в «Ожидание решения диспетчера» для ручного назначения
            </p>
          )}

          <div className="mb-2 p-2 rounded-md bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 space-y-2">
            <p className="text-[11px] font-medium text-amber-900 dark:text-amber-100 flex items-center gap-1">
              <Truck className="w-3.5 h-3.5" />
              Арендованные машины
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedRentalId === "auto" ? "auto" : String(selectedRentalId)}
                onChange={(e) => {
                  const v = e.target.value;
                  setSelectedRentalId(v === "auto" ? "auto" : Number(v));
                }}
                className="text-xs rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 px-2 py-1 min-w-[10rem]"
              >
                <option value="auto">Авто (свободная / новая)</option>
                {rentalVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.plate_number}
                    {v.orders_count != null ? ` (${v.orders_count})` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleAddRentalVehicle()}
                disabled={rentalBusy || !dateForRental}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {rentalBusy ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Plus className="w-3 h-3" />
                )}
                Добавить аренду
              </button>
            </div>
            <p className="text-[10px] text-amber-800/80 dark:text-amber-200/80">
              Выберите машину (или «Авто») и нажмите «Распределить» у заказа
            </p>
          </div>

          <div className="space-y-1">
            {data.unassigned_orders.map((o) => (
              <div
                key={o.id}
                className={`text-xs rounded-md p-1.5 ${
                  o.reason_code === "rental_recommended"
                    ? "bg-amber-50/50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200"
                    : "text-red-700 dark:text-red-300"
                }`}
              >
                <div className="flex items-start gap-2">
                <button
                  type="button"
                  className="text-left hover:underline flex-1 min-w-0"
                  onClick={() =>
                    setExpandedUnassigned(expandedUnassigned === o.id ? null : o.id)
                  }
                >
                  <span className="font-mono text-[10px] mr-1">{o.hour_label ?? "—"}</span>
                  {o.reason_code === "rental_recommended" && (
                    <span className="inline-flex items-center gap-0.5 px-1 py-0.5 mr-1 rounded text-[10px] bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                      <Truck className="w-3 h-3" />
                      Аренда
                    </span>
                  )}
                  <span className="break-all">{o.id}</span>
                  {o.pickup_title && (
                    <span className="block text-[10px] opacity-80 truncate mt-0.5">
                      {o.pickup_title}
                    </span>
                  )}
                  <span className="block text-[10px] opacity-80 mt-0.5">{o.reason}</span>
                  {o.suggested_action && (
                    <span className="block text-[10px] opacity-70 mt-0.5">
                      → {o.suggested_action}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void handleAssignToRental(o.id)}
                  disabled={assigningOrderId === o.id || rentalBusy || !dateForRental}
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                  title="Назначить на арендованную машину"
                >
                  {assigningOrderId === o.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Truck className="w-3 h-3" />
                  )}
                  Распределить
                </button>
                </div>
                {expandedUnassigned === o.id && o.candidates_checked && o.candidates_checked.length > 0 && (
                  <table className="mt-1 w-full text-[10px] border border-red-200 dark:border-red-800 rounded overflow-hidden">
                    <thead className="bg-red-100/50 dark:bg-red-900/30">
                      <tr>
                        <th className="p-1 text-left">Водитель</th>
                        <th className="p-1">OK</th>
                        <th className="p-1">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.candidates_checked.map((c: DistributionCandidate) => (
                        <tr key={c.driver_id} className="border-t border-red-100 dark:border-red-900">
                          <td className="p-1">{c.driver_name}</td>
                          <td className="p-1 text-center">{c.can_assign ? "✓" : "—"}</td>
                          <td className="p-1 text-center">{c.score != null ? c.score.toFixed(1) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
        </div>
      )}
    </div>
  );
}

function DistributionStatisticsSection({
  statistics,
  failedCount,
}: {
  statistics: NonNullable<DailyRoutesResponse["statistics"]>;
  failedCount: number;
}) {
  const maxHourlyTotal = Math.max(...statistics.hourly.map((h) => h.total), 1);
  const { drivers } = statistics;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold dark:text-white flex items-center gap-2">
        <BarChart3 className="w-4 h-4" />
        Статистика распределения
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <Users className="w-3 h-3" /> Загружено водителей
          </p>
          <p className="text-lg font-semibold dark:text-white">
            {drivers.active} <span className="text-sm font-normal text-gray-400">/ {drivers.total}</span>
          </p>
          <p className="text-[10px] text-gray-500">простаивает: {drivers.idle}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">Средняя нагрузка</p>
          <p className="text-lg font-semibold dark:text-white">{drivers.avg_orders_per_active_driver}</p>
          <p className="text-[10px] text-gray-500">заказов / водитель</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">Макс. на водителя</p>
          <p className="text-lg font-semibold dark:text-white">{drivers.max_orders_on_driver}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-amber-200 dark:border-amber-800">
          <p className="text-xs text-amber-700 dark:text-amber-400">Нужно +водителей</p>
          <p className="text-lg font-semibold text-amber-800 dark:text-amber-300">
            {failedCount > 0 ? `~${drivers.recommended_extra_drivers}` : "0"}
          </p>
        </div>
      </div>

      {statistics.hourly.some((h) => h.total > 0) && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            Заказы по часам (всего / не распределено)
          </p>
          <div className="flex items-end gap-0.5 h-24 overflow-x-auto pb-1">
            {statistics.hourly.map((slot) => (
              <div key={slot.hour} className="flex flex-col items-center min-w-[28px] flex-1">
                <div className="w-full flex flex-col justify-end h-16 gap-px">
                  {slot.unassigned > 0 && (
                    <div
                      className="w-full bg-red-400 dark:bg-red-600 rounded-t-sm min-h-[2px]"
                      style={{ height: `${(slot.unassigned / maxHourlyTotal) * 100}%` }}
                      title={`${slot.label}: ${slot.unassigned} не распределено`}
                    />
                  )}
                  {slot.assigned > 0 && (
                    <div
                      className="w-full bg-green-500 dark:bg-green-600 rounded-t-sm min-h-[2px]"
                      style={{ height: `${(slot.assigned / maxHourlyTotal) * 100}%` }}
                      title={`${slot.label}: ${slot.assigned} распределено`}
                    />
                  )}
                </div>
                <span className="text-[9px] text-gray-500 mt-1 rotate-0">{slot.label.slice(0, 2)}</span>
                {slot.total > 0 && (
                  <span className="text-[9px] font-mono text-gray-600 dark:text-gray-400">{slot.total}</span>
                )}
              </div>
            ))}
          </div>
          {statistics.peak_hours.length > 0 && (
            <p className="text-[10px] text-gray-500 mt-2">
              Пик:{" "}
              {statistics.peak_hours
                .map((h) => `${h.label} (${h.total})`)
                .join(", ")}
            </p>
          )}
        </div>
      )}

      {statistics.recommendations.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 border border-amber-200 dark:border-amber-800">
          <p className="text-xs font-medium text-amber-900 dark:text-amber-200 mb-2 flex items-center gap-1">
            <Lightbulb className="w-3 h-3" />
            Рекомендации
          </p>
          <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-300 list-disc list-inside">
            {statistics.recommendations.map((rec, idx) => (
              <li key={`${rec.type}-${idx}`}>{rec.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DriverRouteCard({
  route,
  expanded,
  onToggle,
  selected = false,
  onSelect,
}: {
  route: DailyRoute;
  expanded: boolean;
  onToggle: () => void;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const lunch = route.lunch;
  const lunchText = lunchLabel(lunch);
  const isRentalRoute = Boolean(route.is_rental || route.driver.is_rental);
  const isMinivanRoute =
    !isRentalRoute &&
    (Boolean(route.is_minivan) || route.orders.some(isMinivanGroupOrder));

  type TimelineItem =
    | { kind: "order"; order: DailyRouteOrder; sortKey: number; idx: number }
    | { kind: "lunch"; lunch: DriverLunchBreak; sortKey: number };

  const timeline: TimelineItem[] = route.orders.map((order, idx) => {
    const startIso = order.start_time;
    const plannedIso = order.planned_pickup_time || order.desired_pickup_time;
    const sortKey = startIso
      ? new Date(startIso).getTime()
      : plannedIso
        ? new Date(plannedIso).getTime()
        : idx;
    return { kind: "order", order, sortKey, idx };
  });
  if (lunch?.start_time) {
    timeline.push({
      kind: "lunch",
      lunch,
      sortKey: new Date(lunch.start_time).getTime(),
    });
  }
  timeline.sort((a, b) => a.sortKey - b.sortKey);

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm border transition-all ${
        selected
          ? "border-indigo-500 dark:border-indigo-400 ring-2 ring-indigo-200 dark:ring-indigo-800"
          : expanded
            ? "border-indigo-400 dark:border-indigo-500 ring-1 ring-indigo-200 dark:ring-indigo-800"
            : "border-gray-200 dark:border-gray-700"
      }`}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onSelect ?? onToggle}
          className="flex-1 p-3 flex items-center justify-between text-left min-w-0"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-semibold shrink-0">
              {route.driver.name[0]}
            </div>
            <div className="min-w-0">
              <p className="font-medium dark:text-white text-sm truncate flex items-center gap-1.5">
                {route.driver.name}
                {isRentalRoute && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-normal bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                    Аренда
                  </span>
                )}
                {isMinivanRoute && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-normal bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200">
                    Минивэн
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {route.driver.region ? `${route.driver.region} · ` : ""}
                {route.driver.car_model} · {route.total_orders} заказов
                {lunchText && (
                  <span className="ml-1.5 text-amber-700 dark:text-amber-300">
                    · Обед {lunchText}
                  </span>
                )}
              </p>
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="px-3 flex items-center border-l border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
          aria-label="Развернуть маршрут"
        >
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-3 space-y-2">
          {timeline.map((item) => {
            if (item.kind === "lunch") {
              const label = lunchLabel(item.lunch) ?? "—";
              const statusHint =
                item.lunch.status === "natural"
                  ? "естественный разрыв"
                  : item.lunch.status === "inserted"
                    ? "вставлен в маршрут"
                    : item.lunch.status;
              return (
                <div
                  key="lunch"
                  className="flex items-start gap-3 p-2 rounded-lg text-sm bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
                >
                  <div className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0">
                    <Coffee className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">
                      Обед {label}
                    </p>
                    <p className="text-[10px] text-amber-700/80 dark:text-amber-300/80">
                      {statusHint} · не менее 60 мин
                    </p>
                  </div>
                </div>
              );
            }

            const order = item.order;
            const startIso = order.start_time;
            const plannedIso = order.planned_pickup_time || order.desired_pickup_time;
            const requestedIso = order.desired_pickup_time;
            const timeShifted =
              order.has_pickup_time_adjustment ||
              (plannedIso &&
                requestedIso &&
                formatTime(plannedIso) !== formatTime(requestedIso));
            const originalIso = order.original_pickup_time || requestedIso;
            const tripIdx = orderTripIndex(order);
            const seqNum = timeline.indexOf(item) + 1;
            return (
              <div
                key={order.id}
                className="flex items-start gap-3 p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm"
              >
                <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {seqNum}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Clock className="w-3 h-3 text-gray-400" />
                    {startIso && (
                      <span className="text-xs font-medium dark:text-white" title="Выезд к подаче">
                        выезд {formatTime(startIso)}
                      </span>
                    )}
                    <span className="text-xs text-gray-600 dark:text-gray-300" title="Подача по плану">
                      {startIso ? "→ " : ""}подача {formatTime(plannedIso)}
                    </span>
                    {timeShifted && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400">
                        заявка {formatTime(originalIso)}
                        {order.pickup_time_offset_minutes != null &&
                          ` (${order.pickup_time_offset_minutes > 0 ? "+" : ""}${order.pickup_time_offset_minutes} мин)`}
                      </span>
                    )}
                    {tripIdx != null && (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200">
                        Рейс {tripIdx}
                        {(order.pickup_batch_size ?? 0) > 1
                          ? ` · ${order.pickup_batch_size} чел.`
                          : ""}
                      </span>
                    )}
                    {!tripIdx && (order.pickup_batch_size ?? 0) > 1 && (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
                        Групповая подача · {order.pickup_batch_size}
                      </span>
                    )}
                    {isMinivanGroupOrder(order) && tripIdx == null && (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200">
                        Минивэн
                      </span>
                    )}
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${statusColor(order.status)}`}>
                      {statusLabel(order.status)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-700 dark:text-gray-300 truncate">
                    <MapPin className="w-3 h-3 inline text-green-500 mr-1" />
                    {order.pickup_title}
                  </p>
                  <p className="text-xs text-gray-700 dark:text-gray-300 truncate">
                    <MapPin className="w-3 h-3 inline text-red-500 mr-1" />
                    {order.dropoff_title}
                  </p>
                  {order.score_breakdown && (
                    <DispatcherScorePanel breakdown={order.score_breakdown} total={order.score} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
