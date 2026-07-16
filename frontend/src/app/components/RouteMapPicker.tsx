import { useEffect, useRef, useState, useCallback } from "react";
import { MapPin } from "lucide-react";
import { loadYmaps } from "../../shared/yandex/loadYmaps";

const ATYRAU_CENTER: [number, number] = [47.1171, 51.8833];

interface RouteMapPickerProps {
  initialLat?: number;
  initialLon?: number;
  initialZoom?: number;
  height?: string;
  onPickupChange?: (lat: number, lon: number, address?: string) => void;
  onDropoffChange?: (lat: number, lon: number, address?: string) => void;
  initialPickup?: { lat: number; lon: number; address?: string };
  initialDropoff?: { lat: number; lon: number; address?: string };
  selectionMode?: "pickup" | "dropoff" | "both";
}

export function RouteMapPicker({
  initialLat = ATYRAU_CENTER[0],
  initialLon = ATYRAU_CENTER[1],
  initialZoom = 13,
  height = "400px",
  onPickupChange,
  onDropoffChange,
  initialPickup,
  initialDropoff,
  selectionMode = "both",
}: RouteMapPickerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<ymaps.Map | null>(null);
  const pickupMarkerRef = useRef<ymaps.Placemark | null>(null);
  const dropoffMarkerRef = useRef<ymaps.Placemark | null>(null);
  const routeLineRef = useRef<ymaps.Polyline | null>(null);

  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lon: number } | null>(
    initialPickup ? { lat: initialPickup.lat, lon: initialPickup.lon } : null
  );
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lon: number } | null>(
    initialDropoff ? { lat: initialDropoff.lat, lon: initialDropoff.lon } : null
  );
  const [currentMode, setCurrentMode] = useState<"pickup" | "dropoff">("pickup");
  const [ready, setReady] = useState(false);

  const [pickupAddress, setPickupAddress] = useState(initialPickup?.address || "");
  const [dropoffAddress, setDropoffAddress] = useState(initialDropoff?.address || "");

  const pickupCoordsRef = useRef(pickupCoords);
  const dropoffCoordsRef = useRef(dropoffCoords);
  const currentModeRef = useRef(currentMode);

  useEffect(() => { pickupCoordsRef.current = pickupCoords; }, [pickupCoords]);
  useEffect(() => { dropoffCoordsRef.current = dropoffCoords; }, [dropoffCoords]);
  useEffect(() => { currentModeRef.current = currentMode; }, [currentMode]);

  useEffect(() => { loadYmaps().then(() => setReady(true)).catch(console.error); }, []);

  const updateRoute = useCallback(() => {
    if (!mapInstanceRef.current) return;
    if (routeLineRef.current) {
      mapInstanceRef.current.geoObjects.remove(routeLineRef.current);
      routeLineRef.current = null;
    }
    const pickup = pickupCoordsRef.current;
    const dropoff = dropoffCoordsRef.current;
    if (pickup && dropoff) {
      routeLineRef.current = new ymaps.Polyline(
        [[pickup.lat, pickup.lon], [dropoff.lat, dropoff.lon]],
        {},
        { strokeColor: "#3b82f6", strokeWidth: 4, strokeStyle: "dash", opacity: 0.7 }
      );
      mapInstanceRef.current.geoObjects.add(routeLineRef.current);
    }
  }, []);

  // Reverse geocode: получить адрес по координатам
  const reverseGeocode = useCallback(async (lat: number, lon: number): Promise<string> => {
    try {
      const result = await ymaps.geocode([lat, lon], { results: 1 });
      const firstGeoObject = result.geoObjects.get(0);
      if (firstGeoObject) {
        return firstGeoObject.getAddressLine?.() ||
          firstGeoObject.properties.get("text") ||
          `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
      }
    } catch (err) {
      console.error("Ошибка обратного геокодирования:", err);
    }
    return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  }, []);

  const addPickupMarker = useCallback((lat: number, lon: number, address?: string) => {
    if (!mapInstanceRef.current) return;
    if (pickupMarkerRef.current) {
      mapInstanceRef.current.geoObjects.remove(pickupMarkerRef.current);
    }
    const caption = address || "A - Откуда";
    pickupMarkerRef.current = new ymaps.Placemark(
      [lat, lon],
      {
        iconCaption: caption,
        balloonContentHeader: "<strong>Откуда (A)</strong>",
        balloonContentBody: address || "Адрес не определён",
      },
      { preset: "islands#greenDotIcon", draggable: true }
    );
    pickupMarkerRef.current.events.add("dragend", async () => {
      const coords = pickupMarkerRef.current!.geometry.getCoordinates();
      const newCoords = { lat: coords[0], lon: coords[1] };
      setPickupCoords(newCoords);
      pickupCoordsRef.current = newCoords;
      const addr = await reverseGeocode(coords[0], coords[1]);
      setPickupAddress(addr);
      pickupMarkerRef.current!.properties.set({
        iconCaption: addr,
        balloonContentBody: addr,
      });
      onPickupChange?.(coords[0], coords[1], addr);
      updateRoute();
    });
    mapInstanceRef.current.geoObjects.add(pickupMarkerRef.current);
  }, [onPickupChange, updateRoute, reverseGeocode]);

  const addDropoffMarker = useCallback((lat: number, lon: number, address?: string) => {
    if (!mapInstanceRef.current) return;
    if (dropoffMarkerRef.current) {
      mapInstanceRef.current.geoObjects.remove(dropoffMarkerRef.current);
    }
    const caption = address || "B - Куда";
    dropoffMarkerRef.current = new ymaps.Placemark(
      [lat, lon],
      {
        iconCaption: caption,
        balloonContentHeader: "<strong>Куда (B)</strong>",
        balloonContentBody: address || "Адрес не определён",
      },
      { preset: "islands#redDotIcon", draggable: true }
    );
    dropoffMarkerRef.current.events.add("dragend", async () => {
      const coords = dropoffMarkerRef.current!.geometry.getCoordinates();
      const newCoords = { lat: coords[0], lon: coords[1] };
      setDropoffCoords(newCoords);
      dropoffCoordsRef.current = newCoords;
      const addr = await reverseGeocode(coords[0], coords[1]);
      setDropoffAddress(addr);
      dropoffMarkerRef.current!.properties.set({
        iconCaption: addr,
        balloonContentBody: addr,
      });
      onDropoffChange?.(coords[0], coords[1], addr);
      updateRoute();
    });
    mapInstanceRef.current.geoObjects.add(dropoffMarkerRef.current);
  }, [onDropoffChange, updateRoute, reverseGeocode]);

  const updatePickupMarker = useCallback((lat: number, lon: number, address?: string) => {
    if (!mapInstanceRef.current) return;
    if (pickupMarkerRef.current) {
      pickupMarkerRef.current.geometry.setCoordinates([lat, lon]);
      if (address) {
        pickupMarkerRef.current.properties.set({
          iconCaption: address,
          balloonContentBody: address,
        });
      }
    } else {
      addPickupMarker(lat, lon, address);
    }
  }, [addPickupMarker]);

  const updateDropoffMarker = useCallback((lat: number, lon: number, address?: string) => {
    if (!mapInstanceRef.current) return;
    if (dropoffMarkerRef.current) {
      dropoffMarkerRef.current.geometry.setCoordinates([lat, lon]);
      if (address) {
        dropoffMarkerRef.current.properties.set({
          iconCaption: address,
          balloonContentBody: address,
        });
      }
    } else {
      addDropoffMarker(lat, lon, address);
    }
  }, [addDropoffMarker]);

  // Инициализация карты
  useEffect(() => {
    if (!ready || !mapRef.current || mapInstanceRef.current) return;

    let centerLat = initialLat;
    let centerLon = initialLon;
    if (pickupCoords) { centerLat = pickupCoords.lat; centerLon = pickupCoords.lon; }
    else if (dropoffCoords) { centerLat = dropoffCoords.lat; centerLon = dropoffCoords.lon; }

    mapInstanceRef.current = new ymaps.Map(mapRef.current, {
      center: [centerLat, centerLon],
      zoom: initialZoom,
      controls: ["zoomControl"],
    });

    const applySearchResult = async (lat: number, lon: number, address: string) => {
      const currentPickup = pickupCoordsRef.current;
      const currentDropoff = dropoffCoordsRef.current;
      const mode = currentModeRef.current;

      if (selectionMode === "both") {
        if (!currentPickup) {
          const newCoords = { lat, lon };
          setPickupCoords(newCoords);
          pickupCoordsRef.current = newCoords;
          setPickupAddress(address);
          addPickupMarker(lat, lon, address);
          onPickupChange?.(lat, lon, address);
          setCurrentMode("dropoff");
          currentModeRef.current = "dropoff";
        } else if (!currentDropoff) {
          const newCoords = { lat, lon };
          setDropoffCoords(newCoords);
          dropoffCoordsRef.current = newCoords;
          setDropoffAddress(address);
          addDropoffMarker(lat, lon, address);
          onDropoffChange?.(lat, lon, address);
          setCurrentMode("pickup");
          currentModeRef.current = "pickup";
        } else if (mode === "pickup") {
          const newCoords = { lat, lon };
          setPickupCoords(newCoords);
          pickupCoordsRef.current = newCoords;
          setPickupAddress(address);
          updatePickupMarker(lat, lon, address);
          onPickupChange?.(lat, lon, address);
          setCurrentMode("dropoff");
          currentModeRef.current = "dropoff";
        } else {
          const newCoords = { lat, lon };
          setDropoffCoords(newCoords);
          dropoffCoordsRef.current = newCoords;
          setDropoffAddress(address);
          updateDropoffMarker(lat, lon, address);
          onDropoffChange?.(lat, lon, address);
          setCurrentMode("pickup");
          currentModeRef.current = "pickup";
        }
      } else if (selectionMode === "pickup") {
        const newCoords = { lat, lon };
        setPickupCoords(newCoords);
        pickupCoordsRef.current = newCoords;
        setPickupAddress(address);
        updatePickupMarker(lat, lon, address);
        onPickupChange?.(lat, lon, address);
      } else {
        const newCoords = { lat, lon };
        setDropoffCoords(newCoords);
        dropoffCoordsRef.current = newCoords;
        setDropoffAddress(address);
        updateDropoffMarker(lat, lon, address);
        onDropoffChange?.(lat, lon, address);
      }
      mapInstanceRef.current?.setCenter([lat, lon], 16, { duration: 300 });
      updateRoute();
    };

    if (pickupCoords) addPickupMarker(pickupCoords.lat, pickupCoords.lon, pickupAddress);
    if (dropoffCoords) addDropoffMarker(dropoffCoords.lat, dropoffCoords.lon, dropoffAddress);

    // Клик по карте — ставим маркер + обратное геокодирование
    mapInstanceRef.current.events.add("click", async (e: any) => {
      const coords = e.get("coords");
      const lat = coords[0];
      const lon = coords[1];
      const addr = await reverseGeocode(lat, lon);
      await applySearchResult(lat, lon, addr);
    });

    updateRoute();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.destroy();
        mapInstanceRef.current = null;
      }
    };
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { updateRoute(); }, [pickupCoords, dropoffCoords, updateRoute]);

  // Sync from parent
  useEffect(() => {
    if (initialPickup && mapInstanceRef.current) {
      const newCoords = { lat: initialPickup.lat, lon: initialPickup.lon };
      const cur = pickupCoordsRef.current;
      if (!cur || Math.abs(cur.lat - newCoords.lat) > 0.0001 || Math.abs(cur.lon - newCoords.lon) > 0.0001) {
        setPickupCoords(newCoords);
        pickupCoordsRef.current = newCoords;
        updatePickupMarker(initialPickup.lat, initialPickup.lon, initialPickup.address);
        updateRoute();
      }
    } else if (!initialPickup && pickupCoordsRef.current && mapInstanceRef.current) {
      if (pickupMarkerRef.current) { mapInstanceRef.current.geoObjects.remove(pickupMarkerRef.current); pickupMarkerRef.current = null; }
      setPickupCoords(null); pickupCoordsRef.current = null;
      setPickupAddress("");
      updateRoute();
    }
  }, [initialPickup?.lat, initialPickup?.lon, updatePickupMarker, updateRoute]);

  useEffect(() => {
    if (initialDropoff && mapInstanceRef.current) {
      const newCoords = { lat: initialDropoff.lat, lon: initialDropoff.lon };
      const cur = dropoffCoordsRef.current;
      if (!cur || Math.abs(cur.lat - newCoords.lat) > 0.0001 || Math.abs(cur.lon - newCoords.lon) > 0.0001) {
        setDropoffCoords(newCoords);
        dropoffCoordsRef.current = newCoords;
        updateDropoffMarker(initialDropoff.lat, initialDropoff.lon, initialDropoff.address);
        updateRoute();
      }
    } else if (!initialDropoff && dropoffCoordsRef.current && mapInstanceRef.current) {
      if (dropoffMarkerRef.current) { mapInstanceRef.current.geoObjects.remove(dropoffMarkerRef.current); dropoffMarkerRef.current = null; }
      setDropoffCoords(null); dropoffCoordsRef.current = null;
      setDropoffAddress("");
      updateRoute();
    }
  }, [initialDropoff?.lat, initialDropoff?.lon, updateDropoffMarker, updateRoute]);

  return (
    <div className="space-y-3">
      {/* Карта */}
      <div ref={mapRef} style={{ height }} className="w-full rounded-lg border border-gray-200 dark:border-gray-700" />

      {/* Координаты и адреса */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
          <p className="text-xs font-medium text-green-800 dark:text-green-300 mb-1">Откуда (A)</p>
          {pickupCoords ? (
            <>
              <p className="text-gray-900 dark:text-white font-mono text-xs">
                {pickupCoords.lat.toFixed(6)}, {pickupCoords.lon.toFixed(6)}
              </p>
              {pickupAddress && (
                <p className="text-xs text-green-700 dark:text-green-400 mt-1 truncate" title={pickupAddress}>
                  {pickupAddress}
                </p>
              )}
            </>
          ) : (
            <p className="text-gray-400 dark:text-gray-500 italic text-xs">Не выбрано</p>
          )}
        </div>
        <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
          <p className="text-xs font-medium text-red-800 dark:text-red-300 mb-1">Куда (B)</p>
          {dropoffCoords ? (
            <>
              <p className="text-gray-900 dark:text-white font-mono text-xs">
                {dropoffCoords.lat.toFixed(6)}, {dropoffCoords.lon.toFixed(6)}
              </p>
              {dropoffAddress && (
                <p className="text-xs text-red-700 dark:text-red-400 mt-1 truncate" title={dropoffAddress}>
                  {dropoffAddress}
                </p>
              )}
            </>
          ) : (
            <p className="text-gray-400 dark:text-gray-500 italic text-xs">Не выбрано</p>
          )}
        </div>
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
        <p>
          Первый клик — <strong>откуда (A, зелёный)</strong>, второй — <strong>куда (B, красный)</strong>.
          Если обе точки уже стоят, следующий клик меняет{" "}
          {currentMode === "pickup" ? "откуда (A)" : "куда (B)"}.
        </p>
        <p>Адрес определяется автоматически; уточните в полях ниже при необходимости.</p>
      </div>
    </div>
  );
}
