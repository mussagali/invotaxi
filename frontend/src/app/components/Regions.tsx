import { useState, useEffect, useMemo } from "react";
import { MapPin, Plus, Edit, Trash2, Loader2, AlertCircle, Search, X, Filter, ArrowUpDown, ArrowUp, ArrowDown, Copy, Download, CheckSquare, Square } from "lucide-react";
import { Region, RegionStats, City, regionsApi } from "../services/regions";
import { RegionModal } from "./RegionModal";
import { Cities } from "./Cities";
import { RegionsMapView } from "./RegionsMapView";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
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

interface RegionWithStats extends Region {
  stats?: RegionStats;
}

function regionNeedsReassign(stats?: RegionStats): boolean {
  if (!stats) return false;
  return stats.drivers > 0 || stats.passengers > 0;
}

function regionDeleteSummary(stats?: RegionStats): string | null {
  if (!stats) return null;
  const parts: string[] = [];
  if (stats.drivers > 0) parts.push(`${stats.drivers} водителей`);
  if (stats.passengers > 0) parts.push(`${stats.passengers} пассажиров`);
  if (stats.total_orders > 0) parts.push(`${stats.total_orders} заказов (район будет отвязан)`);
  if (!parts.length) return null;
  return parts.join(", ");
}

export function Regions() {
  const [regions, setRegions] = useState<RegionWithStats[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRegion, setEditingRegion] = useState<Region | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [regionToDelete, setRegionToDelete] = useState<RegionWithStats | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState<string>("");
  const [deleting, setDeleting] = useState(false);
  const [loadingStats, setLoadingStats] = useState<Set<string>>(new Set());
  
  // Массовые операции
  const [selectedRegionIds, setSelectedRegionIds] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkReassignTargetId, setBulkReassignTargetId] = useState<string>("");
  const [bulkDeleting, setBulkDeleting] = useState(false);
  
  // Фильтры и поиск
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCityId, setSelectedCityId] = useState<string>("all");
  const [boundaryType, setBoundaryType] = useState<string>("all"); // "all" | "radius" | "polygon" | "none"
  const [hasStatsFilter, setHasStatsFilter] = useState<string>("all"); // "all" | "with_drivers" | "with_passengers" | "with_orders"
  
  // Сортировка
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    loadRegions();
    loadCities();
  }, []);

  const loadCities = async () => {
    try {
      const citiesData = await regionsApi.getCities();
      // Фильтруем города с валидным ID
      const validCities = citiesData.filter(city => city.id && city.id.trim() !== '');
      console.log('Loaded cities for filters:', validCities);
      setCities(validCities);
    } catch (err) {
      console.error("Failed to load cities:", err);
    }
  };

  const loadRegions = async () => {
    setLoading(true);
    setError(null);
    try {
      const regionsData = await regionsApi.getRegions();
      console.log('Loaded regions:', regionsData);
      setRegions(regionsData);
      
      // Загружаем статистику для каждого региона
      loadStatsForRegions(regionsData);
    } catch (err: any) {
      let errorMessage = "Не удалось загрузить регионы";
      
      if (err.message) {
        errorMessage = err.message;
      } else if (err.response?.data) {
        const errorData = err.response.data;
        if (errorData.detail) {
          errorMessage = errorData.detail;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        }
      }
      
      setError(errorMessage);
      toast.error(errorMessage);
      console.error('Ошибка загрузки регионов:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadStatsForRegions = async (regionsList: Region[]) => {
    // Фильтруем регионы с валидным ID перед загрузкой статистики
    const validRegions = regionsList.filter(region => region.id && region.id.trim() !== '');
    for (const region of validRegions) {
      setLoadingStats((prev) => new Set(prev).add(region.id));
      try {
        const stats = await regionsApi.getRegionStats(region.id);
        setRegions((prev) =>
          prev.map((r) => (r.id === region.id ? { ...r, stats } : r))
        );
      } catch (err) {
        // Игнорируем ошибки статистики, не критично
        console.error(`Failed to load stats for region ${region.id}:`, err);
      } finally {
        setLoadingStats((prev) => {
          const next = new Set(prev);
          next.delete(region.id);
          return next;
        });
      }
    }
  };

  const handleAddClick = (e?: React.MouseEvent<HTMLButtonElement>) => {
    e?.preventDefault();
    e?.stopPropagation();
    setEditingRegion(null);
    setModalOpen(true);
  };

  const handleEditClick = (region: Region) => {
    setEditingRegion(region);
    setModalOpen(true);
  };

  const handleDuplicateClick = (region: Region) => {
    // Создаем копию региона с измененным названием и очищенным ID
    const duplicatedRegion = {
      ...region,
      id: "", // Очищаем ID для создания нового региона
      title: `${region.title} (копия)`,
    };
    setEditingRegion(duplicatedRegion as Region);
    setModalOpen(true);
  };

  const reassignCandidates = useMemo(() => {
    if (!regionToDelete) return [];
    return regions.filter((r) => r.id !== regionToDelete.id);
  }, [regions, regionToDelete]);

  const sameCityReassignCandidates = useMemo(() => {
    if (!regionToDelete) return [];
    return reassignCandidates.filter((r) => r.city.id === regionToDelete.city.id);
  }, [reassignCandidates, regionToDelete]);

  const pickDefaultReassignTarget = (region: Region): string => {
    const sameCity = regions.filter(
      (r) => r.id !== region.id && r.city.id === region.city.id,
    );
    if (sameCity.length > 0) return sameCity[0].id;
    const anyOther = regions.find((r) => r.id !== region.id);
    return anyOther?.id ?? "";
  };

  const formatDeleteSuccess = (title: string, result?: { reassigned_to_title?: string | null; drivers_reassigned?: number; passengers_reassigned?: number; orders_unlinked?: number }) => {
    if (!result) {
      return `Регион "${title}" удалён`;
    }
    const parts: string[] = [`Регион "${title}" удалён`];
    if ((result.drivers_reassigned ?? 0) > 0 || (result.passengers_reassigned ?? 0) > 0) {
      parts.push(
        `переназначено в «${result.reassigned_to_title ?? "другой регион"}»`,
      );
    }
    if ((result.orders_unlinked ?? 0) > 0) {
      parts.push(`отвязано заказов: ${result.orders_unlinked}`);
    }
    return parts.join(", ");
  };

  const handleDeleteClick = (region: RegionWithStats) => {
    setRegionToDelete(region);
    setReassignTargetId(pickDefaultReassignTarget(region));
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!regionToDelete) return;
    const stats = regionToDelete.stats;
    if (regionNeedsReassign(stats) && !reassignTargetId) {
      toast.error("Выберите регион для переназначения водителей и пассажиров");
      return;
    }
    setDeleting(true);
    try {
      const result = await regionsApi.deleteRegion(
        regionToDelete.id,
        reassignTargetId || undefined,
      );
      toast.success(formatDeleteSuccess(regionToDelete.title, result ?? undefined));
      setRegions((prev) => prev.filter((r) => r.id !== regionToDelete.id));
      setDeleteDialogOpen(false);
      setRegionToDelete(null);
      setReassignTargetId("");
    } catch (err: any) {
      let errorMessage = "Не удалось удалить регион";
      
      if (err.message) {
        errorMessage = err.message;
      } else if (err.response?.data) {
        const errorData = err.response.data;
        if (errorData.detail) {
          errorMessage = errorData.detail;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        } else if (typeof errorData === 'object') {
          const fieldErrors: string[] = [];
          for (const [field, messages] of Object.entries(errorData)) {
            if (Array.isArray(messages)) {
              fieldErrors.push(`${field}: ${messages.join(', ')}`);
            } else if (typeof messages === 'string') {
              fieldErrors.push(`${field}: ${messages}`);
            }
          }
          if (fieldErrors.length > 0) {
            errorMessage = fieldErrors.join('; ');
          }
        }
      }
      
      toast.error(errorMessage);
      console.error('Ошибка при удалении региона:', err);
    } finally {
      setDeleting(false);
    }
  };

  const handleModalSuccess = () => {
    loadRegions();
    const isDuplicating = editingRegion && !editingRegion.id;
    toast.success(
      isDuplicating
        ? "Регион успешно продублирован"
        : editingRegion
        ? "Регион успешно обновлен"
        : "Регион успешно создан"
    );
  };

  // Обработчик сортировки
  const handleSort = (field: string) => {
    if (sortField === field) {
      // Переключение направления сортировки
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      // Новая колонка для сортировки
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Функция получения иконки сортировки
  const getSortIcon = (field: string) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-4 h-4 ml-1 text-gray-400" />;
    }
    return sortDirection === "asc" 
      ? <ArrowUp className="w-4 h-4 ml-1 text-indigo-600" />
      : <ArrowDown className="w-4 h-4 ml-1 text-indigo-600" />;
  };

  // Фильтрация и сортировка регионов
  const filteredAndSortedRegions = useMemo(() => {
    let filtered = regions.filter((region) => {
      // Поиск по названию
      if (searchTerm && !region.title.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }

      // Фильтр по городу
      if (selectedCityId !== "all" && region.city.id !== selectedCityId) {
        return false;
      }

      // Фильтр по типу границ
      if (boundaryType !== "all") {
        if (boundaryType === "radius" && !region.service_radius_meters) {
          return false;
        }
        if (boundaryType === "polygon" && (!region.polygon_coordinates || region.polygon_coordinates.length < 3)) {
          return false;
        }
        if (boundaryType === "none" && (!region.service_radius_meters && (!region.polygon_coordinates || region.polygon_coordinates.length < 3))) {
          return false;
        }
      }

      // Фильтр по статистике
      if (hasStatsFilter !== "all") {
        if (!region.stats) return false;
        if (hasStatsFilter === "with_drivers" && region.stats.drivers === 0) {
          return false;
        }
        if (hasStatsFilter === "with_passengers" && region.stats.passengers === 0) {
          return false;
        }
        if (hasStatsFilter === "with_orders" && region.stats.total_orders === 0) {
          return false;
        }
      }

      return true;
    });

    // Сортировка
    if (sortField) {
      filtered = [...filtered].sort((a, b) => {
        let aValue: any;
        let bValue: any;

        switch (sortField) {
          case "title":
            aValue = a.title.toLowerCase();
            bValue = b.title.toLowerCase();
            break;
          case "city":
            aValue = a.city.title.toLowerCase();
            bValue = b.city.title.toLowerCase();
            break;
          case "drivers":
            aValue = a.stats?.drivers ?? 0;
            bValue = b.stats?.drivers ?? 0;
            break;
          case "passengers":
            aValue = a.stats?.passengers ?? 0;
            bValue = b.stats?.passengers ?? 0;
            break;
          case "orders":
            aValue = a.stats?.total_orders ?? 0;
            bValue = b.stats?.total_orders ?? 0;
            break;
          default:
            return 0;
        }

        if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
        if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [regions, searchTerm, selectedCityId, boundaryType, hasStatsFilter, sortField, sortDirection]);

  const filteredRegions = filteredAndSortedRegions;

  // Вычисляем общую статистику
  const totalStats = regions.reduce(
    (acc, region) => {
      if (region.stats) {
        acc.drivers += region.stats.drivers;
        acc.passengers += region.stats.passengers;
        acc.activeOrders += region.stats.active_orders;
        acc.totalOrders += region.stats.total_orders;
      }
      return acc;
    },
    { drivers: 0, passengers: 0, activeOrders: 0, totalOrders: 0 }
  );

  // Сброс фильтров
  const resetFilters = () => {
    setSearchTerm("");
    setSelectedCityId("all");
    setBoundaryType("all");
    setHasStatsFilter("all");
  };

  const hasActiveFilters = searchTerm || selectedCityId !== "all" || boundaryType !== "all" || hasStatsFilter !== "all";

  // Обработчики массовых операций
  const toggleRegionSelection = (regionId: string) => {
    setSelectedRegionIds((prev) => {
      const next = new Set(prev);
      if (next.has(regionId)) {
        next.delete(regionId);
      } else {
        next.add(regionId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedRegionIds.size === filteredRegions.length) {
      setSelectedRegionIds(new Set());
    } else {
      setSelectedRegionIds(new Set(filteredRegions.map((r) => r.id)));
    }
  };

  const selectedRegionsNeedReassign = useMemo(() => {
    return filteredRegions.filter(
      (r) => selectedRegionIds.has(r.id) && regionNeedsReassign(r.stats),
    );
  }, [filteredRegions, selectedRegionIds]);

  const handleBulkDelete = async () => {
    if (selectedRegionIds.size === 0) return;

    if (selectedRegionsNeedReassign.length > 0 && !bulkReassignTargetId) {
      toast.error("Выберите регион для переназначения водителей и пассажиров");
      return;
    }

    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedRegionIds);
      let successCount = 0;
      const errors: string[] = [];

      for (const id of ids) {
        const region = regions.find((r) => r.id === id);
        const reassignTo =
          region && regionNeedsReassign(region.stats)
            ? bulkReassignTargetId || pickDefaultReassignTarget(region)
            : undefined;
        try {
          await regionsApi.deleteRegion(id, reassignTo || undefined);
          successCount += 1;
        } catch (err: any) {
          const msg =
            err.response?.data?.detail ||
            err.message ||
            `не удалось удалить ${id}`;
          errors.push(msg);
        }
      }

      if (successCount > 0) {
        toast.success(`Удалено регионов: ${successCount}`);
        setRegions((prev) => prev.filter((r) => !selectedRegionIds.has(r.id)));
      }

      if (errors.length > 0) {
        toast.error(errors[0]);
      }

      setSelectedRegionIds(new Set());
      setBulkDeleteDialogOpen(false);
      setBulkReassignTargetId("");
    } catch (err: any) {
      toast.error(err.message || "Ошибка при массовом удалении");
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleExportSelected = () => {
    if (selectedRegionIds.size === 0) {
      toast.error("Выберите регионы для экспорта");
      return;
    }

    const selectedRegions = filteredRegions.filter((r) => selectedRegionIds.has(r.id));
    const exportData = JSON.stringify(selectedRegions, null, 2);
    const blob = new Blob([exportData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `regions_export_${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Экспортировано регионов: ${selectedRegionIds.size}`);
  };

  const handleExportAll = () => {
    const exportData = JSON.stringify(filteredRegions, null, 2);
    const blob = new Blob([exportData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `regions_export_all_${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Экспортировано регионов: ${filteredRegions.length}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl text-gray-900 dark:text-white">
            Управление регионами
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Просмотр и настройка регионов обслуживания
          </p>
        </div>
      </div>

      <Tabs defaultValue="regions" className="w-full">
        <TabsList>
          <TabsTrigger value="regions">Регионы</TabsTrigger>
          <TabsTrigger value="cities">Города</TabsTrigger>
          <TabsTrigger value="map">Карта</TabsTrigger>
        </TabsList>

        <TabsContent value="regions" className="space-y-6 mt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl text-gray-900 dark:text-white">
                Управление регионами
              </h2>
            </div>
            <Button
              type="button"
              onClick={handleAddClick}
              className="bg-indigo-600 text-white hover:bg-indigo-700"
            >
              <Plus className="w-5 h-5 mr-2" />
              Добавить регион
            </Button>
          </div>

          {/* Поиск и фильтры */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex flex-col md:flex-row gap-4">
              {/* Поиск */}
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Поиск по названию региона..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-10"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm("")}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Фильтр по городу */}
              <div className="w-full md:w-48">
                <Select value={selectedCityId} onValueChange={setSelectedCityId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Все города" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все города</SelectItem>
                    {cities.filter(city => city.id && city.id.trim() !== '').map((city) => (
                      <SelectItem key={city.id} value={city.id}>
                        {city.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Фильтр по типу границ */}
              <div className="w-full md:w-48">
                <Select value={boundaryType} onValueChange={setBoundaryType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Тип границ" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все типы</SelectItem>
                    <SelectItem value="radius">Радиус</SelectItem>
                    <SelectItem value="polygon">Полигон</SelectItem>
                    <SelectItem value="none">Без границ</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Фильтр по статистике */}
              <div className="w-full md:w-56">
                <Select value={hasStatsFilter} onValueChange={setHasStatsFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Статистика" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все регионы</SelectItem>
                    <SelectItem value="with_drivers">С водителями</SelectItem>
                    <SelectItem value="with_passengers">С пассажирами</SelectItem>
                    <SelectItem value="with_orders">С заказами</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Кнопка сброса фильтров */}
              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetFilters}
                  className="whitespace-nowrap"
                >
                  <X className="w-4 h-4 mr-2" />
                  Сбросить
                </Button>
              )}
            </div>

            {/* Информация о результатах фильтрации */}
            {hasActiveFilters && (
              <div className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                Найдено регионов: {filteredRegions.length} из {regions.length}
              </div>
            )}
          </div>

          {/* Панель массовых операций */}
          {selectedRegionIds.size > 0 && (
            <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-indigo-900 dark:text-indigo-100">
                  Выбрано регионов: {selectedRegionIds.size}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleExportSelected}
                  className="bg-white dark:bg-gray-800"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Экспортировать выбранные
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const first = selectedRegionsNeedReassign[0];
                    setBulkReassignTargetId(
                      first ? pickDefaultReassignTarget(first) : "",
                    );
                    setBulkDeleteDialogOpen(true);
                  }}
                  className="bg-white dark:bg-gray-800 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Удалить выбранные
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedRegionIds(new Set())}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Всего регионов
              </p>
              <p className="text-3xl mt-2 text-gray-900 dark:text-white">
                {loading ? (
                  <Loader2 className="w-8 h-8 animate-spin" />
                ) : (
                  regions.length
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
          {loading && regions.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
              <span className="ml-3 text-gray-600 dark:text-gray-400">
                Загрузка регионов...
              </span>
            </div>
          )}

          {/* Empty State */}
          {!loading && regions.length === 0 && !error && (
            <div className="bg-white dark:bg-gray-800 rounded-lg p-12 text-center border border-gray-200 dark:border-gray-700">
              <MapPin className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Нет регионов
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Создайте первый регион для начала работы
              </p>
              <Button type="button" onClick={handleAddClick} className="bg-indigo-600 hover:bg-indigo-700">
                <Plus className="w-5 h-5 mr-2" />
                Добавить регион
              </Button>
            </div>
          )}

          {/* Empty Filter State */}
          {!loading && regions.length > 0 && filteredRegions.length === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg p-12 text-center border border-gray-200 dark:border-gray-700">
              <Filter className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Регионы не найдены
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Попробуйте изменить параметры фильтрации
              </p>
              <Button type="button" onClick={resetFilters} variant="outline">
                <X className="w-5 h-5 mr-2" />
                Сбросить фильтры
              </Button>
            </div>
          )}

          {/* Regions Table */}
          {!loading && filteredRegions.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 w-12">
                        <button
                          onClick={toggleSelectAll}
                          className="flex items-center justify-center"
                          title={selectedRegionIds.size === filteredRegions.length ? "Снять выделение" : "Выделить все"}
                        >
                          {selectedRegionIds.size === filteredRegions.length && filteredRegions.length > 0 ? (
                            <CheckSquare className="w-5 h-5 text-indigo-600" />
                          ) : (
                            <Square className="w-5 h-5 text-gray-400" />
                          )}
                        </button>
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        ID
                      </th>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                        onClick={() => handleSort("title")}
                      >
                        <div className="flex items-center">
                          Название
                          {getSortIcon("title")}
                        </div>
                      </th>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                        onClick={() => handleSort("city")}
                      >
                        <div className="flex items-center">
                          Город
                          {getSortIcon("city")}
                        </div>
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Координаты
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Радиус/Полигон
                      </th>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                        onClick={() => handleSort("drivers")}
                      >
                        <div className="flex items-center">
                          Водители
                          {getSortIcon("drivers")}
                        </div>
                      </th>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                        onClick={() => handleSort("passengers")}
                      >
                        <div className="flex items-center">
                          Пассажиры
                          {getSortIcon("passengers")}
                        </div>
                      </th>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                        onClick={() => handleSort("orders")}
                      >
                        <div className="flex items-center">
                          Заказы
                          {getSortIcon("orders")}
                        </div>
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Действия
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {filteredRegions.map((region) => (
                      <tr
                        key={region.id}
                        className={`hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                          selectedRegionIds.has(region.id) ? "bg-indigo-50 dark:bg-indigo-900/20" : ""
                        }`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() => toggleRegionSelection(region.id)}
                            className="flex items-center justify-center"
                            title={selectedRegionIds.has(region.id) ? "Снять выделение" : "Выделить"}
                          >
                            {selectedRegionIds.has(region.id) ? (
                              <CheckSquare className="w-5 h-5 text-indigo-600" />
                            ) : (
                              <Square className="w-5 h-5 text-gray-400" />
                            )}
                          </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                          {region.id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-indigo-600" />
                            {region.title}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {region.city.title}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          <div>
                            <div>{region.center.lat.toFixed(4)}, {region.center.lon.toFixed(4)}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {region.service_radius_meters ? (
                            <span className="inline-flex items-center px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                              Радиус: {region.service_radius_meters}м
                            </span>
                          ) : region.polygon_coordinates && region.polygon_coordinates.length > 0 ? (
                            <span className="inline-flex items-center px-2 py-1 rounded-md bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
                              Полигон: {region.polygon_coordinates.length} точек
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {loadingStats.has(region.id) ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            region.stats?.drivers ?? "-"
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {loadingStats.has(region.id) ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            region.stats?.passengers ?? "-"
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {loadingStats.has(region.id) ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <div>
                              <div className="text-blue-600">{region.stats?.active_orders ?? 0}</div>
                              <div className="text-xs text-gray-500">из {region.stats?.total_orders ?? 0}</div>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleEditClick(region)}
                              className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
                              title="Редактировать"
                            >
                              <Edit className="w-5 h-5" />
                            </button>
                            <button
                              onClick={() => handleDuplicateClick(region)}
                              className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                              title="Дублировать"
                            >
                              <Copy className="w-5 h-5" />
                            </button>
                            <button
                              onClick={() => handleDeleteClick(region)}
                              className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                              title="Удалить регион (с отвязкой и переназначением при необходимости)"
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

          {/* Кнопка экспорта всех регионов */}
          {!loading && filteredRegions.length > 0 && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={handleExportAll}
                className="bg-white dark:bg-gray-800"
              >
                <Download className="w-4 h-4 mr-2" />
                Экспортировать все ({filteredRegions.length})
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="cities" className="mt-6">
          <Cities />
        </TabsContent>

        <TabsContent value="map" className="mt-6">
          <RegionsMapView regions={filteredRegions} onRegionClick={handleEditClick} />
        </TabsContent>
      </Tabs>

      {/* Region Modal */}
      <RegionModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        region={editingRegion}
        onSuccess={handleModalSuccess}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Подтвердите удаление</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Будет удалена только запись региона «{regionToDelete?.title}».
                </p>
                {regionDeleteSummary(regionToDelete?.stats) && (
                  <p className="text-amber-700 dark:text-amber-300">
                    Привязано: {regionDeleteSummary(regionToDelete?.stats)}.
                  </p>
                )}
                {regionNeedsReassign(regionToDelete?.stats) && (
                  <div className="space-y-2">
                    <p>Водители и пассажиры будут переназначены в регион:</p>
                    <Select value={reassignTargetId} onValueChange={setReassignTargetId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите регион" />
                      </SelectTrigger>
                      <SelectContent>
                        {(sameCityReassignCandidates.length > 0
                          ? sameCityReassignCandidates
                          : reassignCandidates
                        ).map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.title} ({r.city.title})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {!regionNeedsReassign(regionToDelete?.stats) &&
                  regionToDelete?.stats?.total_orders ? (
                  <p>Заказы останутся в системе, район у них будет отвязан.</p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={
                deleting ||
                (regionNeedsReassign(regionToDelete?.stats) && !reassignTargetId)
              }
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50"
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

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Подтвердите массовое удаление</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Удалить {selectedRegionIds.size} выбранных регионов? Это действие нельзя отменить.
                </p>
                {selectedRegionsNeedReassign.length > 0 && (
                  <div className="space-y-2">
                    <p>
                      У {selectedRegionsNeedReassign.length} регион(ов) есть водители или пассажиры —
                      они будут переназначены в:
                    </p>
                    <Select value={bulkReassignTargetId} onValueChange={setBulkReassignTargetId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите регион" />
                      </SelectTrigger>
                      <SelectContent>
                        {regions
                          .filter((r) => !selectedRegionIds.has(r.id))
                          .map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.title} ({r.city.title})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <p>Заказы останутся в системе, район у них будет отвязан.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={
                bulkDeleting ||
                (selectedRegionsNeedReassign.length > 0 && !bulkReassignTargetId)
              }
              className="bg-red-600 hover:bg-red-700"
            >
              {bulkDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Удаление...
                </>
              ) : (
                "Удалить выбранные"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
