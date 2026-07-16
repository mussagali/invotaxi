import { useState, useEffect, useCallback, useMemo } from "react";
import { Modal } from "./Modal";
import { Save } from "lucide-react";
import { Region, City, CreateRegionData, UpdateRegionData } from "../services/regions";
import { regionsApi } from "../services/regions";
import { MapCoordinatePicker } from "./MapCoordinatePicker";

interface RegionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  region?: Region | null;
  onSuccess: () => void;
}

export function RegionModal({ open, onOpenChange, region, onSuccess }: RegionModalProps) {
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    id: "",
    title: "",
    city_id: "",
    center_lat: "",
    center_lon: "",
    service_radius_meters: "",
  });

  const [mapLat, setMapLat] = useState(43.238949);
  const [mapLon, setMapLon] = useState(76.945833);

  // Определяем, является ли это дублированием (регион с пустым id)
  const isDuplicating = useMemo(() => region && !region.id, [region]);

  const loadCities = useCallback(async () => {
    setLoadingCities(true);
    setError(null);
    try {
      const citiesData = await regionsApi.getCities();
      setCities(citiesData);
    } catch (err) {
      console.error('Error loading cities:', err);
      setError("Не удалось загрузить список городов");
    } finally {
      setLoadingCities(false);
    }
  }, []);

  // Загрузка городов при открытии модального окна
  useEffect(() => {
    if (open) {
      loadCities();
      if (region) {
        // Редактирование существующего региона или дублирование
        setFormData({
          id: isDuplicating ? "" : region.id, // Очищаем ID при дублировании
          title: region.title,
          city_id: region.city.id,
          center_lat: region.center_lat.toString(),
          center_lon: region.center_lon.toString(),
          service_radius_meters: region.service_radius_meters?.toString() || "",
        });
        setMapLat(region.center_lat);
        setMapLon(region.center_lon);
      } else {
        // Создание нового региона
        // Координаты Атырау по умолчанию
        const defaultLat = 47.10869114222083;
        const defaultLon = 51.9049072265625;
        setFormData({
          id: "",
          title: "",
          city_id: "",
          center_lat: defaultLat.toString(),
          center_lon: defaultLon.toString(),
          service_radius_meters: "",
        });
        setMapLat(defaultLat);
        setMapLon(defaultLon);
      }
      setError(null);
    }
  }, [open, region, isDuplicating, loadCities]);

  // Установка Атырау по умолчанию после загрузки городов (только при создании нового региона)
  useEffect(() => {
    if (open && !region && cities.length > 0) {
      setFormData(prev => {
        // Проверяем, не установлен ли уже город
        if (prev.city_id) {
          return prev;
        }
        
        // Ищем город Атырау
        const atyrauCity = cities.find(city => 
          city.title.toLowerCase().includes('атырау') || 
          city.title.toLowerCase().includes('atyrau')
        );
        
        if (atyrauCity) {
          // Устанавливаем координаты города на карту
          setMapLat(atyrauCity.center_lat);
          setMapLon(atyrauCity.center_lon);
          return {
            ...prev,
            city_id: atyrauCity.id,
            center_lat: atyrauCity.center_lat.toString(),
            center_lon: atyrauCity.center_lon.toString(),
          };
        } else if (cities.length > 0) {
          // Если Атырау не найден, берем первый город
          const firstCity = cities[0];
          setMapLat(firstCity.center_lat);
          setMapLon(firstCity.center_lon);
          return {
            ...prev,
            city_id: firstCity.id,
            center_lat: firstCity.center_lat.toString(),
            center_lon: firstCity.center_lon.toString(),
          };
        }
        
        return prev;
      });
    }
  }, [open, cities, region]);

  const handleMapCoordinateChange = useCallback((lat: number, lon: number) => {
    setMapLat(lat);
    setMapLon(lon);
    setFormData(prev => ({
      ...prev,
      center_lat: lat.toString(),
      center_lon: lon.toString(),
    }));
  }, []);

  const validateForm = (): boolean => {
    const errors: string[] = [];

    // Валидация названия
    if (!formData.title.trim()) {
      errors.push("Название региона обязательно для заполнения");
    } else if (formData.title.trim().length < 2) {
      errors.push("Название региона должно содержать минимум 2 символа");
    } else if (formData.title.trim().length > 100) {
      errors.push("Название региона не должно превышать 100 символов");
    }

    // Валидация города
    if (!formData.city_id) {
      errors.push("Необходимо выбрать город");
    }

    // Валидация координат центра
    const lat = parseFloat(formData.center_lat);
    const lon = parseFloat(formData.center_lon);
    
    if (!formData.center_lat.trim()) {
      errors.push("Широта центра региона обязательна для заполнения");
    } else if (isNaN(lat)) {
      errors.push("Широта должна быть числом");
    } else if (lat < -90 || lat > 90) {
      errors.push("Широта должна быть в диапазоне от -90 до 90 градусов");
    }

    if (!formData.center_lon.trim()) {
      errors.push("Долгота центра региона обязательна для заполнения");
    } else if (isNaN(lon)) {
      errors.push("Долгота должна быть числом");
    } else if (lon < -180 || lon > 180) {
      errors.push("Долгота должна быть в диапазоне от -180 до 180 градусов");
    }

    // Валидация радиуса обслуживания
    if (formData.service_radius_meters) {
      const radius = parseFloat(formData.service_radius_meters);
      if (isNaN(radius)) {
        errors.push("Радиус обслуживания должен быть числом");
      } else if (radius <= 0) {
        errors.push("Радиус обслуживания должен быть положительным числом");
      } else if (radius > 100000) {
        errors.push("Радиус обслуживания не должен превышать 100 км (100000 метров)");
      }
    }

    // Валидация ID (если указан при создании)
    if (!region && formData.id) {
      if (formData.id.length > 50) {
        errors.push("ID региона не должен превышать 50 символов");
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(formData.id)) {
        errors.push("ID региона может содержать только буквы, цифры, дефисы и подчеркивания");
      }
    }

    if (errors.length > 0) {
      setError(errors.join(". "));
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    setError(null);

    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      const lat = parseFloat(formData.center_lat);
      const lon = parseFloat(formData.center_lon);
      
      const updateData: UpdateRegionData = {
        title: formData.title,
        city_id: formData.city_id,
        center_lat: lat,
        center_lon: lon,
      };

      if (formData.service_radius_meters) {
        updateData.service_radius_meters = parseFloat(formData.service_radius_meters);
      }

      if (region) {
        // Обновление региона
        await regionsApi.updateRegion(region.id, updateData);
      } else {
        // Создание региона
        const createData: CreateRegionData = {
          id: formData.id || undefined,
          ...updateData,
        } as CreateRegionData;
        await regionsApi.createRegion(createData);
      }

      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      // Улучшенная обработка ошибок
      let errorMessage = "Произошла ошибка при сохранении региона";
      
      if (err.message) {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      } else if (err.response?.data) {
        // Обработка ошибок от API
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
      
      setError(errorMessage);
      console.error('Ошибка при сохранении региона:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title={isDuplicating ? "Дублировать регион" : region ? "Редактировать регион" : "Добавить регион"}
      size="lg"
      footer={
        <>
          <button
            onClick={() => onOpenChange(false)}
            className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
            disabled={loading}
          >
            Отмена
          </button>
          <button
            onClick={handleSubmit}
            className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={loading || loadingCities}
          >
            <Save className="w-5 h-5" />
            {loading ? "Сохранение..." : region ? "Сохранить" : "Создать"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {!region && (
          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">ID региона (опционально)</label>
            <input
              type="text"
              placeholder="RG001"
              value={formData.id}
              onChange={(e) =>
                setFormData(prev => ({ ...prev, id: e.target.value }))
              }
              disabled={loading}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Если не указано, будет сгенерировано автоматически
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
              Название региона <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="Алматы"
              value={formData.title}
              onChange={(e) =>
                setFormData(prev => ({ ...prev, title: e.target.value }))
              }
              required
              disabled={loading}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
              Город <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.city_id}
              onChange={(e) => {
                const cityId = e.target.value;
                const selectedCity = cities.find(c => c.id === cityId);
                if (selectedCity) {
                  // Обновляем координаты на карте при выборе города только если это новый регион
                  // При редактировании сохраняем существующие координаты
                  if (!region) {
                    setMapLat(selectedCity.center_lat);
                    setMapLon(selectedCity.center_lon);
                    setFormData(prev => ({
                      ...prev,
                      city_id: cityId,
                      center_lat: selectedCity.center_lat.toString(),
                      center_lon: selectedCity.center_lon.toString(),
                    }));
                  } else {
                    // При редактировании только обновляем city_id, координаты не меняем
                    setFormData(prev => ({ ...prev, city_id: cityId }));
                  }
                } else {
                  setFormData(prev => ({ ...prev, city_id: cityId }));
                }
              }}
              disabled={loading || loadingCities}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">Выберите город</option>
              {cities.filter(city => city.id && city.id.trim() !== '').map((city) => (
                <option key={city.id} value={city.id}>
                  {city.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
            Координаты центра <span className="text-red-500">*</span>
          </label>
          <div className="relative z-0">
            <MapCoordinatePicker
              key={open ? `map-${mapLat}-${mapLon}` : 'map-hidden'}
              initialLat={mapLat}
              initialLon={mapLon}
              onCoordinateChange={handleMapCoordinateChange}
              serviceRadius={formData.service_radius_meters && formData.service_radius_meters.trim() !== '' 
                ? (() => {
                    const radius = parseFloat(formData.service_radius_meters);
                    return !isNaN(radius) && radius > 0 ? radius : undefined;
                  })()
                : undefined}
              height="300px"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Широта <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="any"
                placeholder="43.2220"
                value={formData.center_lat}
                onChange={(e) => {
                  const value = e.target.value;
                  setFormData(prev => ({ ...prev, center_lat: value }));
                  const lat = parseFloat(value);
                  if (!isNaN(lat) && lat >= -90 && lat <= 90) {
                    setMapLat(lat);
                  }
                }}
                onBlur={() => {
                  const lat = parseFloat(formData.center_lat);
                  if (!isNaN(lat) && lat >= -90 && lat <= 90) {
                    setMapLat(lat);
                  } else if (isNaN(lat) || lat < -90 || lat > 90) {
                    // Восстанавливаем предыдущее значение при ошибке
                    setFormData(prev => ({ ...prev, center_lat: mapLat.toString() }));
                  }
                }}
                required
                disabled={loading}
                min="-90"
                max="90"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Долгота <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="any"
                placeholder="76.8512"
                value={formData.center_lon}
                onChange={(e) => {
                  const value = e.target.value;
                  setFormData(prev => ({ ...prev, center_lon: value }));
                  const lon = parseFloat(value);
                  if (!isNaN(lon) && lon >= -180 && lon <= 180) {
                    setMapLon(lon);
                  }
                }}
                onBlur={() => {
                  const lon = parseFloat(formData.center_lon);
                  if (!isNaN(lon) && lon >= -180 && lon <= 180) {
                    setMapLon(lon);
                  } else if (isNaN(lon) || lon < -180 || lon > 180) {
                    // Восстанавливаем предыдущее значение при ошибке
                    setFormData(prev => ({ ...prev, center_lon: mapLon.toString() }));
                  }
                }}
                required
                disabled={loading}
                min="-180"
                max="180"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
          </div>

        <div>
          <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
            Радиус обслуживания (метры) (опционально)
          </label>
          <input
            type="number"
            step="any"
            placeholder="10000"
            value={formData.service_radius_meters}
            onChange={(e) => {
              const value = e.target.value;
              setFormData(prev => ({ ...prev, service_radius_meters: value }));
            }}
            disabled={loading}
            min="0"
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Радиус обслуживания от центра региона в метрах. Будет отображаться на карте как круг.
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
