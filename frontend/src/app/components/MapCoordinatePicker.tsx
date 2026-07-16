import { useEffect, useRef, useState } from "react";
import { loadYmaps } from "../../shared/yandex/loadYmaps";

interface MapCoordinatePickerProps {
  initialLat?: number;
  initialLon?: number;
  initialZoom?: number;
  height?: string;
  onCoordinateChange?: (lat: number, lon: number) => void;
  polygonMode?: boolean;
  onPolygonChange?: (coordinates: number[][]) => void;
  initialPolygon?: number[][];
  serviceRadius?: number;
  onRadiusChange?: (radius: number) => void;
  disabled?: boolean;
}

export function MapCoordinatePicker({
  initialLat = 47.10869114222083,
  initialLon = 51.9049072265625,
  initialZoom = 13,
  height = "400px",
  onCoordinateChange,
  polygonMode = false,
  onPolygonChange,
  initialPolygon,
  serviceRadius,
  onRadiusChange,
  disabled = false,
}: MapCoordinatePickerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<ymaps.Map | null>(null);
  const markerRef = useRef<ymaps.Placemark | null>(null);
  const circleRef = useRef<ymaps.Circle | null>(null);
  const polygonObjRef = useRef<ymaps.Polygon | null>(null);
  const polygonMarkersRef = useRef<ymaps.Placemark[]>([]);
  const [currentLat, setCurrentLat] = useState(initialLat);
  const [currentLon, setCurrentLon] = useState(initialLon);
  const [polygonPoints, setPolygonPoints] = useState<number[][]>(initialPolygon || []);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadYmaps().then(() => setReady(true)).catch(console.error);
  }, []);

  const updatePolygonOnMap = (points: number[][]) => {
    if (!mapInstanceRef.current) return;
    if (polygonObjRef.current) {
      mapInstanceRef.current.geoObjects.remove(polygonObjRef.current);
      polygonObjRef.current = null;
    }
    if (points.length >= 3) {
      polygonObjRef.current = new ymaps.Polygon(
        [points.map((p) => [p[0], p[1]])],
        {},
        { fillColor: "rgba(59,130,246,0.2)", strokeColor: "#3b82f6", strokeWidth: 2 }
      );
      mapInstanceRef.current.geoObjects.add(polygonObjRef.current);
    }
  };

  const clearPolygonMarkers = () => {
    if (!mapInstanceRef.current) return;
    polygonMarkersRef.current.forEach((m) => mapInstanceRef.current!.geoObjects.remove(m));
    polygonMarkersRef.current = [];
  };

  const recreatePolygonMarkers = (points: number[][]) => {
    clearPolygonMarkers();
    if (!mapInstanceRef.current) return;
    points.forEach((point, index) => {
      const pm = new ymaps.Placemark(
        [point[0], point[1]],
        { iconCaption: String(index + 1) },
        { preset: "islands#redCircleDotIcon", draggable: !disabled }
      );
      pm.events.add("dragend", () => {
        const coords = pm.geometry.getCoordinates();
        const updated = [...points];
        updated[index] = [coords[0], coords[1]];
        setPolygonPoints(updated);
        onPolygonChange?.(updated);
        updatePolygonOnMap(updated);
      });
      mapInstanceRef.current!.geoObjects.add(pm);
      polygonMarkersRef.current.push(pm);
    });
  };

  useEffect(() => {
    if (!ready || !mapRef.current || mapInstanceRef.current) return;

    const timer = setTimeout(() => {
      if (!mapRef.current || mapInstanceRef.current) return;

      mapInstanceRef.current = new ymaps.Map(mapRef.current, {
        center: [initialLat, initialLon],
        zoom: initialZoom,
        controls: ["zoomControl"],
      });

      if (!polygonMode) {
        markerRef.current = new ymaps.Placemark(
          [initialLat, initialLon],
          {},
          { preset: "islands#blueCircleDotIcon", draggable: !disabled }
        );
        if (!disabled) {
          markerRef.current.events.add("dragend", () => {
            const coords = markerRef.current!.geometry.getCoordinates();
            setCurrentLat(coords[0]);
            setCurrentLon(coords[1]);
            onCoordinateChange?.(coords[0], coords[1]);
          });
        }
        mapInstanceRef.current.geoObjects.add(markerRef.current);
      }

      if (serviceRadius && serviceRadius > 0) {
        circleRef.current = new ymaps.Circle(
          [[initialLat, initialLon], serviceRadius],
          {},
          { fillColor: "rgba(59,130,246,0.2)", strokeColor: "#3b82f6", strokeWidth: 2 }
        );
        mapInstanceRef.current.geoObjects.add(circleRef.current);
      }

      if (!disabled) {
        mapInstanceRef.current.events.add("click", (e: any) => {
          const coords = e.get("coords");
          if (polygonMode) {
            setPolygonPoints((prev) => {
              const newPoints = [...prev, [coords[0], coords[1]]];
              onPolygonChange?.(newPoints);
              updatePolygonOnMap(newPoints);
              recreatePolygonMarkers(newPoints);
              return newPoints;
            });
          } else {
            setCurrentLat(coords[0]);
            setCurrentLon(coords[1]);
            if (markerRef.current) {
              markerRef.current.geometry.setCoordinates(coords);
            }
            if (circleRef.current && serviceRadius && serviceRadius > 0) {
              circleRef.current.geometry.setCoordinates(coords);
            }
            onCoordinateChange?.(coords[0], coords[1]);
          }
        });
      }

      if (initialPolygon && initialPolygon.length > 0 && polygonMode) {
        updatePolygonOnMap(initialPolygon);
        recreatePolygonMarkers(initialPolygon);
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.destroy();
        mapInstanceRef.current = null;
      }
    };
  }, [ready]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    setCurrentLat(initialLat);
    setCurrentLon(initialLon);
    mapInstanceRef.current.setCenter([initialLat, initialLon], mapInstanceRef.current.getZoom());
    if (markerRef.current && !polygonMode) {
      markerRef.current.geometry.setCoordinates([initialLat, initialLon]);
    }
    if (circleRef.current) {
      mapInstanceRef.current.geoObjects.remove(circleRef.current);
      circleRef.current = null;
      if (serviceRadius && serviceRadius > 0) {
        circleRef.current = new ymaps.Circle(
          [[initialLat, initialLon], serviceRadius],
          {},
          { fillColor: "rgba(59,130,246,0.2)", strokeColor: "#3b82f6", strokeWidth: 2 }
        );
        mapInstanceRef.current.geoObjects.add(circleRef.current);
      }
    }
  }, [initialLat, initialLon, polygonMode, serviceRadius]);

  useEffect(() => {
    if (!mapInstanceRef.current || polygonMode) return;
    if (circleRef.current) {
      mapInstanceRef.current.geoObjects.remove(circleRef.current);
      circleRef.current = null;
    }
    if (serviceRadius && serviceRadius > 0) {
      circleRef.current = new ymaps.Circle(
        [[currentLat, currentLon], serviceRadius],
        {},
        { fillColor: "rgba(59,130,246,0.2)", strokeColor: "#3b82f6", strokeWidth: 2 }
      );
      mapInstanceRef.current.geoObjects.add(circleRef.current);
    }
  }, [serviceRadius, currentLat, currentLon, polygonMode]);

  useEffect(() => {
    if (!polygonMode || !mapInstanceRef.current) return;
    if (initialPolygon && initialPolygon.length > 0) {
      setPolygonPoints(initialPolygon);
      recreatePolygonMarkers(initialPolygon);
      updatePolygonOnMap(initialPolygon);
    } else {
      setPolygonPoints([]);
      clearPolygonMarkers();
      if (polygonObjRef.current) {
        mapInstanceRef.current.geoObjects.remove(polygonObjRef.current);
        polygonObjRef.current = null;
      }
    }
  }, [initialPolygon, polygonMode]);

  return (
    <div className="space-y-2">
      <div
        ref={mapRef}
        style={{ height, position: "relative", zIndex: "auto" }}
        className="w-full rounded-lg border border-gray-200 dark:border-gray-700"
      />
      {!polygonMode && (
        <div className="text-sm text-gray-600 dark:text-gray-400">
          Координаты: {currentLat.toFixed(6)}, {currentLon.toFixed(6)}
        </div>
      )}
      {polygonMode && (
        <div className="text-sm text-gray-600 dark:text-gray-400">
          Точек в полигоне: {polygonPoints.length}
          {polygonPoints.length < 3 && (
            <span className="text-orange-600 dark:text-orange-400 ml-2">(минимум 3 точки)</span>
          )}
        </div>
      )}
      {!disabled && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {polygonMode
            ? "Кликните на карте, чтобы добавить точку. Перетащите точку, чтобы переместить."
            : "Используйте поиск на карте или кликните, чтобы выбрать координаты."}
        </div>
      )}
    </div>
  );
}
