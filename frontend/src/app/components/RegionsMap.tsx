import { useEffect, useRef, useState } from "react";
import { Region } from "../services/regions";
import { loadYmaps } from "../../shared/yandex/loadYmaps";

interface RegionsMapProps {
  regions: Region[];
  selectedRegionId?: string | null;
  onRegionSelect?: (regionId: string) => void;
  defaultZoom?: number;
  serviceRadius?: number;
}

export function RegionsMap({
  regions,
  selectedRegionId,
  onRegionSelect,
  defaultZoom = 10,
  serviceRadius = 10000,
}: RegionsMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<ymaps.Map | null>(null);
  const geoObjectsRef = useRef<any[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => { loadYmaps().then(() => setReady(true)).catch(console.error); }, []);

  useEffect(() => {
    if (!ready || mapInstanceRef.current) return;
    if (!mapRef.current) return;

    let centerLat = 43.238949;
    let centerLon = 76.945833;
    if (regions.length > 0) {
      centerLat = regions.reduce((sum, r) => sum + r.center_lat, 0) / regions.length;
      centerLon = regions.reduce((sum, r) => sum + r.center_lon, 0) / regions.length;
    }

    mapInstanceRef.current = new ymaps.Map(mapRef.current, {
      center: [centerLat, centerLon],
      zoom: defaultZoom,
      controls: ["zoomControl"],
    });

    return () => {
      if (mapInstanceRef.current) { mapInstanceRef.current.destroy(); mapInstanceRef.current = null; }
    };
  }, [ready]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    geoObjectsRef.current.forEach((obj) => mapInstanceRef.current!.geoObjects.remove(obj));
    geoObjectsRef.current = [];

    regions.forEach((region) => {
      if (!mapInstanceRef.current) return;
      const position = [region.center_lat, region.center_lon];
      const popupContent = `<div><h3 style="margin:0 0 8px 0;font-weight:600;">${region.title}</h3>${region.city ? `<p style="font-size:12px;color:#6b7280;">Город: ${region.city.title}</p>` : ""}<p style="font-size:12px;color:#6b7280;">ID: ${region.id}</p><p style="font-size:12px;color:#6b7280;">Координаты: ${region.center_lat.toFixed(4)}, ${region.center_lon.toFixed(4)}</p></div>`;

      const marker = new ymaps.Placemark(position, { balloonContent: popupContent }, { preset: "islands#blueCircleDotIcon" });
      marker.events.add("click", () => onRegionSelect?.(region.id));
      mapInstanceRef.current.geoObjects.add(marker);
      geoObjectsRef.current.push(marker);

      const circle = new ymaps.Circle(
        [position, serviceRadius],
        {},
        { fillColor: "rgba(59,130,246,0.2)", strokeColor: "#3b82f6", strokeWidth: 2 }
      );
      mapInstanceRef.current.geoObjects.add(circle);
      geoObjectsRef.current.push(circle);
    });
  }, [regions, serviceRadius, onRegionSelect]);

  useEffect(() => {
    if (!mapInstanceRef.current || !selectedRegionId) return;
    const selectedRegion = regions.find((r) => r.id === selectedRegionId);
    if (selectedRegion) {
      mapInstanceRef.current.setCenter([selectedRegion.center_lat, selectedRegion.center_lon], defaultZoom + 2);
    }
  }, [selectedRegionId, regions, defaultZoom]);

  if (regions.length === 0) {
    return (
      <div className="w-full h-full rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
        <div className="text-center text-gray-500 dark:text-gray-400"><p>Нет регионов для отображения</p></div>
      </div>
    );
  }

  return <div ref={mapRef} className="w-full h-full rounded-lg" />;
}
