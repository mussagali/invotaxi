import { useState, useEffect } from "react";
import { MapPin, Plus, Edit, Trash2, Loader2, AlertCircle } from "lucide-react";
import { City, CityStats, regionsApi } from "../services/regions";
import { CityModal } from "./CityModal";
import { Button } from "./ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { toast } from "sonner";

interface CityWithStats extends City {
  stats?: CityStats;
}

export function Cities() {
  const [cities, setCities] = useState<CityWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCity, setEditingCity] = useState<City | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [cityToDelete, setCityToDelete] = useState<City | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loadingStats, setLoadingStats] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadCities();
  }, []);

  const loadCities = async () => {
    setLoading(true);
    setError(null);
    try {
      const citiesData = await regionsApi.getCities();
      // Фильтруем города с валидным ID
      const validCities = citiesData.filter(city => city.id && city.id.trim() !== '');
      console.log('Loaded cities:', validCities);
      setCities(validCities);
      
      // Загружаем статистику для каждого города
      loadStatsForCities(validCities);
    } catch (err: any) {
      setError(err.message || "Не удалось загрузить города");
      toast.error("Ошибка загрузки городов");
    } finally {
      setLoading(false);
    }
  };

  const loadStatsForCities = async (citiesList: City[]) => {
    // Фильтруем города с валидным ID перед загрузкой статистики
    const validCities = citiesList.filter(city => city.id && city.id.trim() !== '');
    for (const city of validCities) {
      setLoadingStats((prev) => new Set(prev).add(city.id));
      try {
        const stats = await regionsApi.getCityStats(city.id);
        setCities((prev) =>
          prev.map((c) => (c.id === city.id ? { ...c, stats } : c))
        );
      } catch (err) {
        // Игнорируем ошибки статистики, не критично
        console.error(`Failed to load stats for city ${city.id}:`, err);
      } finally {
        setLoadingStats((prev) => {
          const next = new Set(prev);
          next.delete(city.id);
          return next;
        });
      }
    }
  };

  const handleAddClick = () => {
    setEditingCity(null);
    setModalOpen(true);
  };

  const handleEditClick = (city: City) => {
    setEditingCity(city);
    setModalOpen(true);
  };

  const handleDeleteClick = (city: City) => {
    setCityToDelete(city);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!cityToDelete) return;

    setDeleting(true);
    try {
      await regionsApi.deleteCity(cityToDelete.id);
      toast.success(`Город "${cityToDelete.title}" успешно удален`);
      setCities((prev) => prev.filter((c) => c.id !== cityToDelete.id));
      setDeleteDialogOpen(false);
      setCityToDelete(null);
    } catch (err: any) {
      toast.error(err.message || "Не удалось удалить город");
    } finally {
      setDeleting(false);
    }
  };

  const handleModalSuccess = () => {
    loadCities();
    toast.success(
      editingCity
        ? "Город успешно обновлен"
        : "Город успешно создан"
    );
  };

  // Вычисляем общую статистику
  const totalStats = cities.reduce(
    (acc, city) => {
      if (city.stats) {
        acc.regions += city.stats.regions;
        acc.drivers += city.stats.drivers;
        acc.passengers += city.stats.passengers;
        acc.activeOrders += city.stats.active_orders;
        acc.totalOrders += city.stats.total_orders;
      }
      return acc;
    },
    { regions: 0, drivers: 0, passengers: 0, activeOrders: 0, totalOrders: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl text-gray-900 dark:text-white">
            Управление городами
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Просмотр и настройка городов обслуживания
          </p>
        </div>
        <Button
          onClick={handleAddClick}
          className="bg-indigo-600 text-white hover:bg-indigo-700"
        >
          <Plus className="w-5 h-5 mr-2" />
          Добавить город
        </Button>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
          <div>
            <p className="text-red-800 dark:text-red-200 font-medium">
              Ошибка загрузки
            </p>
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            Всего городов
          </p>
          <p className="text-3xl mt-2 text-gray-900 dark:text-white">
            {loading ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : (
              cities.length
            )}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            Всего регионов
          </p>
          <p className="text-3xl mt-2 text-gray-900 dark:text-white">
            {loading ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : (
              totalStats.regions
            )}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            Всего водителей
          </p>
          <p className="text-3xl mt-2 text-gray-900 dark:text-white">
            {loading ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : (
              totalStats.drivers
            )}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            Всего пассажиров
          </p>
          <p className="text-3xl mt-2 text-gray-900 dark:text-white">
            {loading ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : (
              totalStats.passengers
            )}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            Активные заказы
          </p>
          <p className="text-3xl mt-2 text-gray-900 dark:text-white">
            {loading ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : (
              totalStats.activeOrders
            )}
          </p>
        </div>
      </div>

      {/* Loading State */}
      {loading && cities.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          <span className="ml-3 text-gray-600 dark:text-gray-400">
            Загрузка городов...
          </span>
        </div>
      )}

      {/* Empty State */}
      {!loading && cities.length === 0 && !error && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-12 text-center border border-gray-200 dark:border-gray-700">
          <MapPin className="w-16 h-16 mx-auto mb-4 text-gray-400" />
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Нет городов
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Создайте первый город для начала работы
          </p>
          <Button onClick={handleAddClick} className="bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-5 h-5 mr-2" />
            Добавить город
          </Button>
        </div>
      )}

      {/* Cities Table */}
      {!loading && cities.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Название
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Координаты центра
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Регионы
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Водители
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Пассажиры
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Заказы
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {cities.map((city) => (
                  <tr
                    key={city.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                      {city.id}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-indigo-600" />
                        {city.title}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                      {city.center.lat.toFixed(4)}, {city.center.lon.toFixed(4)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {loadingStats.has(city.id) ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        city.stats?.regions ?? "-"
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {loadingStats.has(city.id) ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        city.stats?.drivers ?? "-"
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {loadingStats.has(city.id) ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        city.stats?.passengers ?? "-"
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {loadingStats.has(city.id) ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <div>
                          <div className="text-blue-600">{city.stats?.active_orders ?? 0}</div>
                          <div className="text-xs text-gray-500">из {city.stats?.total_orders ?? 0}</div>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEditClick(city)}
                          className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
                          title="Редактировать"
                        >
                          <Edit className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => handleDeleteClick(city)}
                          className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                          title="Удалить"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* City Modal */}
      <CityModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        city={editingCity}
        onSuccess={handleModalSuccess}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Подтвердите удаление</AlertDialogTitle>
            <AlertDialogDescription>
              Вы уверены, что хотите удалить город "{cityToDelete?.title}"?
              Это действие нельзя отменить. Все регионы этого города также будут удалены.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Удаление...
                </>
              ) : (
                "Удалить"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
