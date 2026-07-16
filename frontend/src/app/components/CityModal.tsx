import { useState, useEffect } from "react";
import { Modal } from "./Modal";
import { Save } from "lucide-react";
import { City, CreateCityData, UpdateCityData } from "../services/regions";
import { regionsApi } from "../services/regions";
import { MapCoordinatePicker } from "./MapCoordinatePicker";

interface CityModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  city?: City | null;
  onSuccess: () => void;
}

export function CityModal({ open, onOpenChange, city, onSuccess }: CityModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    id: "",
    title: "",
    center_lat: "",
    center_lon: "",
  });

  const [mapLat, setMapLat] = useState(43.238949);
  const [mapLon, setMapLon] = useState(76.945833);

  // Загрузка данных города при открытии модального окна
  useEffect(() => {
    if (open) {
      if (city) {
        // Редактирование существующего города
        setFormData({
          id: city.id,
          title: city.title,
          center_lat: city.center_lat.toString(),
          center_lon: city.center_lon.toString(),
        });
        setMapLat(city.center_lat);
        setMapLon(city.center_lon);
      } else {
        // Создание нового города - координаты Атырау по умолчанию
        const defaultLat = 47.10869114222083;
        const defaultLon = 51.9049072265625;
        setFormData({
          id: "",
          title: "",
          center_lat: defaultLat.toString(),
          center_lon: defaultLon.toString(),
        });
        setMapLat(defaultLat);
        setMapLon(defaultLon);
      }
      setError(null);
    }
  }, [open, city]);

  const handleMapCoordinateChange = (lat: number, lon: number) => {
    setMapLat(lat);
    setMapLon(lon);
    setFormData({
      ...formData,
      center_lat: lat.toString(),
      center_lon: lon.toString(),
    });
  };

  const validateForm = (): boolean => {
    if (!formData.title.trim()) {
      setError("Название города обязательно");
      return false;
    }
    const lat = parseFloat(formData.center_lat);
    const lon = parseFloat(formData.center_lon);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      setError("Широта должна быть числом от -90 до 90");
      return false;
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      setError("Долгота должна быть числом от -180 до 180");
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

      if (city) {
        // Обновление города
        const updateData: UpdateCityData = {
          title: formData.title,
          center_lat: lat,
          center_lon: lon,
        };
        await regionsApi.updateCity(city.id, updateData);
      } else {
        // Создание города
        const createData: CreateCityData = {
          id: formData.id || undefined,
          title: formData.title,
          center_lat: lat,
          center_lon: lon,
        };
        await regionsApi.createCity(createData);
      }

      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || "Произошла ошибка при сохранении города");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title={city ? "Редактировать город" : "Добавить город"}
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
            disabled={loading}
          >
            <Save className="w-5 h-5" />
            {loading ? "Сохранение..." : city ? "Сохранить" : "Создать"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {!city && (
          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">ID города (опционально)</label>
            <input
              type="text"
              placeholder="CT001"
              value={formData.id}
              onChange={(e) =>
                setFormData({ ...formData, id: e.target.value })
              }
              disabled={loading}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Если не указано, будет сгенерировано автоматически
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
            Название города <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder="Алматы"
            value={formData.title}
            onChange={(e) =>
              setFormData({ ...formData, title: e.target.value })
            }
            required
            disabled={loading}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
          />
        </div>

        <div>
          <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
            Координаты центра <span className="text-red-500">*</span>
          </label>
          <MapCoordinatePicker
            initialLat={mapLat}
            initialLon={mapLon}
            onCoordinateChange={handleMapCoordinateChange}
            height="300px"
          />
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
              onChange={(e) =>
                setFormData({ ...formData, center_lat: e.target.value })
              }
              onBlur={() => {
                const lat = parseFloat(formData.center_lat);
                if (!isNaN(lat)) {
                  setMapLat(lat);
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
              onChange={(e) =>
                setFormData({ ...formData, center_lon: e.target.value })
              }
              onBlur={() => {
                const lon = parseFloat(formData.center_lon);
                if (!isNaN(lon)) {
                  setMapLon(lon);
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

        {error && (
          <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
