import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { loadYmaps } from "../../shared/yandex/loadYmaps";
import { fetchRoadRouteForMap } from "../../shared/routing/roadRoute";

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

interface RouteMapViewProps {
  pickupLat: number;
  pickupLon: number;
  dropoffLat: number;
  dropoffLon: number;
  pickupTitle?: string;
  dropoffTitle?: string;
  distanceKm?: number;
  height?: string;
  orderId?: string;
}

export function RouteMapView({
  pickupLat, pickupLon, dropoffLat, dropoffLon,
  pickupTitle, dropoffTitle, distanceKm, height = "300px", orderId,
}: RouteMapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<ymaps.Map | null>(null);
  const pickupMarkerRef = useRef<ymaps.Placemark | null>(null);
  const dropoffMarkerRef = useRef<ymaps.Placemark | null>(null);
  const routeLineRef = useRef<ymaps.Polyline | null>(null);
  const [routeData, setRouteData] = useState<{ distance_km: number; duration_minutes?: number } | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { loadYmaps().then(() => setReady(true)).catch(console.error); }, []);

  const updateRouteOnMap = (routeCoordinates: Array<[number, number]>, straightFallback = false) => {
    if (!mapInstanceRef.current) return;
    if (routeLineRef.current) {
      mapInstanceRef.current.geoObjects.remove(routeLineRef.current);
      routeLineRef.current = null;
    }
    if (!routeCoordinates || routeCoordinates.length === 0) return;
    try {
      routeLineRef.current = new ymaps.Polyline(
        routeCoordinates,
        {},
        {
          strokeColor: "#3b82f6",
          strokeWidth: 4,
          opacity: straightFallback ? 0.5 : 0.85,
          strokeStyle: straightFallback ? "shortdash" : "solid",
        },
      );
      mapInstanceRef.current.geoObjects.add(routeLineRef.current);
      if (routeCoordinates.length > 1) {
        const bounds = routeLineRef.current.geometry.getBounds?.();
        if (bounds) mapInstanceRef.current.setBounds(bounds, { checkZoomRange: true, zoomMargin: 40 });
      }
    } catch (error) {
      console.error("Ошибка при добавлении маршрута на карту:", error);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const loadRoute = async () => {
      if (!mapInstanceRef.current) {
        setTimeout(() => { if (isMounted && mapInstanceRef.current) loadRoute(); }, 200);
        return;
      }
      setLoadingRoute(true);
      setRouteError(null);
      try {
        const roadRoute = await fetchRoadRouteForMap(
          [pickupLat, pickupLon],
          [dropoffLat, dropoffLon],
          { legType: 'ride' },
        );

        if (!isMounted) return;

        if (roadRoute && roadRoute.route.length >= 2) {
          setRouteData({
            distance_km: roadRoute.distance_km,
            duration_minutes: roadRoute.duration_minutes,
          });
          updateRouteOnMap(roadRoute.route, false);
        } else {
          updateRouteOnMap([[pickupLat, pickupLon], [dropoffLat, dropoffLon]], true);
          const fallbackDistance = calculateDistance(pickupLat, pickupLon, dropoffLat, dropoffLon);
          setRouteData({
            distance_km: fallbackDistance,
            duration_minutes: Math.ceil((fallbackDistance / 40) * 60),
          });
          setRouteError("Маршрут по дорогам недоступен. Показана прямая линия.");
        }
      } catch (error: any) {
        if (!isMounted) return;
        setRouteError(error.response?.data?.error || error.message || "Не удалось загрузить маршрут");
        if (mapInstanceRef.current) {
          updateRouteOnMap([[pickupLat, pickupLon], [dropoffLat, dropoffLon]], true);
          const fallbackDistance = calculateDistance(pickupLat, pickupLon, dropoffLat, dropoffLon);
          setRouteData({ distance_km: fallbackDistance, duration_minutes: Math.ceil((fallbackDistance / 40) * 60) });
        }
      } finally {
        if (isMounted) setLoadingRoute(false);
      }
    };
    loadRoute();
    return () => { isMounted = false; };
  }, [pickupLat, pickupLon, dropoffLat, dropoffLon, orderId]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;

    const centerLat = (pickupLat + dropoffLat) / 2;
    const centerLon = (pickupLon + dropoffLon) / 2;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new ymaps.Map(mapRef.current, {
        center: [centerLat, centerLon],
        zoom: 13,
        controls: ["zoomControl"],
      });
    }

    const map = mapInstanceRef.current;

    if (pickupMarkerRef.current) map.geoObjects.remove(pickupMarkerRef.current);
    if (dropoffMarkerRef.current) map.geoObjects.remove(dropoffMarkerRef.current);

    pickupMarkerRef.current = new ymaps.Placemark(
      [pickupLat, pickupLon],
      { balloonContent: pickupTitle ? `<strong>Откуда:</strong><br>${pickupTitle}` : "Откуда", iconCaption: "A" },
      { preset: "islands#greenDotIcon" }
    );
    dropoffMarkerRef.current = new ymaps.Placemark(
      [dropoffLat, dropoffLon],
      { balloonContent: dropoffTitle ? `<strong>Куда:</strong><br>${dropoffTitle}` : "Куда", iconCaption: "B" },
      { preset: "islands#redDotIcon" }
    );

    map.geoObjects.add(pickupMarkerRef.current);
    map.geoObjects.add(dropoffMarkerRef.current);

    if (!routeLineRef.current) {
      map.setBounds(
        [[Math.min(pickupLat, dropoffLat), Math.min(pickupLon, dropoffLon)],
         [Math.max(pickupLat, dropoffLat), Math.max(pickupLon, dropoffLon)]],
        { checkZoomRange: true, zoomMargin: 40 }
      );
    }
  }, [ready, pickupLat, pickupLon, dropoffLat, dropoffLon, pickupTitle, dropoffTitle]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) { mapInstanceRef.current.destroy(); mapInstanceRef.current = null; }
    };
  }, []);

  const displayDistance = routeData?.distance_km ?? distanceKm ?? calculateDistance(pickupLat, pickupLon, dropoffLat, dropoffLon);

  return (
    <div className="space-y-2">
      <div className="relative">
        <div ref={mapRef} style={{ height }} className="w-full rounded-lg border border-gray-200 dark:border-gray-700" />
        {loadingRoute && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-800/80 rounded-lg">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600 dark:text-indigo-400" />
              <span className="text-sm text-gray-600 dark:text-gray-400">Загрузка маршрута...</span>
            </div>
          </div>
        )}
      </div>
      {routeError && (
        <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
          <p className="text-xs text-yellow-800 dark:text-yellow-200">{routeError}</p>
        </div>
      )}
      {displayDistance > 0 && (
        <div className="flex items-center justify-center gap-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          <span className="text-sm font-medium text-blue-800 dark:text-blue-200">Расстояние: {displayDistance.toFixed(2)} км</span>
          {routeData?.duration_minutes && (
            <>
              <span className="text-blue-600 dark:text-blue-400">•</span>
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-medium text-blue-800 dark:text-blue-200">Время: ~{routeData.duration_minutes} мин</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
