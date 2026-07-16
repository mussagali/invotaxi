import { useState, useEffect, useRef } from "react";
import {
  Loader2, RefreshCw, CheckCircle, Download,
} from "lucide-react";
import {
  dispatchApi,
  DailyRoutesResponse,
  DailyRoute,
} from "../services/dispatch";
import { DayRoutesPanel } from "./DayRoutesPanel";
import { toast } from "sonner";
import { loadYmaps } from "../../shared/yandex/loadYmaps";

/** Legacy standalone tab — основной UI в Dispatch.tsx */
export function DayPlanningTab() {
  const [data, setData] = useState<DailyRoutesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [expandedDriver, setExpandedDriver] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<ymaps.Map | null>(null);
  const [ymapsReady, setYmapsReady] = useState(false);
  const geoObjectsRef = useRef<any[]>([]);

  useEffect(() => {
    loadYmaps().then(() => setYmapsReady(true)).catch(console.error);
  }, []);

  const loadRoutes = async () => {
    setLoading(true);
    try {
      const result = await dispatchApi.getDailyRoutes(selectedDate);
      setData(result);
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Ошибка загрузки маршрутов");
    } finally {
      setLoading(false);
    }
  };

  const applyRoutes = async () => {
    setApplying(true);
    toast.info("Применение маршрутов запущено…");
    try {
      const result = await dispatchApi.applyDailyRoutes(selectedDate);
      setData(result);
      toast.success(`Назначено заказов: ${result.distributed_count}`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Ошибка применения маршрутов");
    } finally {
      setApplying(false);
    }
  };

  const exportRoutes = async () => {
    setIsExporting(true);
    try {
      const blob = await dispatchApi.exportDailyRoutes(selectedDate);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `daily_routes_${selectedDate}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Маршруты экспортированы");
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Ошибка экспорта маршрутов");
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    loadRoutes();
  }, [selectedDate]);

  useEffect(() => {
    if (!ymapsReady || !mapRef.current || !data) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.destroy();
      mapInstanceRef.current = null;
    }
    geoObjectsRef.current = [];

    const selectedRoute = expandedDriver !== null
      ? data.routes.find((r) => r.driver.id === expandedDriver)
      : null;

    const allOrders = selectedRoute
      ? selectedRoute.orders
      : data.routes.flatMap((r) => r.orders);

    if (allOrders.length === 0) return;

    const centerLat = allOrders.reduce((s, o) => s + o.pickup_lat, 0) / allOrders.length;
    const centerLon = allOrders.reduce((s, o) => s + o.pickup_lon, 0) / allOrders.length;

    mapInstanceRef.current = new ymaps.Map(mapRef.current, {
      center: [centerLat, centerLon],
      zoom: 12,
      controls: ["zoomControl"],
    });

    const colors = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

    const drawAll = async () => {
      if (selectedRoute) {
        await drawRoute(selectedRoute, colors[0]);
      } else {
        for (let i = 0; i < data.routes.length; i++) {
          await drawRoute(data.routes[i], colors[i % colors.length]);
        }
      }

      if (allOrders.length > 1 && mapInstanceRef.current) {
        const lats = allOrders.flatMap((o) => [o.pickup_lat, o.dropoff_lat]);
        const lons = allOrders.flatMap((o) => [o.pickup_lon, o.dropoff_lon]);
        mapInstanceRef.current.setBounds(
          [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]],
          { checkZoomRange: true, zoomMargin: 40 }
        );
      }
    };
    drawAll();
  }, [ymapsReady, data, expandedDriver]);

  const drawRoute = async (route: DailyRoute, color: string) => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    for (let idx = 0; idx < route.orders.length; idx++) {
      const order = route.orders[idx];

      const pickupPm = new ymaps.Placemark(
        [order.pickup_lat, order.pickup_lon],
        { iconCaption: `${idx + 1}. ${order.pickup_title}` },
        { preset: "islands#greenCircleDotIconWithCaption", iconCaptionMaxWidth: "200" }
      );
      map.geoObjects.add(pickupPm);
      geoObjectsRef.current.push(pickupPm);

      const line = new ymaps.Polyline(
        [[order.pickup_lat, order.pickup_lon], [order.dropoff_lat, order.dropoff_lon]],
        {},
        { strokeColor: color, strokeWidth: 4, opacity: 0.85 }
      );
      map.geoObjects.add(line);
      geoObjectsRef.current.push(line);
    }
  };

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.destroy();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          План на выбранную дату (legacy view)
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
          />
          <button onClick={loadRoutes} disabled={loading}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Рассчитать
          </button>
          {data && data.routes?.length > 0 && (
            <button onClick={exportRoutes} disabled={isExporting}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2">
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Экспорт ZIP
            </button>
          )}
          {data && data.distributed_count > 0 && !data.auto_assigned && (
            <button onClick={applyRoutes} disabled={applying}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Применить назначения
            </button>
          )}
        </div>
      </div>

      <DayRoutesPanel
        data={data}
        loading={loading}
        planDate={selectedDate}
        showExport
        onPlanChanged={() => void loadRoutes()}
      />

      {data && data.routes?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div ref={mapRef} style={{ height: "400px" }} className="w-full" />
        </div>
      )}
    </div>
  );
}
