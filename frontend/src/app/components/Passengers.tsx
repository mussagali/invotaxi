import { useState, useEffect, useCallback } from "react";
import { Search, Plus, Eye, Edit, Phone, Trash2, Save, X, Loader2, Download, Upload, BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "./Modal";
import { passengersApi, Passenger as ApiPassenger, PASSENGERS_PAGE_SIZE } from "../services/passengers";
import { regionsApi, Region } from "../services/regions";
import { useAuth } from "../context/AuthContext";

// Локальный интерфейс для UI компонента
interface Passenger {
  id: string;
  name: string;
  phone: string;
  email: string;
  region: string;
  region_id?: string;
  disability: string;
  companion: boolean;
  verified: boolean;
  totalOrders: number;
  registered: string;
  address?: string;
  notes?: string;
}

const categories = ["Все", "I группа", "II группа", "III группа", "Ребенок-инвалид"];
const disabilityOptions = ["I группа", "II группа", "III группа", "Ребенок-инвалид"];

export function Passengers() {
  const { user } = useAuth();
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Все");
  const [callModal, setCallModal] = useState<{ name: string; phone: string } | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const [viewModal, setViewModal] = useState<Passenger | null>(null);
  const [editModal, setEditModal] = useState<Passenger | null>(null);
  const [deleteModal, setDeleteModal] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    region_id: "",
    disability: "",
    companion: false,
    address: "",
    notes: "",
  });
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSkipErrors, setImportSkipErrors] = useState(true);
  const [importDryRun, setImportDryRun] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState({
    total: 0,
    with_companion: 0,
    total_orders: 0,
    category_i: 0,
  });

  // Преобразование API данных в локальный формат
  const transformApiPassenger = (apiPassenger: ApiPassenger): Passenger => {
    return {
      id: String(apiPassenger.id),
      name: apiPassenger.full_name || apiPassenger.user.username || "Не указано",
      phone: apiPassenger.user.phone || "",
      email: apiPassenger.user.email || "",
      region: apiPassenger.region?.title || "Не указано",
      region_id: apiPassenger.region?.id || "",
      disability: apiPassenger.disability_category || "",
      companion: apiPassenger.allowed_companion || false,
      verified: apiPassenger.is_verified || false,
      totalOrders: apiPassenger.total_orders || 0,
      registered: new Date().toLocaleDateString("ru-RU"), // TODO: добавить в API если нужно
      address: "",
      notes: apiPassenger.notes || "",
    };
  };

  const handleVerifyPassenger = async (passenger: Passenger) => {
    try {
      await passengersApi.updatePassenger(passenger.id, { is_verified: true });
      toast.success("Аккаунт подтвержден");
      await refreshPassengers();
      if (viewModal?.id === passenger.id) {
        setViewModal({ ...passenger, verified: true });
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || "Ошибка подтверждения";
      toast.error(msg);
    }
  };

  // Загрузка регионов из API
  useEffect(() => {
    const loadRegions = async () => {
      try {
        const data = await regionsApi.getRegions();
        setRegions(Array.isArray(data) ? data : data.results || []);
      } catch (err: any) {
        console.error("Ошибка загрузки регионов:", err);
      }
    };
    loadRegions();
  }, []);

  const loadPassengers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params: {
        page: number;
        page_size: number;
        search?: string;
        disability_category?: string;
      } = {
        page,
        page_size: PASSENGERS_PAGE_SIZE,
      };
      if (searchTerm.trim()) params.search = searchTerm.trim();
      if (selectedCategory !== "Все") params.disability_category = selectedCategory;

      const [response, statsData] = await Promise.all([
        passengersApi.getPassengersPaginated(params),
        passengersApi.getPassengersStats(),
      ]);
      setPassengers(response.results.map(transformApiPassenger));
      setTotalCount(response.count);
      setStats(statsData);
    } catch (err: any) {
      setError(err.message || "Ошибка загрузки пассажиров");
      setPassengers([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [page, searchTerm, selectedCategory]);

  useEffect(() => {
    void loadPassengers();
  }, [loadPassengers]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, selectedCategory]);

  const handleAddPassenger = () => {
    setEditModal(null);
    setFormData({
      name: "",
      phone: "",
      email: "",
      region_id: "",
      disability: "",
      companion: false,
      address: "",
      notes: "",
    });
    setCreateModal(true);
  };

  const handleEditPassenger = (passenger: Passenger) => {
    setEditModal(passenger);
    setFormData({
      name: passenger.name,
      phone: passenger.phone,
      email: passenger.email,
      region_id: passenger.region_id || "",
      disability: passenger.disability,
      companion: passenger.companion,
      address: passenger.address || "",
      notes: passenger.notes || "",
    });
    setCreateModal(true);
  };

  const handleSavePassenger = async () => {
    try {
      if (!formData.name?.trim() || !formData.phone?.trim() || !formData.disability) {
        setError("Заполните обязательные поля: имя, телефон, категория инвалидности");
        toast.error("Заполните обязательные поля");
        return;
      }
      if (editModal) {
        await passengersApi.updatePassenger(editModal.id, {
          full_name: formData.name,
          region_id: formData.region_id || undefined,
          disability_category: formData.disability || undefined,
          allowed_companion: formData.companion,
          phone: formData.phone,
          email: formData.email || undefined,
        });
        toast.success("Пассажир обновлён");
        await refreshPassengers();
        setEditModal(null);
      } else {
        await passengersApi.createPassenger({
          full_name: formData.name.trim(),
          region_id: formData.region_id,
          disability_category: formData.disability,
          allowed_companion: formData.companion,
          phone: formData.phone.trim(),
          email: formData.email?.trim() || undefined,
        });
        toast.success("Пассажир создан");
        await refreshPassengers();
      }
      setCreateModal(false);
    } catch (err: any) {
      const msg = err.response?.data?.phone?.[0] || err.response?.data?.email?.[0] || err.message || "Ошибка сохранения пассажира";
      setError(msg);
      toast.error(msg);
    }
  };

  const handleDeletePassenger = async () => {
    if (deleteModal) {
      try {
        // TODO: Реализовать удаление через API
        // await passengersApi.deletePassenger(Number(deleteModal));
        setPassengers(passengers.filter((p) => p.id !== deleteModal));
        setDeleteModal(null);
      } catch (err: any) {
        setError(err.message || "Ошибка удаления пассажира");
      }
    }
  };

  const refreshPassengers = async () => {
    await loadPassengers();
  };

  const handleDownloadTemplate = async () => {
    try {
      setDownloadingTemplate(true);
      const blob = await passengersApi.downloadTemplate();
      
      // Создаем ссылку и скачиваем файл
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `шаблон_импорт_пассажиров_${new Date().toISOString().slice(0, 10)}.xlsx`;
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

  const handleImportPassengers = async () => {
    if (!importFile) {
      toast.error("Выберите файл для импорта");
      return;
    }

    try {
      setImporting(true);
      const result = await passengersApi.importPassengers(importFile, {
        skipErrors: importSkipErrors,
        dryRun: importDryRun,
      });

      if (result.success) {
        const stats = result.statistics;
        toast.success(
          `Импорт завершен: создано ${stats.created_count}, обновлено ${stats.updated_count}, ошибок: ${stats.failed_count}`
        );
        
        if (!importDryRun) {
          await refreshPassengers();
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

  if (loading && passengers.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl dark:text-white">Управление пассажирами</h1>
          <p className="text-gray-600 dark:text-gray-400">Просмотр и управление пассажирами</p>
        </div>
        <div className="flex gap-2">
          {user?.role !== "operator" && (
            <>
              <button
                onClick={handleDownloadTemplate}
                disabled={downloadingTemplate}
                className="bg-green-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Скачать шаблон Excel для импорта пассажиров"
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
                title="Импортировать пассажиров из Excel файла"
              >
                <Upload className="w-5 h-5" />
                Импорт
              </button>
            </>
          )}
          <button
            onClick={handleAddPassenger}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            <Plus className="w-5 h-5" />
            Добавить пассажира
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
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-gray-600 dark:text-gray-400 text-sm">Всего пассажиров</p>
          <p className="text-3xl dark:text-white mt-2">{stats.total}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-gray-600 dark:text-gray-400 text-sm">С сопровождением</p>
          <p className="text-3xl dark:text-white mt-2">
            {stats.with_companion}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-gray-600 dark:text-gray-400 text-sm">Всего поездок</p>
          <p className="text-3xl dark:text-white mt-2">
            {stats.total_orders}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-gray-600 dark:text-gray-400 text-sm">Категория I</p>
          <p className="text-3xl dark:text-white mt-2">
            {stats.category_i}
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
              placeholder="Поиск по имени, телефону или email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div className="flex gap-2">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  selectedCategory === category
                    ? "bg-indigo-600 text-white dark:bg-indigo-500"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Passengers Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
              <tr>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  ID
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Пассажир
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Контакты
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Регион
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Категория
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Статус
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Сопровождение
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Поездки
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {passengers.map((passenger) => (
                <tr key={passenger.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-4 whitespace-nowrap dark:text-white">
                    {passenger.id}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center text-purple-600 dark:text-purple-400">
                        {passenger.name[0]}
                      </div>
                      <div>
                        <p className="dark:text-white">{passenger.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Рег.: {passenger.registered}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm">
                      <p className="text-gray-900 dark:text-white">{passenger.phone}</p>
                      <p className="text-gray-500 dark:text-gray-400">{passenger.email}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap dark:text-white">
                    {passenger.region}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="inline-block px-3 py-1 rounded-full text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                      {passenger.disability}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {passenger.verified ? (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        <BadgeCheck className="w-4 h-4" />
                        Подтвержден
                      </span>
                    ) : (
                      <span className="inline-block px-3 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                        Ожидает
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {passenger.companion ? (
                      <span className="text-green-600 dark:text-green-400">Да</span>
                    ) : (
                      <span className="text-gray-400">Нет</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap dark:text-white">
                    {passenger.totalOrders}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex gap-2">
                      {!passenger.verified && user?.role !== "operator" && (
                        <button
                          className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
                          onClick={() => handleVerifyPassenger(passenger)}
                          title="Подтвердить аккаунт"
                        >
                          <BadgeCheck className="w-5 h-5" />
                        </button>
                      )}
                      <button
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                        onClick={() => setViewModal(passenger)}
                        title="Просмотр"
                      >
                        <Eye className="w-5 h-5" />
                      </button>
                      <button
                        className="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300"
                        onClick={() => handleEditPassenger(passenger)}
                        title="Редактировать"
                      >
                        <Edit className="w-5 h-5" />
                      </button>
                      <button
                        className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
                        onClick={() => setCallModal({ name: passenger.name, phone: passenger.phone })}
                        title="Позвонить"
                      >
                        <Phone className="w-5 h-5" />
                      </button>
                      {user?.role !== "operator" && (
                        <button
                          className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                          onClick={() => setDeleteModal(passenger.id)}
                          title="Удалить"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalCount > 0 && (
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Показано <span className="font-medium text-gray-900 dark:text-white">{passengers.length}</span> из{" "}
              <span className="font-medium text-gray-900 dark:text-white">{totalCount}</span> пассажиров
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
                disabled={page * PASSENGERS_PAGE_SIZE >= totalCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Следующая
              </button>
            </div>
          </div>
        )}

        {!loading && passengers.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">Пассажиры не найдены</p>
          </div>
        )}
      </div>

      {/* View Modal */}
      <Modal
        isOpen={viewModal !== null}
        onClose={() => setViewModal(null)}
        title="Детали пассажира"
        size="lg"
      >
        {viewModal && (
          <div className="space-y-6">
            <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center text-purple-600 dark:text-purple-400 text-2xl">
                {viewModal.name[0]}
              </div>
              <div className="flex-1">
                <h3 className="text-xl dark:text-white">{viewModal.name}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{viewModal.id}</p>
                <span className="inline-block mt-2 px-3 py-1 rounded-full text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                  {viewModal.disability}
                </span>
                <div className="mt-2">
                  {viewModal.verified ? (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      <BadgeCheck className="w-4 h-4" />
                      Подтвержден
                    </span>
                  ) : (
                    <span className="inline-block px-3 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                      Ожидает подтверждения
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h4 className="font-semibold dark:text-white">Контактная информация</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Телефон:</span>
                    <span className="dark:text-white">{viewModal.phone}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Email:</span>
                    <span className="dark:text-white">{viewModal.email}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Регион:</span>
                    <span className="dark:text-white">{viewModal.region}</span>
                  </div>
                  {viewModal.address && (
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-600">
                      <span className="text-gray-500 dark:text-gray-400 block mb-1">Адрес:</span>
                      <span className="dark:text-white">{viewModal.address}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold dark:text-white">Информация о клиенте</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Сопровождение:</span>
                    <span className={viewModal.companion ? "text-green-600 dark:text-green-400" : "text-gray-400"}>
                      {viewModal.companion ? "Требуется" : "Не требуется"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Всего поездок:</span>
                    <span className="dark:text-white">{viewModal.totalOrders}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Зарегистрирован:</span>
                    <span className="dark:text-white">{viewModal.registered}</span>
                  </div>
                </div>
              </div>
            </div>

            {viewModal.notes && (
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  <strong className="dark:text-white">Примечания:</strong> {viewModal.notes}
                </p>
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              {!viewModal.verified && user?.role !== "operator" && (
                <button
                  onClick={() => handleVerifyPassenger(viewModal)}
                  className="flex-1 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 flex items-center justify-center gap-2"
                >
                  <BadgeCheck className="w-5 h-5" />
                  Подтвердить
                </button>
              )}
              <button
                onClick={() => {
                  setCallModal({ name: viewModal.name, phone: viewModal.phone });
                  setViewModal(null);
                }}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
              >
                <Phone className="w-5 h-5" />
                Позвонить
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

      {/* Create/Edit Passenger Modal */}
      <Modal
        isOpen={createModal}
        onClose={() => setCreateModal(false)}
        title={editModal ? "Редактировать пассажира" : "Добавить нового пассажира"}
        size="lg"
        footer={
          <>
            <button
              onClick={() => setCreateModal(false)}
              className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              Отмена
            </button>
            <button
              onClick={handleSavePassenger}
              className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2"
            >
              <Save className="w-5 h-5" />
              {editModal ? "Сохранить" : "Создать"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Имя *</label>
              <input
                type="text"
                placeholder="Введите имя"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Телефон *</label>
              <input
                type="tel"
                placeholder="+7 777 123 4567"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Email</label>
            <input
              type="email"
              placeholder="email@example.com"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Регион *</label>
              <select
                value={formData.region_id}
                onChange={(e) => setFormData({ ...formData, region_id: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
              >
                <option value="">Выберите регион</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.title} {region.city ? `(${region.city.title})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Категория инвалидности *</label>
              <select
                value={formData.disability}
                onChange={(e) => setFormData({ ...formData, disability: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
              >
                <option value="">Выберите категорию</option>
                {disabilityOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Адрес</label>
            <input
              type="text"
              placeholder="ул. Абая 123, кв. 45"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Примечания</label>
            <textarea
              placeholder="Дополнительная информация о пассажире..."
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <input
              type="checkbox"
              id="companion"
              checked={formData.companion}
              onChange={(e) => setFormData({ ...formData, companion: e.target.checked })}
              className="w-5 h-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
            />
            <label htmlFor="companion" className="text-sm text-gray-700 dark:text-gray-300">
              Требуется сопровождение
            </label>
          </div>
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal
        isOpen={deleteModal !== null}
        onClose={() => setDeleteModal(null)}
        title="Удалить пассажира"
        size="sm"
        footer={
            <>
              <button
              onClick={() => setDeleteModal(null)}
              className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              Отмена
            </button>
            <button
              onClick={handleDeletePassenger}
              className="px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
              >
              <Trash2 className="w-5 h-5" />
              Удалить
              </button>
            </>
        }
      >
        <div className="text-center py-4">
          <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-8 h-8 text-red-600 dark:text-red-400" />
              </div>
          <p className="text-gray-900 dark:text-gray-100 mb-2">
            Вы уверены, что хотите удалить этого пассажира?
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Это действие нельзя отменить.
                </p>
              </div>
      </Modal>

      {/* Call Modal */}
      <Modal
        isOpen={callModal !== null}
        onClose={() => setCallModal(null)}
        title="Позвонить пассажиру"
        size="sm"
        footer={
          callModal ? (
            <>
              <button
                onClick={() => setCallModal(null)}
                className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Отмена
              </button>
              <button className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2">
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
              <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                <Phone className="w-7 h-7 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1">
                <p className="dark:text-white mb-1">{callModal.name}</p>
                <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">{callModal.phone}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  👤 Пассажир
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

      {/* Import Modal */}
      <Modal
        isOpen={importModal}
        onClose={() => {
          setImportModal(false);
          setImportFile(null);
          setImportSkipErrors(true);
          setImportDryRun(false);
        }}
        title="Импорт пассажиров из Excel"
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
              onClick={handleImportPassengers}
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
                Режим валидации (не создавать пассажиров)
              </span>
            </label>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>Инструкция:</strong>
            </p>
            <ul className="text-sm text-blue-700 dark:text-blue-300 mt-2 space-y-1 list-disc list-inside">
              <li>Используйте шаблон, скачанный кнопкой "Скачать шаблон"</li>
              <li>Обязательные поля: Имя, Телефон, Регион, Категория инвалидности</li>
              <li>Категория инвалидности: I группа, II группа, III группа, Ребенок-инвалид</li>
              <li>Телефон должен быть уникальным</li>
              <li>Для "Разрешено сопровождение" используйте: Да/Нет, True/False, 1/0</li>
              <li>Для региона можно использовать название или ID</li>
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
