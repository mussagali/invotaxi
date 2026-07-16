import { useState, useEffect, useRef } from "react";
import { MapPin, Users, Navigation, Filter, Car, Loader2, Wifi, WifiOff, AlertCircle } from "lucide-react";
import { dispatchApi, DriverMarker, OrderMarker } from "../services/dispatch";
import { getDispatchMapWebSocket, testWebSocketConnection } from "../services/websocket";
import { regionsApi, City } from "../services/regions";
import { loadYmaps } from "../../shared/yandex/loadYmaps";

export function Map() {
  const [drivers, setDrivers] = useState<DriverMarker[]>([]);
  const [orders, setOrders] = useState<OrderMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [cities, setCities] = useState<City[]>([]);
  const [selectedCityId, setSelectedCityId] = useState<string>("all");
  const [showOnlineOnly, setShowOnlineOnly] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<DriverMarker | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderMarker | null>(null);
  const [wsStatus, setWsStatus] = useState<'connected' | 'connecting' | 'disconnected' | 'error'>('disconnected');
  const [wsReconnectAttempts, setWsReconnectAttempts] = useState(0);
  const wsRef = useRef<ReturnType<typeof getDispatchMapWebSocket> | null>(null);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<ymaps.Map | null>(null);
  const driverMarkersRef = useRef<Map<string, ymaps.Placemark>>(new window.Map());
  const orderMarkersRef = useRef<Map<string, ymaps.Placemark>>(new window.Map());
  const [ymapsReady, setYmapsReady] = useState(false);

  useEffect(() => { loadYmaps().then(() => setYmapsReady(true)).catch(console.error); }, []);

  useEffect(() => {
    const loadCities = async () => {
      try {
        const citiesData = await regionsApi.getCities();
        setCities(citiesData);
        if (citiesData.length > 0 && selectedCityId === "all") setSelectedCityId(citiesData[0].id);
      } catch (error) { console.error("Error loading cities:", error); }
    };
    loadCities();
  }, []);

  const selectedCity = cities.find(c => c.id === selectedCityId);
  const center: [number, number] = selectedCity ? [selectedCity.center_lat, selectedCity.center_lon] : [47.1067, 51.9167];

  useEffect(() => {
    const loadMapData = async () => {
      try {
        setLoading(true);
        const data = await dispatchApi.getMapData();
        setDrivers(data.drivers);
        setOrders(data.orders);
      } catch (error) { console.error("Error loading map data:", error); }
      finally { setLoading(false); }
    };
    loadMapData();
  }, []);

  useEffect(() => {
    const testConnection = async () => {
      const testResult = await testWebSocketConnection();
      if (testResult) console.log('[Map] WebSocket test OK');
      else console.error('[Map] WebSocket test failed');
    };
    setTimeout(testConnection, 1000);
  }, []);

  useEffect(() => {
    const ws = getDispatchMapWebSocket();
    wsRef.current = ws;
    const updateStatus = () => { setWsStatus(ws.getConnectionStatus()); setWsReconnectAttempts(ws.getReconnectAttempts()); };
    const statusInterval = setInterval(updateStatus, 1000);
    updateStatus();

    ws.on("driver_location_update", (data: any) => {
      setDrivers((prev) => {
        const index = prev.findIndex((d) => d.id === data.driver_id);
        if (index !== -1) { const updated = [...prev]; updated[index] = { ...updated[index], lat: data.lat, lon: data.lon }; return updated; }
        return [...prev, { id: data.driver_id, name: data.name || "", lat: data.lat, lon: data.lon, is_online: data.is_online ?? true, car_model: data.car_model || "", plate_number: "" }];
      });
    });
    ws.on("driver_status_update", (data: any) => {
      setDrivers((prev) => { const index = prev.findIndex((d) => d.id === data.driver_id); if (index !== -1) { const updated = [...prev]; updated[index] = { ...updated[index], is_online: data.is_online }; return updated; } return prev; });
    });
    ws.on("order_update", (data: any) => {
      setOrders((prev) => {
        const index = prev.findIndex((o) => o.id === data.id);
        if (index !== -1) { const updated = [...prev]; updated[index] = { ...updated[index], status: data.status, driver_id: data.driver?.id ? String(data.driver.id) : null }; return updated; }
        const activeStatuses = ['submitted', 'awaiting_dispatcher_decision', 'active_queue', 'assigned', 'driver_en_route', 'arrived_waiting', 'ride_ongoing'];
        if (activeStatuses.includes(data.status)) {
          return [...prev, { id: data.id, pickup_lat: data.pickup_lat, pickup_lon: data.pickup_lon, dropoff_lat: data.dropoff_lat, dropoff_lon: data.dropoff_lon, pickup_title: data.pickup_title, dropoff_title: data.dropoff_title, status: data.status, driver_id: data.driver?.id ? String(data.driver.id) : null, passenger: data.passenger ? { id: String(data.passenger.id), full_name: data.passenger.full_name } : null, created_at: data.created_at }];
        }
        return prev;
      });
    });
    ws.on("order_created", (data: any) => {
      const activeStatuses = ['submitted', 'awaiting_dispatcher_decision', 'active_queue', 'assigned', 'driver_en_route', 'arrived_waiting', 'ride_ongoing'];
      if (activeStatuses.includes(data.status)) {
        setOrders((prev) => [...prev, { id: data.id, pickup_lat: data.pickup_lat, pickup_lon: data.pickup_lon, dropoff_lat: data.dropoff_lat, dropoff_lon: data.dropoff_lon, pickup_title: data.pickup_title, dropoff_title: data.dropoff_title, status: data.status, driver_id: data.driver?.id ? String(data.driver.id) : null, passenger: data.passenger ? { id: String(data.passenger.id), full_name: data.passenger.full_name } : null, created_at: data.created_at }]);
      }
    });
    ws.connect().catch((error) => console.error("WebSocket connection error:", error));
    return () => { clearInterval(statusInterval); ws.disconnect(); };
  }, []);

  // Init Yandex Map
  useEffect(() => {
    if (!ymapsReady || !mapRef.current || mapInstanceRef.current || loading) return;
    mapInstanceRef.current = new ymaps.Map(mapRef.current, {
      center: center,
      zoom: 12,
      controls: ["zoomControl"],
    });
    return () => {
      if (mapInstanceRef.current) { mapInstanceRef.current.destroy(); mapInstanceRef.current = null; }
    };
  }, [ymapsReady, loading]);

  // Update map center
  useEffect(() => {
    if (mapInstanceRef.current) mapInstanceRef.current.setCenter(center, mapInstanceRef.current.getZoom());
  }, [center]);

  const filteredDrivers = drivers.filter((driver) => !showOnlineOnly || driver.is_online);

  // Update markers on map
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Update driver markers
    const currentDriverIds = new Set(filteredDrivers.map(d => String(d.id)));
    driverMarkersRef.current.forEach((marker, id) => {
      if (!currentDriverIds.has(id)) { map.geoObjects.remove(marker); driverMarkersRef.current.delete(id); }
    });
    filteredDrivers.forEach((driver) => {
      const id = String(driver.id);
      const existing = driverMarkersRef.current.get(id);
      if (existing) {
        existing.geometry.setCoordinates([driver.lat, driver.lon]);
        existing.options.set("preset", driver.is_online ? "islands#greenAutoIcon" : "islands#grayAutoIcon");
      } else {
        const pm = new ymaps.Placemark(
          [driver.lat, driver.lon],
          { balloonContent: `<div class="p-2"><p class="font-semibold text-sm">${driver.name}</p><p class="text-xs text-gray-500">${driver.car_model}</p><p class="text-xs text-gray-500">${driver.plate_number}</p><div class="flex items-center gap-1 mt-1"><span class="w-2 h-2 rounded-full ${driver.is_online ? "bg-green-500" : "bg-gray-400"}" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${driver.is_online ? "#22c55e" : "#9ca3af"};"></span><span class="text-xs">${driver.is_online ? "Онлайн" : "Оффлайн"}</span></div></div>` },
          { preset: driver.is_online ? "islands#greenAutoIcon" : "islands#grayAutoIcon" }
        );
        pm.events.add("click", () => setSelectedDriver(driver));
        map.geoObjects.add(pm);
        driverMarkersRef.current.set(id, pm);
      }
    });

    // Update order markers (pickup)
    const currentOrderIds = new Set<string>();
    orders.filter(o => o.pickup_lat && o.pickup_lon).forEach((order) => {
      const pickupId = `pickup-${order.id}`;
      currentOrderIds.add(pickupId);
      const existing = orderMarkersRef.current.get(pickupId);
      if (!existing) {
        const pm = new ymaps.Placemark(
          [order.pickup_lat!, order.pickup_lon!],
          { balloonContent: `<div class="p-2"><p class="font-semibold text-sm">Заказ ${order.id}</p><p class="text-xs text-gray-500 mt-1">От: ${order.pickup_title}</p><p class="text-xs text-gray-500">До: ${order.dropoff_title}</p>${order.passenger ? `<p class="text-xs text-gray-500">Пассажир: ${order.passenger.full_name}</p>` : ""}<span style="display:inline-block;margin-top:8px;padding:2px 8px;background:#dbeafe;color:#1e40af;border-radius:4px;font-size:12px;">${order.status}</span></div>` },
          { preset: "islands#greenCircleDotIcon" }
        );
        pm.events.add("click", () => setSelectedOrder(order));
        map.geoObjects.add(pm);
        orderMarkersRef.current.set(pickupId, pm);
      }
    });
    orders.filter(o => o.dropoff_lat && o.dropoff_lon).forEach((order) => {
      const dropoffId = `dropoff-${order.id}`;
      currentOrderIds.add(dropoffId);
      const existing = orderMarkersRef.current.get(dropoffId);
      if (!existing) {
        const pm = new ymaps.Placemark(
          [order.dropoff_lat!, order.dropoff_lon!],
          { balloonContent: `<div class="p-2"><p class="font-semibold text-sm">Заказ ${order.id}</p><p class="text-xs text-gray-500 mt-1">Назначение: ${order.dropoff_title}</p><span style="display:inline-block;margin-top:8px;padding:2px 8px;background:#dbeafe;color:#1e40af;border-radius:4px;font-size:12px;">${order.status}</span></div>` },
          { preset: "islands#redCircleDotIcon" }
        );
        pm.events.add("click", () => setSelectedOrder(order));
        map.geoObjects.add(pm);
        orderMarkersRef.current.set(dropoffId, pm);
      }
    });
    orderMarkersRef.current.forEach((marker, id) => {
      if (!currentOrderIds.has(id)) { map.geoObjects.remove(marker); orderMarkersRef.current.delete(id); }
    });
  }, [filteredDrivers, orders]);

  const onlineCount = filteredDrivers.filter((d) => d.is_online).length;
  const offlineCount = filteredDrivers.filter((d) => !d.is_online).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl dark:text-white">Карта диспетчеризации</h1>
          <p className="text-gray-600 dark:text-gray-400">Отслеживание водителей и заказов в реальном времени</p>
        </div>
        <div className="flex items-center gap-2">
          {wsStatus === 'connected' && (<div className="flex items-center gap-2 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm"><Wifi className="w-4 h-4" /><span>Подключено</span></div>)}
          {wsStatus === 'connecting' && (<div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-lg text-sm"><Loader2 className="w-4 h-4 animate-spin" /><span>Подключение...</span></div>)}
          {wsStatus === 'disconnected' && (<div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-400 rounded-lg text-sm"><WifiOff className="w-4 h-4" /><span>Отключено</span></div>)}
          {wsStatus === 'error' && (<div className="flex items-center gap-2 px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm"><AlertCircle className="w-4 h-4" /><span>Ошибка подключения</span>{wsReconnectAttempts > 0 && (<span className="text-xs">({wsReconnectAttempts} попыток)</span>)}</div>)}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3"><div className="w-12 h-12 rounded-lg bg-green-100 dark:bg-green-900 flex items-center justify-center"><Car className="w-6 h-6 text-green-600 dark:text-green-400" /></div><div><p className="text-gray-600 dark:text-gray-400 text-sm">Онлайн</p><p className="text-2xl dark:text-white">{loading ? "..." : onlineCount}</p></div></div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3"><div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center"><Car className="w-6 h-6 text-gray-600 dark:text-gray-400" /></div><div><p className="text-gray-600 dark:text-gray-400 text-sm">Оффлайн</p><p className="text-2xl dark:text-white">{loading ? "..." : offlineCount}</p></div></div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3"><div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center"><Navigation className="w-6 h-6 text-blue-600 dark:text-blue-400" /></div><div><p className="text-gray-600 dark:text-gray-400 text-sm">Активные заказы</p><p className="text-2xl dark:text-white">{loading ? "..." : orders.length}</p></div></div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3"><div className="w-12 h-12 rounded-lg bg-purple-100 dark:bg-purple-900 flex items-center justify-center"><Users className="w-6 h-6 text-purple-600 dark:text-purple-400" /></div><div><p className="text-gray-600 dark:text-gray-400 text-sm">Всего водителей</p><p className="text-2xl dark:text-white">{loading ? "..." : filteredDrivers.length}</p></div></div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="flex items-center gap-2"><Filter className="w-5 h-5 text-gray-400" /><span className="text-sm text-gray-600 dark:text-gray-400">Фильтры:</span></div>
          <select value={selectedCityId} onChange={(e) => setSelectedCityId(e.target.value)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white">
            <option value="all">Все города</option>
            {cities.map((city) => (<option key={city.id} value={city.id}>{city.title}</option>))}
          </select>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showOnlineOnly} onChange={(e) => setShowOnlineOnly(e.target.checked)} className="w-4 h-4 text-indigo-600 rounded" />
            <span className="text-sm dark:text-gray-300">Только онлайн водители</span>
          </label>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden relative">
        {loading ? (
          <div className="w-full h-[calc(100vh-400px)] min-h-[500px] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
        ) : (
          <div ref={mapRef} style={{ height: "calc(100vh - 400px)", minHeight: "500px", width: "100%" }} className="z-0" />
        )}
        <div className="absolute top-4 left-4 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 border border-gray-200 dark:border-gray-700 z-[1000]">
          <p className="text-sm font-semibold dark:text-white mb-2">Легенда</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-full bg-green-500"></div><span className="text-xs dark:text-gray-300">Водитель онлайн</span></div>
            <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-full bg-gray-400"></div><span className="text-xs dark:text-gray-300">Водитель оффлайн</span></div>
            <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-full bg-green-500"></div><span className="text-xs dark:text-gray-300">Точка забора</span></div>
            <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-full bg-red-500"></div><span className="text-xs dark:text-gray-300">Точка назначения</span></div>
          </div>
        </div>
      </div>

      {selectedDriver && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-indigo-600 dark:text-indigo-400 text-2xl">{selectedDriver.name[0]}</div>
              <div>
                <h3 className="text-xl dark:text-white">{selectedDriver.name}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{selectedDriver.id}</p>
                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs mt-1 ${selectedDriver.is_online ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"}`}>
                  <span className={`w-2 h-2 rounded-full ${selectedDriver.is_online ? "bg-green-600" : "bg-gray-400"}`} />
                  {selectedDriver.is_online ? "Онлайн" : "Оффлайн"}
                </span>
              </div>
            </div>
            <button onClick={() => setSelectedDriver(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">✕</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><p className="text-sm text-gray-500 dark:text-gray-400">Машина</p><p className="dark:text-white">{selectedDriver.car_model}</p></div>
            <div><p className="text-sm text-gray-500 dark:text-gray-400">Номер</p><p className="dark:text-white">{selectedDriver.plate_number}</p></div>
            <div><p className="text-sm text-gray-500 dark:text-gray-400">Регион</p><p className="dark:text-white">{selectedDriver.region || "Не указан"}</p></div>
            <div className="md:col-span-3"><p className="text-sm text-gray-500 dark:text-gray-400">Координаты</p><p className="dark:text-white">{selectedDriver.lat.toFixed(6)}, {selectedDriver.lon.toFixed(6)}</p></div>
          </div>
        </div>
      )}

      {selectedOrder && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-xl dark:text-white">Заказ {selectedOrder.id}</h3>
              <span className="inline-block mt-2 px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm">{selectedOrder.status}</span>
            </div>
            <button onClick={() => setSelectedOrder(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">✕</button>
          </div>
          <div className="space-y-2">
            <div><p className="text-sm text-gray-500 dark:text-gray-400">От</p><p className="dark:text-white">{selectedOrder.pickup_title}</p>{selectedOrder.pickup_lat && selectedOrder.pickup_lon && (<p className="text-xs text-gray-500">{selectedOrder.pickup_lat.toFixed(6)}, {selectedOrder.pickup_lon.toFixed(6)}</p>)}</div>
            <div><p className="text-sm text-gray-500 dark:text-gray-400">До</p><p className="dark:text-white">{selectedOrder.dropoff_title}</p>{selectedOrder.dropoff_lat && selectedOrder.dropoff_lon && (<p className="text-xs text-gray-500">{selectedOrder.dropoff_lat.toFixed(6)}, {selectedOrder.dropoff_lon.toFixed(6)}</p>)}</div>
            {selectedOrder.passenger && (<div><p className="text-sm text-gray-500 dark:text-gray-400">Пассажир</p><p className="dark:text-white">{selectedOrder.passenger.full_name}</p></div>)}
          </div>
        </div>
      )}
    </div>
  );
}
