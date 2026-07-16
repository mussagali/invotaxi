import { useEffect, useRef, useState } from "react";
import { Region } from "../services/regions";
import { MapPin, Loader2 } from "lucide-react";
import { loadYmaps } from "../../shared/yandex/loadYmaps";

interface RegionsMapViewProps {
  regions: Region[];
  onRegionClick?: (region: Region) => void;
  defaultZoom?: number;
}

export function RegionsMapView({
  regions,
  onRegionClick,
  defaultZoom = 10,
}: RegionsMapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<ymaps.Map | null>(null);
  const geoObjectsRef = useRef<any[]>([]);
  const [mapInitialized, setMapInitialized] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => { loadYmaps().then(() => setReady(true)).catch(console.error); }, []);

  useEffect(() => {
    if (!ready || mapInstanceRef.current) return;

    const initializeMap = () => {
      if (!mapRef.current || mapInstanceRef.current) return;
      let centerLat = 47.10869114222083;
      let centerLon = 51.9049072265625;
      if (regions.length > 0) {
        centerLat = regions.reduce((sum, r) => sum + r.center_lat, 0) / regions.length;
        centerLon = regions.reduce((sum, r) => sum + r.center_lon, 0) / regions.length;
      }
      try {
        mapInstanceRef.current = new ymaps.Map(mapRef.current, {
          center: [centerLat, centerLon],
          zoom: defaultZoom,
          controls: ["zoomControl"],
        });
        setTimeout(() => setMapInitialized(true), 200);
      } catch (error) {
        console.error("Ошибка инициализации карты:", error);
        setMapInitialized(true);
      }
    };

    if (mapRef.current) initializeMap();
    else {
      const timer = setTimeout(initializeMap, 100);
      return () => clearTimeout(timer);
    }

    return () => {
      if (mapInstanceRef.current) { mapInstanceRef.current.destroy(); mapInstanceRef.current = null; setMapInitialized(false); }
    };
  }, [ready]);

  useEffect(() => {
    if (!mapInstanceRef.current || !mapInitialized || regions.length === 0) return;
    const avgLat = regions.reduce((sum, r) => sum + r.center_lat, 0) / regions.length;
    const avgLon = regions.reduce((sum, r) => sum + r.center_lon, 0) / regions.length;
    mapInstanceRef.current.setCenter([avgLat, avgLon], defaultZoom);
  }, [regions.length, mapInitialized, defaultZoom]);

  useEffect(() => {
    if (!mapInstanceRef.current || !mapInitialized) return;
    geoObjectsRef.current.forEach((obj) => mapInstanceRef.current!.geoObjects.remove(obj));
    geoObjectsRef.current = [];

    regions.forEach((region) => {
      if (!mapInstanceRef.current) return;
      const position = [region.center_lat, region.center_lon];
      const popupContent = `<div style="min-width:200px;"><h3 style="margin:0 0 8px 0;font-weight:600;color:#1f2937;">${region.title}</h3><p style="margin:4px 0;font-size:12px;color:#6b7280;">Город: ${region.city.title}</p><p style="margin:4px 0;font-size:12px;color:#6b7280;">ID: ${region.id}</p><p style="margin:4px 0;font-size:12px;color:#6b7280;">Координаты: ${region.center_lat.toFixed(4)}, ${region.center_lon.toFixed(4)}</p>${region.service_radius_meters ? `<p style="margin:4px 0;font-size:12px;color:#6b7280;">Радиус: ${region.service_radius_meters} м</p>` : ""}${region.polygon_coordinates && region.polygon_coordinates.length > 0 ? `<p style="margin:4px 0;font-size:12px;color:#6b7280;">Полигон: ${region.polygon_coordinates.length} точек</p>` : ""}</div>`;

      const marker = new ymaps.Placemark(position, { balloonContent: popupContent }, { preset: "islands#blueCircleDotIcon" });
      marker.events.add("click", () => onRegionClick?.(region));
      mapInstanceRef.current.geoObjects.add(marker);
      geoObjectsRef.current.push(marker);

      if (region.polygon_coordinates && region.polygon_coordinates.length >= 3) {
        const polygon = new ymaps.Polygon(
          [region.polygon_coordinates.map((p) => [p[0], p[1]])],
          { balloonContent: popupContent },
          { fillColor: "rgba(59,130,246,0.2)", strokeColor: "#3b82f6", strokeWidth: 2 }
        );
        polygon.events.add("click", () => onRegionClick?.(region));
        mapInstanceRef.current.geoObjects.add(polygon);
        geoObjectsRef.current.push(polygon);
      }

      if (region.service_radius_meters && region.service_radius_meters > 0) {
        if (!region.polygon_coordinates || region.polygon_coordinates.length < 3) {
          const circle = new ymaps.Circle(
            [position, region.service_radius_meters],
            { balloonContent: popupContent },
            { fillColor: "rgba(59,130,246,0.2)", strokeColor: "#3b82f6", strokeWidth: 2 }
          );
          circle.events.add("click", () => onRegionClick?.(region));
          mapInstanceRef.current.geoObjects.add(circle);
          geoObjectsRef.current.push(circle);
        }
      }
    });
  }, [regions, onRegionClick, mapInitialized]);

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-xl mb-4 text-gray-900 dark:text-white">Карта регионов</h2>
        {regions.length > 0 && (
          <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2"><strong>Легенда:</strong></p>
            <div className="flex flex-wrap gap-4 text-xs text-gray-600 dark:text-gray-400">
              <div className="flex items-center gap-2"><div className="w-4 h-4 bg-blue-500 rounded-full"></div><span>Маркер центра региона</span></div>
              <div className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-blue-500 rounded-full" style={{ backgroundColor: "rgba(59, 130, 246, 0.2)" }}></div><span>Круг радиуса обслуживания</span></div>
              <div className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-blue-500" style={{ backgroundColor: "rgba(59, 130, 246, 0.2)" }}></div><span>Полигон границ региона</span></div>
            </div>
          </div>
        )}
        <div className="relative w-full h-[600px] rounded-lg">
          {!mapInitialized && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-lg z-10">
              <div className="text-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto mb-2" /><p className="text-gray-600 dark:text-gray-400">Загрузка карты...</p></div>
            </div>
          )}
          {regions.length === 0 && mapInitialized && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-lg z-10 pointer-events-none">
              <div className="text-center text-gray-500 dark:text-gray-400"><MapPin className="w-16 h-16 mx-auto mb-2 opacity-50" /><p>Нет регионов для отображения</p></div>
            </div>
          )}
          <div ref={mapRef} className="w-full h-full rounded-lg" />
        </div>
        {regions.length > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Кликните на маркер, круг или полигон региона для просмотра информации и редактирования</p>
        )}
      </div>
    </div>
  );
}
