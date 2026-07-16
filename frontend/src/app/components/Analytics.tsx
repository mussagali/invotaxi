import { useState, useEffect, useMemo, useCallback } from "react";
import { Download, TrendingUp, Calendar, Loader2 } from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { analyticsApi, Metrics, TimeSeriesData, RegionDistribution, PeakHours, DriverPerformance, ComparisonMetrics } from "../services/analytics";
import { dispatchApi, DriverWorkloadRow } from "../services/dispatch";
import { DateRangePicker, DateRange } from "./DateRangePicker";
import { regionsApi, Region } from "../services/regions";
import {
  formatAtyrauDate,
  getDayRange,
  getTodayDateInAtyrau,
  getWeekRange,
} from "../utils/atyrauDate";

const COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"];

type ReportPeriod = "day" | "week" | "range";

function formatDisplayDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  return `${day}.${month}.${year}`;
}

function rangeForPeriod(period: ReportPeriod, anchorDate: string): DateRange {
  if (period === "day") {
    return getDayRange(anchorDate);
  }
  if (period === "week") {
    return getWeekRange(anchorDate);
  }
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

export function Analytics() {
  const [loading, setLoading] = useState(true);
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("day");
  const [anchorDate, setAnchorDate] = useState(() => getTodayDateInAtyrau());
  const [driverExportLoading, setDriverExportLoading] = useState(false);
  const [driverWorkloadLoading, setDriverWorkloadLoading] = useState(false);
  const [driverWorkloadRows, setDriverWorkloadRows] = useState<DriverWorkloadRow[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>(() => rangeForPeriod("day", getTodayDateInAtyrau()));

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [timeSeriesData, setTimeSeriesData] = useState<TimeSeriesData[]>([]);
  const [regionDistribution, setRegionDistribution] = useState<RegionDistribution[]>([]);
  const [peakHours, setPeakHours] = useState<PeakHours[]>([]);
  const [driverPerformance, setDriverPerformance] = useState<DriverPerformance[]>([]);
  const [comparison, setComparison] = useState<ComparisonMetrics | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadRegions = async () => {
      try {
        const regionsData = await regionsApi.getRegions();
        setRegions(regionsData);
      } catch (err) {
        console.error("Ошибка загрузки регионов:", err);
      }
    };
    loadRegions();
  }, []);

  const loadAnalyticsData = async () => {
    try {
      setLoading(true);
      setError(null);
      const params = {
        date_from: dateRange.from?.toISOString(),
        date_to: dateRange.to?.toISOString(),
        granularity: "day" as const,
        region_id: selectedRegionId || undefined,
      };

      const [
        metricsData,
        timeSeries,
        regionsData,
        peakHoursData,
        drivers,
        comparisonData,
      ] = await Promise.all([
        analyticsApi.getMetrics(params),
        analyticsApi.getTimeSeries(params),
        analyticsApi.getRegionDistribution(params),
        analyticsApi.getPeakHours(params),
        analyticsApi.getDriverPerformance({ ...params, limit: 5 }),
        analyticsApi.getComparison(params),
      ]);

      setMetrics(metricsData);
      setTimeSeriesData(timeSeries);
      setRegionDistribution(regionsData);
      setPeakHours(peakHoursData);
      setDriverPerformance(drivers);
      setComparison(comparisonData);
    } catch (err: any) {
      console.error("Ошибка загрузки аналитики:", err);
      setError(err.message || "Ошибка при загрузке данных");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalyticsData();
  }, [dateRange, selectedRegionId]);

  const applyReportPeriod = useCallback((period: ReportPeriod, anchor: string) => {
    setReportPeriod(period);
    setAnchorDate(anchor);
    if (period !== "range") {
      setDateRange(rangeForPeriod(period, anchor));
    }
  }, []);

  const handleAnchorDateChange = (value: string) => {
    setAnchorDate(value);
    if (reportPeriod !== "range") {
      setDateRange(rangeForPeriod(reportPeriod, value));
    }
  };

  const buildDriverReportParams = useCallback(() => {
    const exportDate =
      reportPeriod === "range"
        ? formatAtyrauDate(dateRange.to ?? dateRange.from ?? new Date())
        : anchorDate;
    return {
      period: reportPeriod,
      date: exportDate,
      ...(reportPeriod === "range" && dateRange.from && dateRange.to
        ? {
            date_from: formatAtyrauDate(dateRange.from),
            date_to: formatAtyrauDate(dateRange.to),
          }
        : {}),
    };
  }, [reportPeriod, anchorDate, dateRange]);

  const loadDriverWorkloadReport = useCallback(async () => {
    try {
      setDriverWorkloadLoading(true);
      const data = await dispatchApi.getDriverWorkloadReport(buildDriverReportParams());
      setDriverWorkloadRows(data.rows);
    } catch (err) {
      console.error("Ошибка загрузки отчёта по водителям:", err);
      setDriverWorkloadRows([]);
    } finally {
      setDriverWorkloadLoading(false);
    }
  }, [buildDriverReportParams]);

  useEffect(() => {
    void loadDriverWorkloadReport();
  }, [loadDriverWorkloadReport]);

  const handleExport = async (type: "orders" | "financial" | "drivers") => {
    try {
      const params = {
        date_from: dateRange.from?.toISOString(),
        date_to: dateRange.to?.toISOString(),
      };

      const blob = await analyticsApi.exportReport(type, params);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}_report_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Ошибка экспорта:", err);
      alert("Ошибка при экспорте отчета");
    }
  };

  const handleDriverWorkloadExport = async () => {
    try {
      setDriverExportLoading(true);
      const blob = await dispatchApi.exportDriverWorkloadReport(buildDriverReportParams());

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const suffix =
        reportPeriod === "range" && dateRange.from && dateRange.to
          ? `${formatAtyrauDate(dateRange.from)}_${formatAtyrauDate(dateRange.to)}`
          : buildDriverReportParams().date;
      a.download = `driver_workload_${reportPeriod}_${suffix}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Ошибка экспорта отчёта по водителям:", err);
      alert("Ошибка при экспорте отчёта");
    } finally {
      setDriverExportLoading(false);
    }
  };

  // Форматирование данных для графиков
  const monthlyData = useMemo(() => {
    return timeSeriesData.map((item) => ({
      month: new Date(item.period).toLocaleDateString("ru-RU", { month: "short", day: "numeric" }),
      заказы: item.total,
      выполнено: item.completed,
      отменено: item.cancelled,
    }));
  }, [timeSeriesData]);

  const statusData = useMemo(() => {
    if (!metrics?.status_distribution) return [];
    return metrics.status_distribution.map((item, index) => ({
      name: item.status,
      value: item.count,
      color: COLORS[index % COLORS.length],
    }));
  }, [metrics]);

  const regionChartData = useMemo(() => {
    return regionDistribution.map((item, index) => ({
      name: item.region_title,
      value: item.orders_count,
      color: COLORS[index % COLORS.length],
    }));
  }, [regionDistribution]);

  const driverChartData = useMemo(() => {
    return driverPerformance.map((item) => ({
      name: item.driver_name,
      заказы: item.orders,
      рейтинг: item.rating,
    }));
  }, [driverPerformance]);

  const peakHoursData = useMemo(() => {
    return peakHours.map((item) => ({
      hour: item.hour,
      заказы: item.orders,
    }));
  }, [peakHours]);

  // Расчет изменений (упрощенный - сравниваем с предыдущим периодом)
  const getChangePercent = (current: number, previous: number): string => {
    if (previous === 0) return current > 0 ? "+100%" : "0%";
    const change = ((current - previous) / previous) * 100;
    const sign = change >= 0 ? "+" : "";
    return `${sign}${change.toFixed(1)}%`;
  };

  if (loading && !metrics) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl text-gray-900 dark:text-white">Аналитика и отчеты</h1>
          <p className="text-gray-600 dark:text-gray-400">Статистика и анализ работы системы</p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            Дневной отчёт по водителям: назначенные и выполненные заказы с водителем; км — маршрут с пассажиром; время — оценка длительности рейса.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
            {(
              [
                ["day", "День"],
                ["week", "Неделя"],
                ["range", "Диапазон"],
              ] as const
            ).map(([period, label]) => (
              <button
                key={period}
                type="button"
                onClick={() => applyReportPeriod(period, anchorDate)}
                className={`px-3 py-2 transition-colors ${
                  reportPeriod === period
                    ? "bg-indigo-600 text-white"
                    : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                } ${period !== "day" ? "border-l border-gray-300 dark:border-gray-600" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>
          {reportPeriod === "range" ? (
            <DateRangePicker value={dateRange} onChange={setDateRange} />
          ) : (
            <input
              type="date"
              value={anchorDate}
              onChange={(e) => handleAnchorDateChange(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white"
            />
          )}
          <select
            value={selectedRegionId || ""}
            onChange={(e) => setSelectedRegionId(e.target.value || null)}
            className="bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600"
          >
            <option value="">Все регионы</option>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.title}
              </option>
            ))}
          </select>
          <div className="relative group">
            <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700">
              <Download className="w-5 h-5" />
              Экспорт
            </button>
            <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 min-w-[150px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
              <div className="py-1">
                <button
                  onClick={() => handleExport("orders")}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Заказы
                </button>
                <button
                  onClick={() => handleExport("financial")}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Финансы
                </button>
                <button
                  onClick={() => handleExport("drivers")}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Водители (сводка)
                </button>
                <button
                  onClick={() => void handleDriverWorkloadExport()}
                  disabled={driverExportLoading}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  {driverExportLoading
                    ? "Формирование..."
                    : reportPeriod === "day"
                      ? "Дневной отчёт (XLSX)"
                      : "Отчёт по водителям"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <p className="text-gray-600 dark:text-gray-400 text-sm">Всего заказов</p>
            <TrendingUp className="w-5 h-5 text-green-600" />
          </div>
          <p className="text-3xl mt-2 text-gray-900 dark:text-white">
            {loading ? "..." : metrics?.total_orders || 0}
          </p>
          <p className="text-sm text-green-600 mt-2">
            {comparison?.changes.orders ? (
              <span className={comparison.changes.orders >= 0 ? "text-green-600" : "text-red-600"}>
                {comparison.changes.orders >= 0 ? "+" : ""}{comparison.changes.orders}% к прошлому периоду
              </span>
            ) : (
              metrics?.success_rate ? `${metrics.success_rate.toFixed(1)}% успешности` : "—"
            )}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <p className="text-gray-600 dark:text-gray-400 text-sm">Выполнено</p>
            <TrendingUp className="w-5 h-5 text-green-600" />
          </div>
          <p className="text-3xl mt-2 text-gray-900 dark:text-white">
            {loading ? "..." : metrics?.completed_orders || 0}
          </p>
          <p className="text-sm text-green-600 mt-2">
            {comparison?.changes.completed ? (
              <span className={comparison.changes.completed >= 0 ? "text-green-600" : "text-red-600"}>
                {comparison.changes.completed >= 0 ? "+" : ""}{comparison.changes.completed}% к прошлому периоду
              </span>
            ) : (
              metrics?.success_rate ? `${metrics.success_rate.toFixed(1)}% успешности` : "—"
            )}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <p className="text-gray-600 dark:text-gray-400 text-sm">Среднее время</p>
            <TrendingUp className="w-5 h-5 text-blue-600" />
          </div>
          <p className="text-3xl mt-2 text-gray-900 dark:text-white">
            {loading ? "..." : metrics?.avg_duration_minutes ? `${Math.round(metrics.avg_duration_minutes)} мин` : "—"}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">Средняя длительность</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <p className="text-gray-600 dark:text-gray-400 text-sm">Выручка</p>
            <TrendingUp className="w-5 h-5 text-green-600" />
          </div>
          <p className="text-3xl mt-2 text-gray-900 dark:text-white">
            {loading ? "..." : metrics?.total_revenue ? `₸${(metrics.total_revenue / 1000000).toFixed(1)}M` : "₸0"}
          </p>
          <p className="text-sm text-green-600 mt-2">
            {comparison?.changes.revenue ? (
              <span className={comparison.changes.revenue >= 0 ? "text-green-600" : "text-red-600"}>
                {comparison.changes.revenue >= 0 ? "+" : ""}{comparison.changes.revenue}% к прошлому периоду
              </span>
            ) : (
              metrics?.avg_order_value ? `Средний чек: ₸${Math.round(metrics.avg_order_value)}` : "—"
            )}
          </p>
        </div>
      </div>

      {/* Additional Metrics */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <p className="text-gray-600 dark:text-gray-400 text-sm">Среднее расстояние</p>
            </div>
            <p className="text-2xl mt-2 text-gray-900 dark:text-white">
              {metrics.avg_distance_km ? `${metrics.avg_distance_km.toFixed(1)} км` : "—"}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <p className="text-gray-600 dark:text-gray-400 text-sm">Время назначения</p>
            </div>
            <p className="text-2xl mt-2 text-gray-900 dark:text-white">
              {metrics.avg_assignment_time_minutes ? `${Math.round(metrics.avg_assignment_time_minutes)} мин` : "—"}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <p className="text-gray-600 dark:text-gray-400 text-sm">Заказы с surge</p>
            </div>
            <p className="text-2xl mt-2 text-gray-900 dark:text-white">
              {metrics.orders_with_surge || 0}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
              Средний множитель: {metrics.avg_surge_multiplier ? metrics.avg_surge_multiplier.toFixed(2) : '0.00'}x
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <p className="text-gray-600 dark:text-gray-400 text-sm">Активные водители</p>
            </div>
            <p className="text-2xl mt-2 text-gray-900 dark:text-white">
              {metrics.active_drivers || 0}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
              Онлайн: {metrics.online_drivers || 0}
            </p>
          </div>
        </div>
      )}

      {/* Monthly Trend */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-xl mb-4 text-gray-900 dark:text-white">Динамика заказов по периодам</h2>
        {loading ? (
          <div className="flex items-center justify-center h-[350px]">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          </div>
        ) : monthlyData.length > 0 ? (
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={monthlyData}>
              <defs>
                <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Area
                type="monotone"
                dataKey="заказы"
                stroke="#3b82f6"
                fillOpacity={1}
                fill="url(#colorOrders)"
              />
              <Line type="monotone" dataKey="выполнено" stroke="#10b981" strokeWidth={2} />
              <Line type="monotone" dataKey="отменено" stroke="#ef4444" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[350px] text-gray-500 dark:text-gray-400">
            Нет данных за выбранный период
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Driver Performance */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl mb-4 text-gray-900 dark:text-white">Топ водители</h2>
          {loading ? (
            <div className="flex items-center justify-center h-[300px]">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
          ) : driverChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={driverChartData} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={80} />
                <Tooltip />
                <Bar dataKey="заказы" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-gray-500 dark:text-gray-400">
              Нет данных
            </div>
          )}
        </div>

        {/* Region Distribution */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl mb-4 text-gray-900 dark:text-white">Распределение по регионам</h2>
          {loading ? (
            <div className="flex items-center justify-center h-[300px]">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
          ) : regionChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={regionChartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) =>
                    `${name} ${(percent * 100).toFixed(0)}%`
                  }
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {regionChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-gray-500 dark:text-gray-400">
              Нет данных
            </div>
          )}
        </div>
      </div>

      {/* Peak Hours */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-xl mb-4 text-gray-900 dark:text-white">Пиковые часы загруженности</h2>
        {loading ? (
          <div className="flex items-center justify-center h-[300px]">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          </div>
        ) : peakHoursData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={peakHoursData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="заказы"
                stroke="#f59e0b"
                strokeWidth={3}
                dot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[300px] text-gray-500 dark:text-gray-400">
            Нет данных
          </div>
        )}
      </div>

      {/* Дневной отчёт по водителям */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl text-gray-900 dark:text-white">
              {reportPeriod === "day" ? "Дневной отчёт по водителям" : "Отчёт по водителям"}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {reportPeriod === "day"
                ? `Дата: ${formatDisplayDate(anchorDate)} (${driverWorkloadRows.length} чел.)`
                : `По каждому водителю за выбранный период (${driverWorkloadRows.length} чел.)`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleDriverWorkloadExport()}
            disabled={driverExportLoading || driverWorkloadRows.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {driverExportLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {reportPeriod === "day" ? "Скачать дневной отчёт (XLSX)" : "Скачать XLSX"}
          </button>
        </div>
        {driverWorkloadLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          </div>
        ) : driverWorkloadRows.length === 0 ? (
          <div className="py-12 text-center text-gray-500 dark:text-gray-400">
            За выбранный период нет назначенных или выполненных заказов с водителем
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/80 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium whitespace-nowrap">ФИО Водитель</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Количество заказов</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Нагруженность за рейс в среднем</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Часов за день</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Минут за день</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Часов за неделю</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Минут за неделю</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Среднее количество заказов</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Км за неделю</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Км за день</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {driverWorkloadRows.map((row) => (
                  <tr key={row.driver_name} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-3 py-2 whitespace-nowrap">{row.driver_name}</td>
                    <td className="px-3 py-2 text-right">{row.orders_count}</td>
                    <td className="px-3 py-2 text-right">{row.avg_load_per_trip}</td>
                    <td className="px-3 py-2 text-right">{row.hours_day}</td>
                    <td className="px-3 py-2 text-right">{row.minutes_day}</td>
                    <td className="px-3 py-2 text-right">{row.hours_week}</td>
                    <td className="px-3 py-2 text-right">{row.minutes_week}</td>
                    <td className="px-3 py-2 text-right">{row.avg_orders}</td>
                    <td className="px-3 py-2 text-right">{row.km_week}</td>
                    <td className="px-3 py-2 text-right">{row.km_day}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Summary Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-xl mb-4 text-gray-900 dark:text-white">Сводная таблица</h2>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          </div>
        ) : metrics ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                <tr>
                  <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Метрика
                  </th>
                  <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Значение
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                <tr>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">Всего заказов</td>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">{metrics.total_orders}</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">Выполнено</td>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">{metrics.completed_orders}</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">Отменено</td>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">{metrics.cancelled_orders}</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">Процент успешности</td>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">{metrics.success_rate ? metrics.success_rate.toFixed(1) : '0.0'}%</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">Выручка (₸)</td>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">
                    {metrics.total_revenue ? Math.round(metrics.total_revenue).toLocaleString("ru-RU") : '0'}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">Средний чек (₸)</td>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">
                    {metrics.avg_order_value ? Math.round(metrics.avg_order_value).toLocaleString("ru-RU") : '0'}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">Онлайн водители</td>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">{metrics.online_drivers || 0}</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">Активные водители</td>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">{metrics.active_drivers || 0}</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">Средний рейтинг</td>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">{metrics.avg_rating ? metrics.avg_rating.toFixed(2) : '0.00'}</td>
                </tr>
                {metrics.avg_distance_km && (
                  <tr>
                    <td className="px-6 py-4 text-gray-900 dark:text-gray-100">Среднее расстояние</td>
                    <td className="px-6 py-4 text-gray-900 dark:text-gray-100">{metrics.avg_distance_km.toFixed(1)} км</td>
                  </tr>
                )}
                {metrics.avg_assignment_time_minutes && (
                  <tr>
                    <td className="px-6 py-4 text-gray-900 dark:text-gray-100">Среднее время назначения</td>
                    <td className="px-6 py-4 text-gray-900 dark:text-gray-100">{Math.round(metrics.avg_assignment_time_minutes)} мин</td>
                  </tr>
                )}
                <tr>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">Заказы с surge pricing</td>
                  <td className="px-6 py-4 text-gray-900 dark:text-gray-100">
                    {metrics.orders_with_surge} (средний множитель: {metrics.avg_surge_multiplier ? metrics.avg_surge_multiplier.toFixed(2) : '0.00'}x)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center text-gray-500 dark:text-gray-400 py-8">Нет данных</div>
        )}
      </div>

      {/* Driver Performance Table */}
      {driverPerformance.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl mb-4 text-gray-900 dark:text-white">Детальная статистика водителей</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                <tr>
                  <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Водитель
                  </th>
                  <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Рейтинг
                  </th>
                  <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Заказов
                  </th>
                  <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Выручка
                  </th>
                  <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Офферов
                  </th>
                  <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Принято
                  </th>
                  <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Отклонено
                  </th>
                  <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Acceptance Rate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {driverPerformance.map((driver) => (
                  <tr key={driver.driver_id}>
                    <td className="px-6 py-4 text-gray-900 dark:text-gray-100">{driver.driver_name}</td>
                    <td className="px-6 py-4 text-gray-900 dark:text-gray-100">{driver.rating.toFixed(2)}</td>
                    <td className="px-6 py-4 text-gray-900 dark:text-gray-100">{driver.orders}</td>
                    <td className="px-6 py-4 text-gray-900 dark:text-gray-100">
                      ₸{Math.round(driver.revenue).toLocaleString("ru-RU")}
                    </td>
                    <td className="px-6 py-4 text-gray-900 dark:text-gray-100">{driver.total_offers}</td>
                    <td className="px-6 py-4 text-green-600 dark:text-green-400">{driver.accepted_offers}</td>
                    <td className="px-6 py-4 text-red-600 dark:text-red-400">{driver.declined_offers}</td>
                    <td className="px-6 py-4 text-gray-900 dark:text-gray-100">
                      <span className={driver.acceptance_rate >= 50 ? "text-green-600" : "text-yellow-600"}>
                        {driver.acceptance_rate.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
