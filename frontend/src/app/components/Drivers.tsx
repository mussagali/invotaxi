import { useState, useEffect, useCallback } from "react";
import { Search, Plus, Eye, Edit, MapPin, Phone, Mail, X, Check, Car as CarIcon, Loader2, Trash2, Package, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "./Modal";
import { MapView } from "./MapView";
import { driversApi, Driver, CreateDriverRequest, UpdateDriverRequest, DRIVERS_PAGE_SIZE } from "../services/drivers";
import { formatAtyrauDate } from "../utils/atyrauDate";
import { regionsApi, type Region } from "../services/regions";
import { ordersApi, Order } from "../services/orders";
import { useAuth } from "../context/AuthContext";

/** Координаты для карты: current_position или current_lat / current_lon из API. */
function getDriverMapCoords(d: Driver | undefined | null): { lat: number; lon: number } | null {
  if (!d) return null;
  const p = d.current_position;
  if (p != null && typeof p.lat === "number" && typeof p.lon === "number") {
    return { lat: p.lat, lon: p.lon };
  }
  if (d.current_lat != null && d.current_lon != null) {
    return { lat: d.current_lat, lon: d.current_lon };
  }
  return null;
}

/** Центр карты без GPS: город региона водителя → центр региона → Алматы (запасной). */
function getDriverMapFallbackCenter(
  catalogRegion: Region | undefined,
  d: Driver
): [number, number] {
  const pickCity = (city: Region["city"]) => {
    if (city?.center?.lat != null && city?.center?.lon != null) {
      return [city.center.lat, city.center.lon] as [number, number];
    }
    if (city?.center_lat != null && city?.center_lon != null) {
      return [city.center_lat, city.center_lon] as [number, number];
    }
    return null;
  };
  const pickRegion = (r: Pick<Region, "center" | "center_lat" | "center_lon">) => {
    if (r.center?.lat != null && r.center?.lon != null) {
      return [r.center.lat, r.center.lon] as [number, number];
    }
    if (r.center_lat != null && r.center_lon != null) {
      return [r.center_lat, r.center_lon] as [number, number];
    }
    return null;
  };

  if (catalogRegion) {
    const fromCity = pickCity(catalogRegion.city);
    if (fromCity) return fromCity;
    const fromReg = pickRegion(catalogRegion);
    if (fromReg) return fromReg;
  }

  const r = d.region;
  if (r?.city) {
    const fromCity = pickCity(r.city as Region["city"]);
    if (fromCity) return fromCity;
  }
  if (r) {
    const fromReg = pickRegion(r as Region);
    if (fromReg) return fromReg;
  }

  return [43.238949, 76.945833];
}

export function Drivers() {
  const { user } = useAuth();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [onlineFilter, setOnlineFilter] = useState<"all" | "online" | "offline">("all");
  const [viewModal, setViewModal] = useState<string | null>(null);
  const [editModal, setEditModal] = useState<string | null>(null);
  const [addModal, setAddModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState<string | null>(null);
  const [callModal, setCallModal] = useState<{ name: string; phone: string } | null>(null);
  const [mapModal, setMapModal] = useState<string | null>(null);
  const [ordersModal, setOrdersModal] = useState<string | null>(null);
  const [driverOrders, setDriverOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersTab, setOrdersTab] = useState<"assigned" | "history">("assigned");
  const [newDriverPosition, setNewDriverPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [savingLocation, setSavingLocation] = useState(false);
  /** Актуальный профиль с GET /drivers/:id/ пока открыта карта (координаты с телефона). */
  const [mapDetailDriver, setMapDetailDriver] = useState<Driver | null>(null);

  // Состояния для редактирования
  const [editingName, setEditingName] = useState("");
  const [editingPhone, setEditingPhone] = useState("");
  const [editingEmail, setEditingEmail] = useState("");
  const [editingRegionId, setEditingRegionId] = useState("");
  const [editingCarModel, setEditingCarModel] = useState("");
  const [editingPlateNumber, setEditingPlateNumber] = useState("");
  const [editingCapacity, setEditingCapacity] = useState(4);
  const [editingIsOnline, setEditingIsOnline] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Состояния для добавления
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRegionId, setNewRegionId] = useState("");
  const [newCarModel, setNewCarModel] = useState("");
  const [newPlateNumber, setNewPlateNumber] = useState("");
  const [newLicenseNumber, setNewLicenseNumber] = useState("");
  const [newCapacity, setNewCapacity] = useState(4);
  const [newIsOnline, setNewIsOnline] = useState(false);
  const [creating, setCreating] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [exportingDrivers, setExportingDrivers] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSkipErrors, setImportSkipErrors] = useState(true);
  const [importDryRun, setImportDryRun] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState({ total: 0, online: 0, offline: 0 });

  const loadDrivers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params: {
        page: number;
        page_size: number;
        search?: string;
        is_online?: boolean;
      } = {
        page,
        page_size: DRIVERS_PAGE_SIZE,
      };
      if (searchTerm.trim()) params.search = searchTerm.trim();
      if (onlineFilter === "online") params.is_online = true;
      if (onlineFilter === "offline") params.is_online = false;

      const [response, statsData] = await Promise.all([
        driversApi.getDriversPaginated(params),
        driversApi.getDriversStats(),
      ]);
      setDrivers(response.results);
      setTotalCount(response.count);
      setStats(statsData);
    } catch (err: any) {
      setError(err.message || "Ошибка загрузки данных");
      setDrivers([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [page, searchTerm, onlineFilter]);

  useEffect(() => {
    const loadRegions = async () => {
      try {
        const regionsData = await regionsApi.getRegions();
        setRegions(regionsData);
      } catch (err: any) {
        console.error("Ошибка загрузки регионов:", err);
      }
    };
    void loadRegions();
  }, []);

  useEffect(() => {
    void loadDrivers();
  }, [loadDrivers]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, onlineFilter]);

  const refreshDrivers = async () => {
    await loadDrivers();
  };

  const loadDriverOrders = useCallback(async (driverId: string) => {
    try {
      setOrdersLoading(true);
      const orders = await ordersApi.getOrders({ driver_id: Number(driverId) });
      setDriverOrders(orders);
    } catch (err: any) {
      setError(err.message || "Ошибка загрузки заказов");
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ordersModal) {
      loadDriverOrders(ordersModal);
    }
  }, [ordersModal, loadDriverOrders]);

  const assignedOrders = driverOrders.filter(order => 
    ['assigned', 'driver_en_route', 'arrived_waiting', 'ride_ongoing'].includes(order.status)
  );

  const historyOrders = driverOrders.filter(order => 
    ['completed', 'cancelled'].includes(order.status)
  );

  const getStatusLabel = (status: string) => {
    const statusLabels: Record<string, string> = {
      'draft': 'Черновик',
      'submitted': 'Отправлено',
      'awaiting_dispatcher_decision': 'Ожидание решения диспетчера',
      'rejected': 'Отклонено',
      'active_queue': 'В очереди',
      'assigned': 'Назначено',
      'driver_en_route': 'Водитель в пути',
      'arrived_waiting': 'Ожидание пассажира',
      'no_show': 'Пассажир не пришел',
      'ride_ongoing': 'Поездка началась',
      'completed': 'Завершено',
      'cancelled': 'Отменено',
      'incident': 'Инцидент',
    };
    return statusLabels[status] || status;
  };

  const getStatusColor = (status: string) => {
    if (['assigned', 'driver_en_route', 'arrived_waiting', 'ride_ongoing'].includes(status)) {
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    }
    if (status === 'completed') {
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    }
    if (status === 'cancelled') {
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    }
    return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
  };

  const selectedDriver = drivers.find(
    (d) => String(d.id) === viewModal || String(d.id) === editModal
  );

  // Инициализация полей редактирования при открытии модалки
  useEffect(() => {
    if (editModal && selectedDriver) {
      setEditingName(selectedDriver.name);
      setEditingPhone(selectedDriver.user.phone);
      setEditingEmail(selectedDriver.user.email || "");
      setEditingRegionId(selectedDriver.region?.id || "");
      setEditingCarModel(selectedDriver.car_model);
      setEditingPlateNumber(selectedDriver.plate_number);
      setEditingCapacity(selectedDriver.capacity);
      setEditingIsOnline(selectedDriver.is_online);
    }
  }, [editModal, selectedDriver]);

  const mapDriver = drivers.find((d) => String(d.id) === mapModal);

  useEffect(() => {
    if (!mapModal) {
      setMapDetailDriver(null);
      return;
    }
    const id = Number(mapModal);
    let cancelled = false;

    const fetchDriverFresh = async () => {
      try {
        const d = await driversApi.getDriver(id);
        if (!cancelled) setMapDetailDriver(d);
      } catch {
        if (!cancelled) setMapDetailDriver(null);
      }
    };

    void fetchDriverFresh();
    const interval = setInterval(() => {
      void fetchDriverFresh();
    }, 8000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mapModal]);

  const handleDeleteDriver = async () => {
    if (deleteModal) {
      try {
        await driversApi.deleteDriver(Number(deleteModal));
        await refreshDrivers();
        setDeleteModal(null);
      } catch (err: any) {
        setError(err.response?.data?.error || err.message || "Ошибка удаления водителя");
      }
    }
  };

  const handleSaveEdit = async () => {
    if (!editModal || !selectedDriver) return;

    try {
      setSaving(true);
      setError(null);

      const updateData: UpdateDriverRequest = {
        name: editingName,
        phone: editingPhone,
        email: editingEmail || undefined,
        region_id: editingRegionId,
        car_model: editingCarModel,
        plate_number: editingPlateNumber,
        capacity: editingCapacity,
        is_online: editingIsOnline,
      };

      await driversApi.updateDriver(Number(editModal), updateData);
      await refreshDrivers();
      setEditModal(null);
      // Сброс полей редактирования
      setEditingName("");
      setEditingPhone("");
      setEditingEmail("");
      setEditingRegionId("");
      setEditingCarModel("");
      setEditingPlateNumber("");
      setEditingCapacity(4);
      setEditingIsOnline(false);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Ошибка сохранения водителя");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateDriver = async () => {
    try {
      setCreating(true);
      setError(null);

      if (!newName || !newPhone || !newPassword || !newRegionId || !newCarModel || !newPlateNumber) {
        setError("Заполните все обязательные поля");
        return;
      }

      const createData: CreateDriverRequest = {
        name: newName,
        phone: newPhone,
        email: newEmail || undefined,
        password: newPassword,
        region_id: newRegionId,
        car_model: newCarModel,
        plate_number: newPlateNumber,
        capacity: newCapacity,
        is_online: newIsOnline,
      };

      await driversApi.createDriver(createData);
      await refreshDrivers();
      setAddModal(false);
      // Сброс полей добавления
      setNewName("");
      setNewPhone("");
      setNewEmail("");
      setNewPassword("");
      setNewRegionId("");
      setNewCarModel("");
      setNewPlateNumber("");
      setNewLicenseNumber("");
      setNewCapacity(4);
      setNewIsOnline(false);
      toast.success("Водитель успешно создан");
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Ошибка создания водителя");
      toast.error(err.response?.data?.error || err.message || "Ошибка создания водителя");
    } finally {
      setCreating(false);
    }
  };

  const buildDriverListParams = () => {
    const params: { search?: string; is_online?: boolean } = {};
    if (searchTerm.trim()) params.search = searchTerm.trim();
    if (onlineFilter === "online") params.is_online = true;
    if (onlineFilter === "offline") params.is_online = false;
    return params;
  };

  const handleExportDrivers = async () => {
    try {
      setExportingDrivers(true);
      const blob = await driversApi.exportDrivers(buildDriverListParams());
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `drivers_export_${formatAtyrauDate(new Date())}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success("Экспорт водителей завершён");
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || "Ошибка экспорта водителей");
    } finally {
      setExportingDrivers(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      setDownloadingTemplate(true);
      const blob = await driversApi.downloadTemplate();
      
      // Создаем ссылку и скачиваем файл
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `шаблон_импорт_водителей_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast.success("Шаблон успешно скачан");
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || "Ошибка скачивания шаблона");
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handleImportDrivers = async () => {
    if (!importFile) {
      toast.error("Выберите файл для импорта");
      return;
    }

    try {
      setImporting(true);
      const result = await driversApi.importDrivers(importFile, {
        skipErrors: importSkipErrors,
        dryRun: importDryRun,
      });

      if (result.success) {
        const stats = result.statistics;
        toast.success(
          `Импорт завершен: создано ${stats.created_count}, обновлено ${stats.updated_count}, ошибок: ${stats.failed_count}`
        );
        
        if (!importDryRun) {
          await refreshDrivers();
        }
        
        setImportModal(false);
        setImportFile(null);
      } else {
        toast.error(result.error || "Ошибка импорта");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || "Ошибка импорта");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl dark:text-white">Управление водителями</h1>
          <p className="text-gray-600 dark:text-gray-400">Просмотр и управление водителями</p>
        </div>
        <div className="flex gap-2">
          {user?.role !== "operator" && (
            <>
              <button
                onClick={() => void handleExportDrivers()}
                disabled={exportingDrivers}
                className="bg-violet-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Экспорт всех водителей с геопозицией (учитывает текущий поиск и фильтр онлайн)"
              >
                {exportingDrivers ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Download className="w-5 h-5" />
                )}
                {exportingDrivers ? "Экспорт..." : "Экспорт"}
              </button>
              <button
                onClick={handleDownloadTemplate}
                disabled={downloadingTemplate}
                className="bg-green-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Скачать шаблон Excel для импорта водителей"
              >
                {downloadingTemplate ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Download className="w-5 h-5" />
                )}
                {downloadingTemplate ? "Скачивание..." : "Скачать шаблон"}
              </button>
              <button
                onClick={() => setImportModal(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                title="Импортировать водителей из Excel файла"
              >
                <Upload className="w-5 h-5" />
                Импорт
              </button>
            </>
          )}
          <button
            onClick={() => setAddModal(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            <Plus className="w-5 h-5" />
            Добавить водителя
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-gray-600 dark:text-gray-400 text-sm">Всего водителей</p>
          <p className="text-3xl dark:text-white mt-2">{stats.total}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-gray-600 dark:text-gray-400 text-sm">Онлайн</p>
          <p className="text-3xl text-green-600 dark:text-green-400 mt-2">
            {stats.online}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-gray-600 dark:text-gray-400 text-sm">Оффлайн</p>
          <p className="text-3xl dark:text-white mt-2">
            {stats.offline}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Поиск по имени, машине или номеру..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setOnlineFilter("all")}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                onlineFilter === "all"
                  ? "bg-indigo-600 text-white dark:bg-indigo-500"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              }`}
            >
              Все
            </button>
            <button
              onClick={() => setOnlineFilter("online")}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                onlineFilter === "online"
                  ? "bg-indigo-600 text-white dark:bg-indigo-500"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              }`}
            >
              Онлайн
            </button>
            <button
              onClick={() => setOnlineFilter("offline")}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                onlineFilter === "offline"
                  ? "bg-indigo-600 text-white dark:bg-indigo-500"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              }`}
            >
              Оффлайн
            </button>
          </div>
        </div>
      </div>

      {/* Drivers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {drivers.map((driver) => (
          <div key={driver.id} className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-indigo-600 dark:text-indigo-400 text-xl">
                  {driver.name[0]}
                </div>
                <div>
                  <h3 className="text-lg dark:text-white">{driver.name}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{driver.id}</p>
                </div>
              </div>
              <span
                className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs ${
                  driver.is_online
                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                    : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${driver.is_online ? "bg-green-600" : "bg-gray-400"}`} />
                {driver.is_online ? "Онлайн" : "Оффлайн"}
              </span>
            </div>

            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Телефон:</span>
                <span className="dark:text-white">{driver.user.phone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Машина:</span>
                <span className="dark:text-white">{driver.car_model}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Номер:</span>
                <span className="dark:text-white">{driver.plate_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Регион:</span>
                <span className="dark:text-white">{driver.region?.title || "Не указано"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Вместимость:</span>
                <span className="text-xs dark:text-white">{driver.capacity}</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex gap-2">
                <button
                  onClick={() => setViewModal(String(driver.id))}
                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  title="Просмотр"
                >
                  <Eye className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setEditModal(String(driver.id))}
                  className="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300"
                  title="Редактировать"
                >
                  <Edit className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setCallModal({ name: driver.name, phone: driver.user.phone })}
                  className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
                  title="Позвонить"
                >
                  <Phone className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setMapModal(String(driver.id))}
                  className="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300"
                  title="На карте"
                >
                  <MapPin className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setOrdersModal(String(driver.id))}
                  className="text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300"
                  title="Заказы"
                >
                  <Package className="w-5 h-5" />
                </button>
                {user?.role !== "operator" && (
                  <button
                    onClick={() => setDeleteModal(String(driver.id))}
                    className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                    title="Удалить"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {totalCount > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Показано <span className="font-medium text-gray-900 dark:text-white">{drivers.length}</span> из{" "}
            <span className="font-medium text-gray-900 dark:text-white">{totalCount}</span> водителей
          </p>
          <div className="flex gap-2">
            <button
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Предыдущая
            </button>
            <span className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg font-medium">
              {page}
            </span>
            <button
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={page * DRIVERS_PAGE_SIZE >= totalCount}
              onClick={() => setPage((p) => p + 1)}
            >
              Следующая
            </button>
          </div>
        </div>
      )}

      {!loading && drivers.length === 0 && (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <p className="text-gray-500 dark:text-gray-400">Водители не найдены</p>
        </div>
      )}

      {/* View Modal */}
      <Modal
        isOpen={viewModal !== null}
        onClose={() => setViewModal(null)}
        title="Детали водителя"
        size="lg"
      >
        {selectedDriver && (
          <div className="space-y-6">
            <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="w-16 h-16 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-indigo-600 dark:text-indigo-400 text-2xl">
                {selectedDriver.name[0]}
              </div>
              <div className="flex-1">
                <h3 className="text-xl dark:text-white">{selectedDriver.name}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{selectedDriver.id}</p>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs mt-2 ${
                    selectedDriver.is_online
                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                      : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${selectedDriver.is_online ? "bg-green-600" : "bg-gray-400"}`} />
                  {selectedDriver.is_online ? "Онлайн" : "Оффлайн"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <h4 className="font-semibold dark:text-white">Контактная информация</h4>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-gray-400" />
                    <span className="text-sm dark:text-gray-300">{selectedDriver.user.phone}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-gray-400" />
                    <span className="text-sm dark:text-gray-300">{selectedDriver.user.email || "Не указано"}</span>
                  </div>
                  {selectedDriver.current_position && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-gray-400" />
                      <span className="text-sm dark:text-gray-300">
                        {selectedDriver.current_position.lat.toFixed(4)}, {selectedDriver.current_position.lon.toFixed(4)}
                      </span>
                  </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold dark:text-white">Информация о машине</h4>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CarIcon className="w-4 h-4 text-gray-400" />
                    <span className="text-sm dark:text-gray-300">{selectedDriver.car_model}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Номер:</span>
                    <span className="text-sm dark:text-white">{selectedDriver.plate_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Вместимость:</span>
                    <span className="text-sm dark:text-white">{selectedDriver.capacity}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">Регион</p>
                <p className="text-lg dark:text-white mt-1">{selectedDriver.region?.title || "Не указано"}</p>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">Статус</p>
                <p className="text-lg dark:text-white mt-1">{selectedDriver.is_online ? "Онлайн" : "Оффлайн"}</p>
              </div>
            </div>

            {selectedDriver.current_position && (
            <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Текущая позиция</p>
                <p className="dark:text-white">
                  {selectedDriver.current_position.lat.toFixed(6)}, {selectedDriver.current_position.lon.toFixed(6)}
                </p>
            </div>
            )}

            <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button 
                onClick={() => {
                  setMapModal(String(selectedDriver.id));
                  setViewModal(null);
                }}
                className="flex-1 bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700"
              >
                Посмотреть на карте
              </button>
              <button
                onClick={() => setViewModal(null)}
                className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Закрыть
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={editModal !== null}
        onClose={() => {
          setEditModal(null);
          setEditingName("");
          setEditingPhone("");
          setEditingEmail("");
          setEditingRegionId("");
          setEditingCarModel("");
          setEditingPlateNumber("");
          setEditingCapacity(4);
          setEditingIsOnline(false);
        }}
        title="Редактировать водителя"
        size="lg"
      >
        {selectedDriver && (
          <div className="space-y-4">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Имя *</label>
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Телефон *</label>
                <input
                  type="tel"
                  value={editingPhone}
                  onChange={(e) => setEditingPhone(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Email</label>
                <input
                  type="email"
                  value={editingEmail}
                  onChange={(e) => setEditingEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Регион *</label>
                <select
                  value={editingRegionId}
                  onChange={(e) => setEditingRegionId(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Выберите регион</option>
                  {regions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Машина *</label>
                <input
                  type="text"
                  value={editingCarModel}
                  onChange={(e) => setEditingCarModel(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Гос. номер *</label>
                <input
                  type="text"
                  value={editingPlateNumber}
                  onChange={(e) => setEditingPlateNumber(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Вместимость *</label>
              <input
                type="number"
                min="1"
                max="10"
                value={editingCapacity}
                onChange={(e) => setEditingCapacity(Number(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <input
                type="checkbox"
                id="online-status"
                checked={editingIsOnline}
                onChange={(e) => setEditingIsOnline(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded"
              />
              <label htmlFor="online-status" className="text-sm dark:text-gray-300">
                Водитель онлайн
              </label>
            </div>

            <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 transition-colors ${
                  saving
                    ? "bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                    : "bg-indigo-600 text-white hover:bg-indigo-700"
                }`}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Сохранение...
                  </>
                ) : (
                  <>
                <Check className="w-5 h-5" />
                Сохранить
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setEditModal(null);
                  setEditingName("");
                  setEditingPhone("");
                  setEditingEmail("");
                  setEditingRegionId("");
                  setEditingCarModel("");
                  setEditingPlateNumber("");
                  setEditingCapacity(4);
                  setEditingIsOnline(false);
                }}
                disabled={saving}
                className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <X className="w-5 h-5" />
                Отмена
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Add Driver Modal */}
      <Modal
        isOpen={addModal}
        onClose={() => {
          setAddModal(false);
          setNewName("");
          setNewPhone("");
          setNewEmail("");
          setNewPassword("");
          setNewRegionId("");
          setNewCarModel("");
          setNewPlateNumber("");
          setNewLicenseNumber("");
          setNewCapacity(4);
          setNewIsOnline(false);
        }}
        title="Добавить водителя"
        size="lg"
      >
        <div className="space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Имя *</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Иванов Иван Иванович"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Телефон *</label>
              <input
                type="tel"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="+7 777 123 4567"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Email</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="driver@invotaxi.kz"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Пароль *</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Минимум 8 символов"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Регион *</label>
            <select
              value={newRegionId}
              onChange={(e) => setNewRegionId(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Выберите регион</option>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.title}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Машина *</label>
              <input
                type="text"
                value={newCarModel}
                onChange={(e) => setNewCarModel(e.target.value)}
                placeholder="Toyota Camry"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Гос. номер *</label>
              <input
                type="text"
                value={newPlateNumber}
                onChange={(e) => setNewPlateNumber(e.target.value)}
                placeholder="A 123 BC 02"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Вместимость *</label>
            <input
              type="number"
              min="1"
              max="10"
              value={newCapacity}
              onChange={(e) => setNewCapacity(Number(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <input
              type="checkbox"
              id="new-online-status"
              checked={newIsOnline}
              onChange={(e) => setNewIsOnline(e.target.checked)}
              className="w-4 h-4 text-indigo-600 rounded"
            />
            <label htmlFor="new-online-status" className="text-sm dark:text-gray-300">
              Водитель онлайн
            </label>
          </div>

          <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleCreateDriver}
              disabled={creating}
              className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 transition-colors ${
                creating
                  ? "bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                  : "bg-indigo-600 text-white hover:bg-indigo-700"
              }`}
            >
              {creating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Создание...
                </>
              ) : (
                <>
              <Check className="w-5 h-5" />
              Добавить водителя
                </>
              )}
            </button>
            <button
              onClick={() => {
                setAddModal(false);
                setNewName("");
                setNewPhone("");
                setNewEmail("");
                setNewPassword("");
                setNewRegionId("");
                setNewCarModel("");
                setNewPlateNumber("");
                setNewLicenseNumber("");
                setNewCapacity(4);
                setNewIsOnline(false);
              }}
              disabled={creating}
              className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <X className="w-5 h-5" />
              Отмена
            </button>
          </div>
        </div>
      </Modal>

      {/* Call Modal */}
      <Modal
        isOpen={callModal !== null}
        onClose={() => setCallModal(null)}
        title="Позвонить водителю"
        size="sm"
        footer={
          callModal ? (
            <>
              <button
                onClick={() => setCallModal(null)}
                className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Отмена
              </button>
              <button className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 shadow-lg shadow-green-500/30">
                <Phone className="w-5 h-5" />
                Позвонить
              </button>
            </>
          ) : undefined
        }
      >
        {callModal && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl border border-green-200 dark:border-green-800">
              <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center ring-4 ring-green-50 dark:ring-green-900/50">
                <Phone className="w-7 h-7 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1">
                <p className="dark:text-white mb-1">{callModal.name}</p>
                <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">{callModal.phone}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  🚗 Водитель
                </p>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                💡 <strong>Совет:</strong> Убедитесь, что микрофон и наушники подключены перед началом звонка.
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Modal */}
      <Modal
        isOpen={deleteModal !== null}
        onClose={() => setDeleteModal(null)}
        title="Удалить водителя"
        size="sm"
        footer={
          deleteModal ? (
            <>
              <button
                onClick={() => setDeleteModal(null)}
                className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleDeleteDriver}
                className="px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 shadow-lg shadow-red-500/30"
              >
                <Trash2 className="w-5 h-5" />
                Удалить
              </button>
            </>
          ) : undefined
        }
      >
        {deleteModal && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-900/20 dark:to-rose-900/20 rounded-xl border border-red-200 dark:border-red-800">
              <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center ring-4 ring-red-50 dark:ring-red-900/50">
                <Trash2 className="w-7 h-7 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1">
                <p className="dark:text-white mb-1">Вы уверены, что хотите удалить этого водителя?</p>
                <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">Это действие необратимо.</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  🚗 Водитель
                </p>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                💡 <strong>Совет:</strong> Убедитесь, что вы действительно хотите удалить этого водителя.
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Map Modal */}
      <Modal
        isOpen={mapModal !== null}
        onClose={() => {
          setMapModal(null);
          setNewDriverPosition(null);
          setMapDetailDriver(null);
        }}
        title="Карта водителя"
        size="lg"
      >
        {mapDriver && (() => {
          const driverForMap = mapDetailDriver ?? mapDriver;
          const liveCoords = getDriverMapCoords(driverForMap);
          const regionCatalog = driverForMap.region?.id
            ? regions.find((r) => r.id === driverForMap.region!.id)
            : undefined;
          const fallbackCenter = getDriverMapFallbackCenter(regionCatalog, driverForMap);
          const defaultCenter: [number, number] = liveCoords
            ? [liveCoords.lat, liveCoords.lon]
            : fallbackCenter;
          const onlineWaiting =
            driverForMap.is_online && !liveCoords && !newDriverPosition;
          const markerForMap: [number, number] | null = newDriverPosition
            ? [newDriverPosition.lat, newDriverPosition.lon]
            : liveCoords
              ? [liveCoords.lat, liveCoords.lon]
              : onlineWaiting
                ? null
                : defaultCenter;

          return (
          <div className="space-y-4">
            <div className="h-96 relative">
              <MapView
                center={defaultCenter}
                zoom={liveCoords ? 15 : 11}
                markerPosition={markerForMap}
                popupContent={`${driverForMap.name}<br />${driverForMap.region?.title || "Не указано"}${newDriverPosition ? '<br /><small>Перетащите маркер для изменения</small>' : driverForMap.is_online && liveCoords ? '<br /><small>🟢 На линии — позиция с телефона</small>' : ''}`}
                draggable={true}
                onMarkerPositionChange={(lat, lon) => {
                  setNewDriverPosition({ lat, lon });
                }}
              />
              {newDriverPosition ? (
                <div className="absolute top-2 left-2 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-400 dark:border-yellow-600 rounded-lg p-2 text-sm text-yellow-800 dark:text-yellow-200 z-[1000] shadow-lg">
                  <p className="font-medium">Новая позиция:</p>
                  <p>Широта: {newDriverPosition.lat.toFixed(6)}</p>
                  <p>Долгота: {newDriverPosition.lon.toFixed(6)}</p>
                </div>
              ) : onlineWaiting ? (
                <div className="absolute top-2 left-2 bg-amber-100 dark:bg-amber-900/30 border border-amber-400 dark:border-amber-600 rounded-lg p-2 text-sm text-amber-900 dark:text-amber-100 z-[1000] shadow-lg max-w-xs">
                  <p className="font-medium flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    Ожидание координат
                  </p>
                  <p className="text-xs mt-1">Водитель на линии — как только приложение передаст геолокацию, маркер появится (обновление каждые ~8 с).</p>
                </div>
              ) : (
                <div className="absolute top-2 left-2 bg-blue-100 dark:bg-blue-900/30 border border-blue-400 dark:border-blue-600 rounded-lg p-2 text-sm text-blue-800 dark:text-blue-200 z-[1000] shadow-lg">
                  <p className="font-medium flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    Подсказка
                  </p>
                  <p className="text-xs mt-1">Перетащите маркер на карте для ручного изменения позиции водителя</p>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {liveCoords ? (
                  <>
                    <p>
                      <strong>Текущая позиция</strong>
                      {driverForMap.is_online ? (
                        <span className="ml-2 text-green-600 dark:text-green-400 font-medium">(на линии)</span>
                      ) : null}
                    </p>
                    <p>Широта: {liveCoords.lat.toFixed(6)}, Долгота: {liveCoords.lon.toFixed(6)}</p>
                    {driverForMap.last_location_update && (
                      <p className="text-xs mt-1 text-gray-500">
                        Обновлено: {new Date(driverForMap.last_location_update).toLocaleString("ru-RU")}
                      </p>
                    )}
                  </>
                ) : driverForMap.is_online ? (
                  <p>Позиция ещё не пришла с телефона водителя (включите геолокацию в приложении).</p>
                ) : (
                  <p>Позиция не установлена — водитель не на линии.</p>
                )}
              </div>
              <div className="flex gap-2">
                {newDriverPosition && (
                  <>
                    <button
                      onClick={async () => {
                        if (!mapModal || !newDriverPosition) return;
                        try {
                          setSavingLocation(true);
                          await driversApi.updateLocation(Number(mapModal), {
                            lat: newDriverPosition.lat,
                            lon: newDriverPosition.lon
                          });
                          await refreshDrivers();
                          try {
                            const d = await driversApi.getDriver(Number(mapModal));
                            setMapDetailDriver(d);
                          } catch {
                            /* ignore */
                          }
                          setNewDriverPosition(null);
                          toast.success("Позиция водителя успешно обновлена");
                        } catch (err: any) {
                          const errorMessage = err.response?.data?.error || err.message || "Ошибка сохранения позиции";
                          setError(errorMessage);
                          toast.error(errorMessage);
                        } finally {
                          setSavingLocation(false);
                        }
                      }}
                      disabled={savingLocation}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                    >
                      {savingLocation ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Сохранение...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          Сохранить позицию
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setNewDriverPosition(null)}
                      className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                    >
                      Отмена
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
          );
        })()}
      </Modal>

      {/* Orders Modal */}
      <Modal
        isOpen={ordersModal !== null}
        onClose={() => {
          setOrdersModal(null);
          setDriverOrders([]);
          setOrdersTab("assigned");
        }}
        title={`Заказы водителя ${ordersModal ? drivers.find(d => String(d.id) === ordersModal)?.name : ""}`}
        size="lg"
      >
        {ordersModal && (
          <div className="space-y-4">
            {/* Tabs */}
            <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setOrdersTab("assigned")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  ordersTab === "assigned"
                    ? "border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400"
                    : "text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                Назначенные ({assignedOrders.length})
              </button>
              <button
                onClick={() => setOrdersTab("history")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  ordersTab === "history"
                    ? "border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400"
                    : "text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                История ({historyOrders.length})
              </button>
            </div>

            {/* Orders List */}
            {ordersLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600 dark:text-indigo-400" />
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {(ordersTab === "assigned" ? assignedOrders : historyOrders).length === 0 ? (
                  <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                    <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>
                      {ordersTab === "assigned"
                        ? "Нет назначенных заказов"
                        : "История заказов пуста"}
                    </p>
                  </div>
                ) : (
                  (ordersTab === "assigned" ? assignedOrders : historyOrders).map((order) => (
                    <div
                      key={order.id}
                      className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium dark:text-white">
                              Заказ #{order.id.split('_')[1] || order.id}
                            </span>
                            <span
                              className={`px-2 py-1 rounded-full text-xs ${getStatusColor(order.status)}`}
                            >
                              {getStatusLabel(order.status)}
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                            <div>
                              <span className="font-medium">Откуда:</span> {order.pickup_title}
                            </div>
                            <div>
                              <span className="font-medium">Куда:</span> {order.dropoff_title}
                            </div>
                            {order.passenger && (
                              <div>
                                <span className="font-medium">Пассажир:</span> {order.passenger.full_name} ({order.passenger.user.phone})
                              </div>
                            )}
                            {order.final_price && (
                              <div>
                                <span className="font-medium">Стоимость:</span> {order.final_price.toFixed(2)} ₸
                              </div>
                            )}
                            {order.distance_km && (
                              <div>
                                <span className="font-medium">Расстояние:</span> {order.distance_km.toFixed(2)} км
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                        Создан: {new Date(order.created_at).toLocaleString('ru-RU')}
                        {order.assigned_at && (
                          <> • Назначен: {new Date(order.assigned_at).toLocaleString('ru-RU')}</>
                        )}
                        {order.completed_at && (
                          <> • Завершен: {new Date(order.completed_at).toLocaleString('ru-RU')}</>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Import Modal */}
      <Modal
        isOpen={importModal}
        onClose={() => {
          setImportModal(false);
          setImportFile(null);
          setImportSkipErrors(true);
          setImportDryRun(false);
        }}
        title="Импорт водителей из Excel"
        size="md"
        footer={
          <>
            <button
              onClick={() => {
                setImportModal(false);
                setImportFile(null);
                setImportSkipErrors(true);
                setImportDryRun(false);
              }}
              className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleImportDrivers}
              disabled={!importFile || importing}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Импорт...
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5" />
                  Импортировать
                </>
              )}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium dark:text-gray-300 mb-2">
              Выберите Excel файл
            </label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Поддерживаются форматы: .xlsx, .xls
            </p>
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={importSkipErrors}
                onChange={(e) => setImportSkipErrors(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm dark:text-gray-300">
                Пропускать ошибки и продолжать
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={importDryRun}
                onChange={(e) => setImportDryRun(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm dark:text-gray-300">
                Режим валидации (не создавать водителей)
              </span>
            </label>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>Инструкция:</strong>
            </p>
            <ul className="text-sm text-blue-700 dark:text-blue-300 mt-2 space-y-1 list-disc list-inside">
              <li>Используйте шаблон, скачанный кнопкой "Скачать шаблон"</li>
              <li>Обязательные поля: Имя, Телефон, Пароль, Регион, Машина, Гос. номер, Вместимость</li>
              <li>Пароль должен содержать минимум 8 символов</li>
              <li>Телефон должен быть уникальным</li>
            </ul>
          </div>

          {importFile && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
              <p className="text-sm dark:text-gray-300">
                Выбран файл: <strong>{importFile.name}</strong>
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Размер: {(importFile.size / 1024).toFixed(2)} KB
              </p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}