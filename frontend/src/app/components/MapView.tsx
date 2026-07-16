import { useEffect, useRef, useState } from "react";
import { loadYmaps } from "../../shared/yandex/loadYmaps";

interface MapViewProps {
  center: [number, number];
  zoom?: number;
  /** Координаты маркера; `undefined` — как [center]; `null` — маркер не показывать */
  markerPosition?: [number, number] | null;
  popupContent?: string;
  draggable?: boolean;
  onMarkerPositionChange?: (lat: number, lon: number) => void;
}

export function MapView({
  center,
  zoom = 13,
  markerPosition,
  popupContent,
  draggable = false,
  onMarkerPositionChange,
}: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<ymaps.Map | null>(null);
  const markerRef = useRef<ymaps.Placemark | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadYmaps().then(() => setReady(true)).catch(console.error);
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current) return;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new ymaps.Map(mapRef.current, {
        center: [center[0], center[1]],
        zoom,
        controls: ["zoomControl"],
      });
    } else {
      mapInstanceRef.current.setCenter([center[0], center[1]], zoom);
    }
  }, [ready, center, zoom]);

  useEffect(() => {
    if (!ready || !mapInstanceRef.current) return;

    if (markerRef.current) {
      mapInstanceRef.current.geoObjects.remove(markerRef.current);
      markerRef.current = null;
    }

    if (markerPosition === null) {
      return;
    }

    const position = markerPosition ?? center;

    if (position) {
      const placemark = new ymaps.Placemark(
        [position[0], position[1]],
        { balloonContent: popupContent || "" },
        { draggable, preset: "islands#blueCircleDotIcon" }
      );

      if (draggable && onMarkerPositionChange) {
        placemark.events.add("dragend", () => {
          const coords = placemark.geometry.getCoordinates();
          onMarkerPositionChange(coords[0], coords[1]);
        });
      }

      mapInstanceRef.current.geoObjects.add(placemark);
      markerRef.current = placemark;
    }
  }, [ready, markerPosition, popupContent, draggable, onMarkerPositionChange, center]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.destroy();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return <div ref={mapRef} className="w-full h-full rounded-lg" />;
}
