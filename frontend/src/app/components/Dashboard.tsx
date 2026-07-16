import { useState, useEffect, useMemo, useCallback } from "react";
import { TrendingUp, Car, Users, DollarSign, Clock, Loader2, BarChart3, CalendarDays } from "lucide-react";
import { ordersApi } from "../services/orders";
import { driversApi } from "../services/drivers";
import { passengersApi } from "../services/passengers";
import { analyticsApi } from "../services/analytics";
import { dispatchApi, DashboardDistributionResponse } from "../services/dispatch";
import { getTomorrowDateInAtyrau } from "../utils/atyrauDate";
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
} from "recharts";

const COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"];

const statusColors: Record<string, string> = {
  pending: "#f59e0b",
  assigned: "#3b82f6",
  driver_en_route: "#3b82f6",
  ride_ongoing: "#3b82f6",
  completed: "#10b981",
  cancelled: "#ef4444",
};

export function Dashboard() {
  const [statsData, setStatsData] = useState({
    activeOrders: 0,
    onlineDrivers: 0,
    totalPassengers: 0,
    completedToday: 0,
  });
  const [loading, setLoading] = useState(true);
  const [recentOrdersData, setRecentOrdersData] = useState<any[]>([]);
  const [ordersData, setOrdersData] = useState<Array<{ name: string; заказы: number }>>([]);
  const [statusData, setStatusData] = useState<Array<{ name: string; value: number; color: string }>>([]);
  const [regionData, setRegionData] = useState<Array<{ region: string; заказы: number }>>([]);
  const [comparison, setComparison] = useState<any>(null);
  const [distributionDate, setDistributionDate] = useState(() => getTomorrowDateInAtyrau());
  const [distributionData, setDistributionData] = useState<DashboardDistributionResponse | null>(null);
  const [distributionLoading, setDistributionLoading] = useState(true);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);

  const loadDistribution = useCallback(async (date: string) => {
    try {
      setDistributionLoading(true);
      const data = await dispatchApi.getDashboardDistribution(date);
      setDistributionData(data);
    } catch (err) {
      console.error("Ошибка загрузки распределения:", err);
      setDistributionData(null);
    } finally {
      setDistributionLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDistribution(distributionDate);
    setSelectedHour(null);
  }, [distributionDate, loadDistribution]);

  useEffect(() => {
    const onOrdersGenerated = (event: Event) => {
      const detail = (event as CustomEvent<{ date?: string }>).detail;
      if (!detail?.date || detail.date === distributionDate) {
        void loadDistribution(distributionDate);
      }
    };
    window.addEventListener("invotaxi:orders-generated", onOrdersGenerated);
    return () => window.removeEventListener("invotaxi:orders-generated", onOrdersGenerated);
  }, [distributionDate, loadDistribution]);

  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        setLoading(true);
        
        // Загружаем данные за последние 7 дней
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - 7);
        from.setHours(0, 0, 0, 0);
        to.setHours(23, 59, 59, 999);

        const params = {
          date_from: from.toISOString(),
          date_to: to.toISOString(),
          granularity: 'day' as const,
        };

        const [orders, drivers, passengers, metrics, timeSeries, regionDistribution, comparisonData] = await Promise.all([
          ordersApi.getOrders(),
          driversApi.getDrivers(),
          passengersApi.getPassengers(),
          analyticsApi.getMetrics(params),
          analyticsApi.getTimeSeries(params),
          analyticsApi.getRegionDistribution(params),
          analyticsApi.getComparison(params),
        ]);

        const activeOrders = orders.filter(
          (o) => o.status === "assigned" || o.status === "driver_en_route" || o.status === "ride_ongoing"
        ).length;
        const onlineDrivers = drivers.filter((d) => d.is_online).length;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const completedToday = orders.filter(
          (o) => o.status === "completed" && new Date(o.completed_at || o.created_at) >= today
        ).length;

        setStatsData({
          activeOrders,
          onlineDrivers,
          totalPassengers: passengers.length,
          completedToday,
        });

        setRecentOrdersData(orders.slice(0, 4));

        // Формируем данные для графика заказов за неделю
        const weekDays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const ordersByDay = timeSeries.map((item) => {
          const date = new Date(item.period);
          return {
            name: weekDays[date.getDay()],
            заказы: item.total,
          };
        });
        setOrdersData(ordersByDay);

        // Формируем данные для графика статусов
        const statusChartData = metrics.status_distribution.map((item, index) => {
          const statusNames: Record<string, string> = {
            pending: "Ожидание",
            assigned: "Назначен",
            driver_en_route: "В пути",
            ride_ongoing: "В поездке",
            completed: "Выполнено",
            cancelled: "Отменено",
          };
          return {
            name: statusNames[item.status] || item.status,
            value: item.count,
            color: statusColors[item.status] || COLORS[index % COLORS.length],
          };
        });
        setStatusData(statusChartData);

        // Формируем данные для графика по регионам
        const regionChartData = regionDistribution.map((item) => ({
          region: item.region_title,
          заказы: item.orders_count,
        }));
        setRegionData(regionChartData);

        setComparison(comparisonData);
      } catch (err) {
        console.error("Ошибка загрузки данных дашборда:", err);
        // Устанавливаем пустые данные при ошибке, чтобы не ломать интерфейс
        setOrdersData([]);
        setStatusData([]);
        setRegionData([]);
      } finally {
        setLoading(false);
      }
    };
    loadDashboardData();
  }, []);

  const stats = useMemo(() => {
    const getChangePercent = (current: number, previous: number): string => {
      if (previous === 0) return current > 0 ? "+100%" : "0%";
      const change = ((current - previous) / previous) * 100;
      const sign = change >= 0 ? "+" : "";
      return `${sign}${change.toFixed(0)}%`;
    };

    return [
      {
        label: "Активные заказы",
        value: loading ? "..." : String(statsData.activeOrders),
        change: comparison ? getChangePercent(statsData.activeOrders, comparison.previous.orders) : "0%",
        icon: TrendingUp,
        color: "bg-blue-500",
      },
      {
        label: "Онлайн водители",
        value: loading ? "..." : String(statsData.onlineDrivers),
        change: "+0%", // Для водителей нет сравнения в comparison API
        icon: Car,
        color: "bg-green-500",
      },
      {
        label: "Всего пассажиров",
        value: loading ? "..." : String(statsData.totalPassengers),
        change: "+0%",
        icon: Users,
        color: "bg-purple-500",
      },
      {
        label: "Выполнено сегодня",
        value: loading ? "..." : String(statsData.completedToday),
        change: comparison ? getChangePercent(statsData.completedToday, comparison.previous.completed) : "0%",
        icon: Clock,
        color: "bg-orange-500",
      },
    ];
  }, [loading, statsData, comparison]);

  const hourlyChartData = useMemo(() => {
    if (!distributionData?.statistics?.hourly) return [];
    return distributionData.statistics.hourly
      .filter((h) => h.total > 0 || h.hour >= 6)
      .map((h) => ({
        hour: h.hour,
        label: h.label,
        распределено: h.assigned,
        неРаспределено: h.unassigned,
        всего: h.total,
      }));
  }, [distributionData]);

  const selectedHourOrders = useMemo(() => {
    if (selectedHour === null || !distributionData?.orders_by_hour) return [];
    return distributionData.orders_by_hour[String(selectedHour)] ?? [];
  }, [distributionData, selectedHour]);

  const handleHourChartClick = (state: { activePayload?: Array<{ payload?: { hour?: number } }> }) => {
    const hour = state?.activePayload?.[0]?.payload?.hour;
    if (hour === undefined) return;
    setSelectedHour((prev) => (prev === hour ? null : hour));
  };

  const formatPickupTime = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  };

  const orderStatusLabel = (status: string, assigned: boolean) => {
    if (!assigned) return "Не распределено";
    const m: Record<string, string> = {
      assigned: "Назначен",
      driver_en_route: "В пути",
      arrived_waiting: "Ожидание",
      ride_ongoing: "Поездка",
      completed: "Завершён",
      active_queue: "В очереди",
      submitted: "Новый",
      awaiting_dispatcher_decision: "Ожидает диспетчера",
    };
    return m[status] || status;
  };

  const shortageChartData = useMemo(() => {
    if (!distributionData?.statistics?.hourly) return [];
    return distributionData.statistics.hourly
      .filter((h) => h.unassigned > 0)
      .map((h) => ({
        label: h.label,
        nehvatka: h.unassigned,
      }));
  }, [distributionData]);

  const driverLoadChartData = useMemo(() => {
    if (!distributionData?.driver_load) return [];
    return distributionData.driver_load.map((d) => ({
      name: d.driver_name,
      заказы: d.orders_count,
    }));
  }, [distributionData]);

  const distributionSummary = distributionData?.summary;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl dark:text-white">Главная панель</h1>
        <p className="text-gray-600 dark:text-gray-400">Обзор системы в реальном времени</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-center justify-between mb-4">
                <div className={`${stat.color} w-12 h-12 rounded-lg flex items-center justify-center text-white`}>
                  <Icon className="w-6 h-6" />
                </div>
                <span className="text-green-600 dark:text-green-400 text-sm">{stat.change}</span>
              </div>
              <p className="text-gray-600 dark:text-gray-400 text-sm">{stat.label}</p>
              <p className="text-3xl dark:text-white mt-1">{stat.value}</p>
            </div>
          );
        })}
      </div>

      {/* Распределение на день */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl dark:text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-600" />
              Распределение на день
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Назначенные и ожидающие заказы по часам подачи
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-gray-500" />
            <input
              type="date"
              value={distributionDate}
              onChange={(e) => setDistributionDate(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white"
            />
          </div>
        </div>

        {distributionLoading ? (
          <div className="flex items-center justify-center py-16 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          </div>
        ) : !distributionData || distributionSummary?.total === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-8 border border-gray-200 dark:border-gray-700 text-center text-gray-500 dark:text-gray-400">
            <p>Нет заказов на {distributionDate}</p>
            <p className="text-sm mt-2">Сгенерируйте заказы в разделе «Заказы» или откройте Dispatch для оптимизации</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">Всего заказов</p>
                <p className="text-2xl font-semibold dark:text-white">{distributionSummary?.total ?? 0}</p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-green-200 dark:border-green-800">
                <p className="text-xs text-green-600 dark:text-green-400">Распределено</p>
                <p className="text-2xl font-semibold text-green-700 dark:text-green-300">
                  {distributionSummary?.assigned ?? 0}
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-red-200 dark:border-red-800">
                <p className="text-xs text-red-600 dark:text-red-400">Не распределено</p>
                <p className="text-2xl font-semibold text-red-700 dark:text-red-300">
                  {distributionSummary?.unassigned ?? 0}
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-amber-200 dark:border-amber-800">
                <p className="text-xs text-amber-700 dark:text-amber-400">Нужно +водителей</p>
                <p className="text-2xl font-semibold text-amber-800 dark:text-amber-300">
                  ~{distributionSummary?.recommended_extra_drivers ?? 0}
                </p>
                <p className="text-[10px] text-gray-500 mt-1">
                  загружено {distributionSummary?.drivers_active ?? 0} / {distributionSummary?.drivers_total ?? 0}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
                <h3 className="text-lg dark:text-white mb-1">Заказы по часам</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                  Зелёный — с водителем, красный — без. Нажмите на столбец для таблицы заказов.
                </p>
                {hourlyChartData.length === 0 ? (
                  <div className="flex items-center justify-center h-[280px] text-gray-500">Нет данных</div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart
                      data={hourlyChartData}
                      onClick={handleHourChartClick}
                      style={{ cursor: "pointer" }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar
                        dataKey="распределено"
                        stackId="a"
                        fill="#10b981"
                        name="Распределено"
                        opacity={selectedHour === null ? 1 : 0.45}
                      />
                      <Bar
                        dataKey="неРаспределено"
                        stackId="a"
                        fill="#ef4444"
                        name="Не распределено"
                        opacity={selectedHour === null ? 1 : 0.45}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {selectedHour !== null && (
                  <div className="mt-4 border border-indigo-200 dark:border-indigo-800 rounded-lg overflow-hidden">
                    <div className="bg-indigo-50 dark:bg-indigo-900/30 px-4 py-2 flex items-center justify-between">
                      <h4 className="text-sm font-medium text-indigo-900 dark:text-indigo-200">
                        Заказы в {String(selectedHour).padStart(2, "0")}:00 ({selectedHourOrders.length})
                      </h4>
                      <button
                        type="button"
                        onClick={() => setSelectedHour(null)}
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        Скрыть
                      </button>
                    </div>
                    <div className="overflow-x-auto max-h-72 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
                          <tr>
                            <th className="text-left p-2 font-medium">Время</th>
                            <th className="text-left p-2 font-medium">Заказ</th>
                            <th className="text-left p-2 font-medium">Маршрут</th>
                            <th className="text-left p-2 font-medium">Водитель</th>
                            <th className="text-left p-2 font-medium">Регион</th>
                            <th className="text-left p-2 font-medium">Статус</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedHourOrders.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="p-4 text-center text-gray-500">
                                Нет заказов в этом часе
                              </td>
                            </tr>
                          ) : (
                            selectedHourOrders.map((order) => (
                              <tr
                                key={order.id}
                                className={
                                  order.assigned
                                    ? "border-t border-gray-100 dark:border-gray-700"
                                    : "border-t border-red-100 dark:border-red-900/40 bg-red-50/50 dark:bg-red-900/10"
                                }
                              >
                                <td className="p-2 whitespace-nowrap">{formatPickupTime(order.pickup_time)}</td>
                                <td className="p-2 font-mono">{order.id}</td>
                                <td className="p-2 max-w-[200px] truncate" title={`${order.pickup_title} → ${order.dropoff_title}`}>
                                  {order.pickup_title} → {order.dropoff_title}
                                </td>
                                <td className="p-2">{order.driver_name ?? "—"}</td>
                                <td className="p-2">{order.driver_region ?? "—"}</td>
                                <td className="p-2">{orderStatusLabel(order.status, order.assigned)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {distributionData.statistics.peak_hours.length > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Пик:{" "}
                    {distributionData.statistics.peak_hours
                      .map((h) => `${h.label} (${h.total})`)
                      .join(", ")}
                  </p>
                )}
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
                <h3 className="text-lg dark:text-white mb-1">Нехватка по часам</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Часы, где заказы без водителя</p>
                {shortageChartData.length === 0 ? (
                  <div className="flex items-center justify-center h-[280px] text-green-600 dark:text-green-400">
                    Все заказы распределены
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={shortageChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="nehvatka" fill="#f59e0b" name="Не распределено" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {distributionData.statistics.peak_unassigned_hours.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                    Больше всего проблем:{" "}
                    {distributionData.statistics.peak_unassigned_hours
                      .map((h) => `${h.label} (${h.unassigned})`)
                      .join(", ")}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
                <h3 className="text-lg dark:text-white mb-4">Нагрузка на водителей (топ-10)</h3>
                {driverLoadChartData.length === 0 ? (
                  <div className="flex items-center justify-center h-[280px] text-gray-500">Нет назначений</div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={driverLoadChartData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="заказы" fill="#6366f1" name="Заказов" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {distributionData.statistics.recommendations.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-6 border border-amber-200 dark:border-amber-800">
                  <h3 className="text-lg text-amber-900 dark:text-amber-200 mb-3">Рекомендации</h3>
                  <ul className="space-y-2 text-sm text-amber-800 dark:text-amber-300 list-disc list-inside">
                    {distributionData.statistics.recommendations.slice(0, 5).map((rec, idx) => (
                      <li key={`${rec.type}-${idx}`}>{rec.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Orders Chart */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl dark:text-white mb-4">Заказы за неделю</h2>
          {loading ? (
            <div className="flex items-center justify-center h-[300px]">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
          ) : ordersData.length === 0 ? (
            <div className="flex items-center justify-center h-[300px] text-gray-500 dark:text-gray-400">
              Нет данных
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={ordersData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="заказы"
                  stroke="#3b82f6"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Status Chart */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl dark:text-white mb-4">Распределение по статусам</h2>
          {loading ? (
            <div className="flex items-center justify-center h-[300px]">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
          ) : statusData.length === 0 ? (
            <div className="flex items-center justify-center h-[300px] text-gray-500 dark:text-gray-400">
              Нет данных
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) =>
                    `${name} ${(percent * 100).toFixed(0)}%`
                  }
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Region Stats */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl dark:text-white mb-4">Статистика по регионам</h2>
          {loading ? (
            <div className="flex items-center justify-center h-[300px]">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
          ) : regionData.length === 0 ? (
            <div className="flex items-center justify-center h-[300px] text-gray-500 dark:text-gray-400">
              Нет данных
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={regionData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="region" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="заказы" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Recent Orders */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl dark:text-white mb-4">Последние заказы</h2>
          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
          ) : (
          <div className="space-y-4">
              {recentOrdersData.length === 0 ? (
                <p className="text-center text-gray-500 dark:text-gray-400 py-8">Нет заказов</p>
              ) : (
                recentOrdersData.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3 last:border-0 last:pb-0"
              >
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{order.id}</p>
                      <p className="mt-1 dark:text-white">{order.passenger.full_name}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Водитель: {order.driver?.name || "Не назначен"}
                      </p>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-block px-3 py-1 rounded-full text-xs ${
                          order.status === "completed"
                        ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                            : order.status === "driver_en_route" || order.status === "ride_ongoing"
                        ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                        : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                    }`}
                  >
                    {order.status === "pending" ? "Ожидание" :
                     order.status === "assigned" ? "Назначен" :
                     order.status === "driver_en_route" ? "В пути" :
                     order.status === "ride_ongoing" ? "В поездке" :
                     order.status === "completed" ? "Выполнено" :
                     order.status === "cancelled" ? "Отменено" : order.status}
                  </span>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {new Date(order.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                </div>
              </div>
                ))
              )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}