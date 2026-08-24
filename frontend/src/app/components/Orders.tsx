import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Search, Filter, Plus, Eye, Edit, X, Check, UserCircle, Car as CarIcon, Phone, Loader2, ArrowUpDown, ArrowUp, ArrowDown, MapPin, Sparkles, Upload, Download } from "lucide-react";
import { Modal } from "./Modal";
import { ordersApi, Order, ImportResult } from "../services/orders";
import { passengersApi, Passenger } from "../services/passengers";
import { dispatchApi } from "../services/dispatch";
import { regionsApi, Region } from "../services/regions";
import { RouteMapPicker } from "./RouteMapPicker";
import { RouteMapView } from "./RouteMapView";
import { CabinRecordingPanel } from "./CabinRecordingPanel";
import { toast } from "sonner";
import { normalizePhoneDigits } from "../utils/phone";
import { loadYmaps, areYandexKeysConfigured } from "../../shared/yandex/loadYmaps";
import { createSuggestView, findBestAddress } from "../../shared/yandex/addressSearch";
import { formatLatLonPair, parseLatLonPair } from "../../shared/yandex/coords";
import {
  buildAtyrauPickupDate,
  getTomorrowDateInAtyrau,
  validatePickupDateTime,
} from "../utils/atyrauDate";
import { distanceMeters, formatOrderAddressDisplay } from "../utils/addressDisplay";
import { useAuth } from "../context/AuthContext";
import PhoneInput from "react-phone-number-input";
import "react-phone-number-input/style.css";

const statuses = ["Все", "Ожидание", "В пути", "Выполнено", "Отменён"];

/** Единая зона для отображения времени забора (как на бэкенде TIME_ZONE) */
const ATYRAU_TZ = "Asia/Atyrau";

function notifyDispatchOrdersChanged(desiredPickupTime?: string | null) {
  const date = desiredPickupTime
    ? new Date(desiredPickupTime).toLocaleDateString("en-CA", { timeZone: ATYRAU_TZ })
    : undefined;
  window.dispatchEvent(new CustomEvent("invotaxi:orders-generated", { detail: { date } }));
}

function formatPickupDateParts(iso: string | undefined): { date: string; time: string } {
  if (!iso) return { date: "—", time: "—" };
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("ru-RU", {
      timeZone: ATYRAU_TZ,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }),
    time: d.toLocaleTimeString("ru-RU", {
      timeZone: ATYRAU_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  };
}

const getDefaultTimeGMT5 = (): string => {
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: "Asia/Atyrau",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

interface OrdersProps {
  selectedOrderId?: string | null;
  onOrderClose?: () => void;
}

type SortField = 'id' | 'pickup' | 'status' | 'passenger';
type SortDirection = 'asc' | 'desc';

function passengerDisplayName(p: Passenger): string {
  return (p?.full_name ?? p?.user?.username)?.trim() || "—";
}

// Маппинг статусов API на отображаемые
const statusMap: Record<string, string> = {
  "draft": "Черновик",
  "submitted": "Отправлено",
  "awaiting_dispatcher_decision": "Ожидание решения диспетчера",
  "rejected": "Отклонено",
  "active_queue": "В очереди",
  "assigned": "Назначено",
  "driver_en_route": "Водитель в пути",
  "arrived_waiting": "Ожидание пассажира",
  "no_show": "Пассажир не пришел",
  "ride_ongoing": "Поездка началась",
  "completed": "Завершено",
  "cancelled": "Отменено",
  "incident": "Инцидент",
};

export function Orders({ selectedOrderId, onOrderClose }: OrdersProps = {}) {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("Все");
  const [sortField, setSortField] = useState<SortField>('pickup');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [viewModal, setViewModal] = useState<string | null>(null);
  const [editModal, setEditModal] = useState<string | null>(null);
  const [assignModal, setAssignModal] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [callModal, setCallModal] = useState<{ name: string; phone: string; type: string } | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const [mamashChildIndex, setMamashChildIndex] = useState(1);
  const [editingStatus, setEditingStatus] = useState<string>("");
  const [editingNote, setEditingNote] = useState<string>("");
  const [editingOrderDate, setEditingOrderDate] = useState<string>("");
  const [editingOrderTime, setEditingOrderTime] = useState<string>("");
  const [editingPickupObjectName, setEditingPickupObjectName] = useState("");
  const [editingDropoffObjectName, setEditingDropoffObjectName] = useState("");
  const [editingPickupAddress, setEditingPickupAddress] = useState("");
  const [editingDropoffAddress, setEditingDropoffAddress] = useState("");
  const [editingPickupCoords, setEditingPickupCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [editingDropoffCoords, setEditingDropoffCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [editingPickupCoordsInput, setEditingPickupCoordsInput] = useState("");
  const [editingDropoffCoordsInput, setEditingDropoffCoordsInput] = useState("");
  const [editingGeocodeErrorPickup, setEditingGeocodeErrorPickup] = useState<string | null>(null);
  const [editingGeocodeErrorDropoff, setEditingGeocodeErrorDropoff] = useState<string | null>(null);
  const [editingGeocodingPickup, setEditingGeocodingPickup] = useState(false);
  const [editingGeocodingDropoff, setEditingGeocodingDropoff] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Состояние для создания заказа
  const [pickupAddress, setPickupAddress] = useState("");
  const [pickupObjectName, setPickupObjectName] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [dropoffObjectName, setDropoffObjectName] = useState("");
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [selectedPassengerId, setSelectedPassengerId] = useState<string>("");
  const [orderDate, setOrderDate] = useState<string>("");
  const [orderTime, setOrderTime] = useState<string>("");
  const [orderNote, setOrderNote] = useState("");
  const [orderHasCompanion, setOrderHasCompanion] = useState(false);
  const [isRoundTrip, setIsRoundTrip] = useState(false);
  const [returnDate, setReturnDate] = useState<string>("");
  const [returnTime, setReturnTime] = useState<string>("");
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  
  // Состояние для формы пассажира
  const [passengerPhone, setPassengerPhone] = useState("");
  const [passengerName, setPassengerName] = useState("");
  const [passengerRegionId, setPassengerRegionId] = useState<string>("");
  const [orderRegionId, setOrderRegionId] = useState<string>("");
  const [passengerDisabilityCategory, setPassengerDisabilityCategory] = useState<string>("");
  const [passengerAllowedCompanion, setPassengerAllowedCompanion] = useState(false);
  const [matchingPassengers, setMatchingPassengers] = useState<Passenger[]>([]);
  const [searchingPassenger, setSearchingPassenger] = useState(false);
  const [selectedPassengerMode, setSelectedPassengerMode] = useState<'existing' | 'new' | null>(null);
  const [selectedExistingPassengerId, setSelectedExistingPassengerId] = useState<string | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  
  // Состояния для геокодирования
  const [geocodingPickup, setGeocodingPickup] = useState(false);
  const [geocodingDropoff, setGeocodingDropoff] = useState(false);
  const [geocodeErrorPickup, setGeocodeErrorPickup] = useState<string | null>(null);
  const [geocodeErrorDropoff, setGeocodeErrorDropoff] = useState<string | null>(null);

  const [ymapsReady, setYmapsReady] = useState(false);

  // Координаты одной строкой (вставка из Яндекс.Карт: «47.125778, 51.923010»)
  const [pickupCoordsInput, setPickupCoordsInput] = useState<string>("");
  const [dropoffCoordsInput, setDropoffCoordsInput] = useState<string>("");

  const pickupAddressInputRef = useRef<HTMLInputElement>(null);
  const dropoffAddressInputRef = useRef<HTMLInputElement>(null);
  const editingPickupAddressInputRef = useRef<HTMLInputElement>(null);
  const editingDropoffAddressInputRef = useRef<HTMLInputElement>(null);
  const [generateModal, setGenerateModal] = useState(false);
  const [generatingOrders, setGeneratingOrders] = useState(false);
  const [generateDate, setGenerateDate] = useState(() => getTomorrowDateInAtyrau());
  const [ordersPerSlot, setOrdersPerSlot] = useState(5);
  const [replaceGenerated, setReplaceGenerated] = useState(true);
  
  // Импорт/экспорт
  const [importModal, setImportModal] = useState(false);
  const [exportModal, setExportModal] = useState(false);
  const [exportDateFrom, setExportDateFrom] = useState("");
  const [exportDateTo, setExportDateTo] = useState("");
  const [clearAllModal, setClearAllModal] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importOptions, setImportOptions] = useState({ dryRun: false, skipErrors: false });
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Пагинация
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);

  // Маппинг статусов UI -> API
  const statusToApi = (s: string): string | undefined => {
    if (s === "Все") return undefined;
    if (s === "Ожидание") return "waiting";
    if (s === "В пути") return "on_the_way";
    if (s === "Выполнено") return "completed";
    if (s === "Отменён") return "cancelled";
    return undefined;
  };

  // Load orders from API with pagination
  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params: { page?: number; page_size?: number; status?: string; search?: string } = {
        page,
        page_size: pageSize,
      };
      const statusParam = statusToApi(selectedStatus);
      if (statusParam) params.status = statusParam;
      if (searchTerm.trim()) params.search = searchTerm.trim();
      const response = await ordersApi.getOrdersPaginated(params);
      setOrders(response.results);
      setTotalCount(response.count);
    } catch (err: any) {
      setError(err.message || "Ошибка загрузки заказов");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, selectedStatus, searchTerm]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // Сброс на страницу 1 при смене фильтров
  useEffect(() => {
    setPage(1);
  }, [selectedStatus, searchTerm]);

  // Load passengers from API
  useEffect(() => {
    const loadPassengers = async () => {
      try {
        const data = await passengersApi.getPassengers();
        setPassengers(data);
      } catch (err: any) {
        console.error("Ошибка загрузки пассажиров:", err);
      }
    };
    loadPassengers();
  }, []);

  // Load regions from API
  useEffect(() => {
    const loadRegions = async () => {
      try {
        const data = await regionsApi.getRegions();
        setRegions(data);
      } catch (err: any) {
        console.error("Ошибка загрузки регионов:", err);
      }
    };
    loadRegions();
  }, []);

  // Debounced search for passengers by phone
  useEffect(() => {
    const searchPassengers = async () => {
      if (!passengerPhone || passengerPhone.trim().length < 4) {
        setMatchingPassengers([]);
        // Если телефон полностью очищен, сбрасываем все
        if (!passengerPhone || passengerPhone.trim().length === 0) {
          setSelectedPassengerMode(null);
          setSelectedExistingPassengerId(null);
          setPassengerName("");
          setPassengerRegionId("");
          setOrderRegionId("");
          setPassengerDisabilityCategory("");
          setPassengerAllowedCompanion(false);
        }
        return;
      }

      setSearchingPassenger(true);
      try {
        const results = await passengersApi.searchPassengersByPhone(passengerPhone);
        setMatchingPassengers(results);

        const inputDigits = normalizePhoneDigits(passengerPhone);

        // Если результатов нет — всегда переключаем на "новый пассажир"
        if (results.length === 0) {
          setSelectedPassengerMode('new');
          setSelectedExistingPassengerId(null);
        } else {
          // Если выбранный ID больше не в результатах — сбрасываем выбор
          if (selectedExistingPassengerId !== null) {
            const stillInResults = results.some((p) => p.id === selectedExistingPassengerId);
            if (!stillInResults) {
              setSelectedExistingPassengerId(null);
              setSelectedPassengerMode(null);
            }
          }

          // Автовыбор только при точном совпадении номера (ровно 1 результат + цифры совпадают)
          if (results.length === 1 && selectedPassengerMode === null) {
            const singlePhone = results[0].user?.phone || '';
            if (inputDigits === normalizePhoneDigits(singlePhone)) {
              const p0 = results[0];
              const nm = passengerDisplayName(p0);
              setSelectedPassengerMode('existing');
              setSelectedExistingPassengerId(p0.id);
              setPassengerName(nm === "—" ? "" : nm);
              if (p0.region?.id) {
                setOrderRegionId(p0.region.id);
              }
            }
          }
        }
      } catch (err: any) {
        console.error("Ошибка поиска пассажиров:", err);
        setMatchingPassengers([]);
      } finally {
        setSearchingPassenger(false);
      }
    };

    const timeoutId = setTimeout(() => {
      searchPassengers();
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [passengerPhone, selectedPassengerMode]);

  // Установка текущей даты и времени по умолчанию (GMT+5, Атырау)
  useEffect(() => {
    setOrderDate(getTomorrowDateInAtyrau());
    setOrderTime(getDefaultTimeGMT5());
  }, []);

  // Загрузка Yandex Maps при открытии форм с адресным поиском
  useEffect(() => {
    if (!createModal && !editModal) return;
    if (!areYandexKeysConfigured()) {
      setYmapsReady(false);
      return;
    }
    let cancelled = false;
    loadYmaps()
      .then(() => {
        if (!cancelled) setYmapsReady(true);
      })
      .catch((err) => {
        console.error("Yandex Maps API:", err);
        if (!cancelled) setYmapsReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [createModal, editModal]);

  const applyYandexPickupResult = useCallback((result: { coords: number[]; address: string }) => {
    const [lat, lon] = result.coords;
    setPickupAddress(result.address);
    setPickupCoords({ lat, lon });
    setPickupCoordsInput(formatLatLonPair(lat, lon));
    setGeocodeErrorPickup(null);
  }, []);

  const applyYandexDropoffResult = useCallback((result: { coords: number[]; address: string }) => {
    const [lat, lon] = result.coords;
    setDropoffAddress(result.address);
    setDropoffCoords({ lat, lon });
    setDropoffCoordsInput(formatLatLonPair(lat, lon));
    setGeocodeErrorDropoff(null);
  }, []);

  const applyEditingYandexPickupResult = useCallback((result: { coords: number[]; address: string }) => {
    const [lat, lon] = result.coords;
    setEditingPickupAddress(result.address);
    setEditingPickupCoords({ lat, lon });
    setEditingPickupCoordsInput(formatLatLonPair(lat, lon));
    setEditingGeocodeErrorPickup(null);
  }, []);

  const applyEditingYandexDropoffResult = useCallback((result: { coords: number[]; address: string }) => {
    const [lat, lon] = result.coords;
    setEditingDropoffAddress(result.address);
    setEditingDropoffCoords({ lat, lon });
    setEditingDropoffCoordsInput(formatLatLonPair(lat, lon));
    setEditingGeocodeErrorDropoff(null);
  }, []);

  const yandexKeysError =
    "Задайте VITE_YANDEX_MAPS_API_KEY и VITE_YANDEX_MAPS_SUGGEST_API_KEY в frontend/.env";

  // Функция геокодирования адреса отправления (Yandex)
  const geocodePickupAddress = useCallback(async (address: string) => {
    const trimmedAddress = address?.trim();
    if (!trimmedAddress) {
      setGeocodeErrorPickup(null);
      setGeocodingPickup(false);
      setPickupCoords(null);
      return;
    }

    if (!areYandexKeysConfigured()) {
      setGeocodeErrorPickup(yandexKeysError);
      return;
    }

    setGeocodingPickup(true);
    setGeocodeErrorPickup(null);

    try {
      const result = await findBestAddress(trimmedAddress, true);
      if (result) {
        applyYandexPickupResult(result);
      } else {
        setPickupCoords(null);
        setGeocodeErrorPickup("Адрес не найден в Атырауской области");
      }
    } catch (err: any) {
      console.error("Ошибка геокодирования адреса отправления:", err);
      setGeocodeErrorPickup(err.message || "Ошибка геокодирования");
      setPickupCoords(null);
    } finally {
      setGeocodingPickup(false);
    }
  }, [applyYandexPickupResult]);

  // Функция геокодирования адреса назначения (Yandex)
  const geocodeDropoffAddress = useCallback(async (address: string) => {
    const trimmedAddress = address?.trim();
    if (!trimmedAddress) {
      setGeocodeErrorDropoff(null);
      setGeocodingDropoff(false);
      setDropoffCoords(null);
      return;
    }

    if (!areYandexKeysConfigured()) {
      setGeocodeErrorDropoff(yandexKeysError);
      return;
    }

    setGeocodingDropoff(true);
    setGeocodeErrorDropoff(null);

    try {
      const result = await findBestAddress(trimmedAddress, true);
      if (result) {
        applyYandexDropoffResult(result);
      } else {
        setDropoffCoords(null);
        setGeocodeErrorDropoff("Адрес не найден в Атырауской области");
      }
    } catch (err: any) {
      console.error("Ошибка геокодирования адреса назначения:", err);
      setGeocodeErrorDropoff(err.message || "Ошибка геокодирования");
      setDropoffCoords(null);
    } finally {
      setGeocodingDropoff(false);
    }
  }, [applyYandexDropoffResult]);

  const geocodeEditingPickupAddress = useCallback(async (address: string) => {
    const trimmedAddress = address?.trim();
    if (!trimmedAddress) {
      setEditingGeocodeErrorPickup(null);
      setEditingGeocodingPickup(false);
      setEditingPickupCoords(null);
      return;
    }

    setEditingGeocodingPickup(true);
    setEditingGeocodeErrorPickup(null);

    try {
      const result = await findBestAddress(trimmedAddress, true);
      if (result) {
        applyEditingYandexPickupResult(result);
      } else {
        setEditingPickupCoords(null);
        setEditingGeocodeErrorPickup("Адрес не найден в Атырауской области");
      }
    } catch (err: any) {
      setEditingGeocodeErrorPickup(err.message || "Ошибка геокодирования");
      setEditingPickupCoords(null);
    } finally {
      setEditingGeocodingPickup(false);
    }
  }, [applyEditingYandexPickupResult]);

  const geocodeEditingDropoffAddress = useCallback(async (address: string) => {
    const trimmedAddress = address?.trim();
    if (!trimmedAddress) {
      setEditingGeocodeErrorDropoff(null);
      setEditingGeocodingDropoff(false);
      setEditingDropoffCoords(null);
      return;
    }

    setEditingGeocodingDropoff(true);
    setEditingGeocodeErrorDropoff(null);

    try {
      const result = await findBestAddress(trimmedAddress, true);
      if (result) {
        applyEditingYandexDropoffResult(result);
      } else {
        setEditingDropoffCoords(null);
        setEditingGeocodeErrorDropoff("Адрес не найден в Атырауской области");
      }
    } catch (err: any) {
      setEditingGeocodeErrorDropoff(err.message || "Ошибка геокодирования");
      setEditingDropoffCoords(null);
    } finally {
      setEditingGeocodingDropoff(false);
    }
  }, [applyEditingYandexDropoffResult]);

  const handlePickupAddressChange = useCallback((value: string) => {
    setPickupAddress(value);
    setGeocodeErrorPickup(null);
  }, []);

  // SuggestView: заведения + адреса; геокод только на select (не на input)
  useEffect(() => {
    if (!createModal || !ymapsReady || !pickupAddressInputRef.current) return;
    return createSuggestView(
      pickupAddressInputRef.current,
      (result) => applyYandexPickupResult(result),
      () => setGeocodeErrorPickup("Адрес не найден в Атырауской области"),
    );
  }, [createModal, ymapsReady, applyYandexPickupResult]);

  useEffect(() => {
    if (!createModal || !ymapsReady || !dropoffAddressInputRef.current) return;
    return createSuggestView(
      dropoffAddressInputRef.current,
      (result) => applyYandexDropoffResult(result),
      () => setGeocodeErrorDropoff("Адрес не найден в Атырауской области"),
    );
  }, [createModal, ymapsReady, applyYandexDropoffResult]);

  useEffect(() => {
    if (!editModal || !ymapsReady || !editingPickupAddressInputRef.current) return;
    return createSuggestView(
      editingPickupAddressInputRef.current,
      (result) => applyEditingYandexPickupResult(result),
      () => setEditingGeocodeErrorPickup("Адрес не найден в Атырауской области"),
    );
  }, [editModal, ymapsReady, applyEditingYandexPickupResult]);

  useEffect(() => {
    if (!editModal || !ymapsReady || !editingDropoffAddressInputRef.current) return;
    return createSuggestView(
      editingDropoffAddressInputRef.current,
      (result) => applyEditingYandexDropoffResult(result),
      () => setEditingGeocodeErrorDropoff("Адрес не найден в Атырауской области"),
    );
  }, [editModal, ymapsReady, applyEditingYandexDropoffResult]);

  const handleDropoffAddressChange = useCallback((value: string) => {
    setDropoffAddress(value);
    setGeocodeErrorDropoff(null);
  }, []);

  const handleCreateMapPickupChange = useCallback((lat: number, lon: number, address?: string) => {
    setPickupCoords({ lat, lon });
    setPickupCoordsInput(formatLatLonPair(lat, lon));
    if (address) setPickupAddress(address);
    setGeocodeErrorPickup(null);
  }, []);

  const handleCreateMapDropoffChange = useCallback((lat: number, lon: number, address?: string) => {
    setDropoffCoords({ lat, lon });
    setDropoffCoordsInput(formatLatLonPair(lat, lon));
    if (address) setDropoffAddress(address);
    setGeocodeErrorDropoff(null);
  }, []);

  const applyCoordsInput = useCallback((
    value: string,
    setCoords: (c: { lat: number; lon: number } | null) => void,
    setError: (e: string | null) => void,
  ) => {
    const parsed = parseLatLonPair(value);
    if (!parsed) {
      if (value.trim()) setError("Формат: 47.125778, 51.923010");
      return;
    }
    setCoords(parsed);
    setError(null);
  }, []);

  // Синхронизация поля координат с состоянием
  useEffect(() => {
    if (pickupCoords) {
      const formatted = formatLatLonPair(pickupCoords.lat, pickupCoords.lon);
      if (pickupCoordsInput !== formatted) setPickupCoordsInput(formatted);
    } else if (!pickupAddress.trim()) {
      setPickupCoordsInput("");
    }
  }, [pickupCoords?.lat, pickupCoords?.lon]);

  useEffect(() => {
    if (dropoffCoords) {
      const formatted = formatLatLonPair(dropoffCoords.lat, dropoffCoords.lon);
      if (dropoffCoordsInput !== formatted) setDropoffCoordsInput(formatted);
    } else if (!dropoffAddress.trim()) {
      setDropoffCoordsInput("");
    }
  }, [dropoffCoords?.lat, dropoffCoords?.lon]);

  useEffect(() => {
    if (editingPickupCoords) {
      const formatted = formatLatLonPair(editingPickupCoords.lat, editingPickupCoords.lon);
      if (editingPickupCoordsInput !== formatted) setEditingPickupCoordsInput(formatted);
    }
  }, [editingPickupCoords?.lat, editingPickupCoords?.lon]);

  useEffect(() => {
    if (editingDropoffCoords) {
      const formatted = formatLatLonPair(editingDropoffCoords.lat, editingDropoffCoords.lon);
      if (editingDropoffCoordsInput !== formatted) setEditingDropoffCoordsInput(formatted);
    }
  }, [editingDropoffCoords?.lat, editingDropoffCoords?.lon]);

  // Валидация формы создания заказа (все поля кроме Примечания обязательны)
  const isCreateOrderFormValid = useCallback(() => {
    if (!passengerPhone || passengerPhone.trim().length === 0) return false;

    const useExistingPassenger =
      selectedPassengerMode === 'existing' && selectedExistingPassengerId != null;

    if (!useExistingPassenger) {
      if (!passengerName || passengerName.trim().length === 0) return false;
      if (!passengerDisabilityCategory) return false;
    }

    if (!pickupObjectName.trim()) return false;
    if (!pickupCoords) return false;
    if (!dropoffObjectName.trim()) return false;
    if (!dropoffCoords) return false;
    if (!orderRegionId) return false;
    if (!orderDate || !orderTime) return false;

    if (isRoundTrip) {
      if (!returnDate || !returnTime) return false;
    }

    return true;
  }, [
    passengerPhone,
    passengerName,
    passengerDisabilityCategory,
    selectedPassengerMode,
    selectedExistingPassengerId,
    pickupObjectName,
    pickupCoords,
    dropoffObjectName,
    dropoffCoords,
    orderRegionId,
    orderDate,
    orderTime,
    isRoundTrip,
    returnDate,
    returnTime,
  ]);

  // Общая логика создания заказа. Возвращает true при успехе, false при ошибке.
  const performCreateOrder = async (): Promise<boolean> => {
    if (!passengerPhone || passengerPhone.trim().length === 0) {
      toast.error("Введите телефон пассажира");
      return false;
    }

    let useExistingPassenger = false;
    let useNewPassenger = false;
    let passengerIdToUse: string | null = null;

    const selectedPassenger = selectedExistingPassengerId
      ? matchingPassengers.find((p) => p.id === selectedExistingPassengerId)
      : null;

    // Явный выбор из списка: достаточно mode + id + строка в текущих результатах поиска.
    // Совпадение телефона по цифрам не требуем — форматы (+7, 8, пробелы) часто расходятся с API.
    if (
      selectedPassengerMode === 'existing' &&
      selectedExistingPassengerId &&
      selectedPassenger
    ) {
      useExistingPassenger = true;
      passengerIdToUse = selectedExistingPassengerId;
    } else {
      useNewPassenger = true;
      if (!passengerName || passengerName.trim().length === 0) {
        toast.error("Введите имя пассажира");
        return false;
      }
      if (!passengerDisabilityCategory) {
        toast.error("Выберите категорию инвалидности");
        return false;
      }
    }

    if (!pickupObjectName.trim()) {
      toast.error("Укажите название объекта (откуда). Например: Дом инвалида, Поликлиника 3. Диспетчер ориентируется по названию.");
      return false;
    }
    if (!pickupCoords) {
      toast.error("Выберите точку на карте для места отправления");
      return false;
    }
    if (!dropoffObjectName.trim()) {
      toast.error("Укажите название объекта (куда). Например: Поликлиника 3, Школа №5. Диспетчер ориентируется по названию.");
      return false;
    }
    if (!dropoffCoords) {
      toast.error("Выберите точку на карте для места назначения");
      return false;
    }
    if (!orderRegionId) {
      toast.error("Выберите район заказа");
      return false;
    }
    if (distanceMeters(
      pickupCoords.lat,
      pickupCoords.lon,
      dropoffCoords.lat,
      dropoffCoords.lon,
    ) < 10) {
      toast.error("Точки «откуда» и «куда» совпадают — укажите разные адреса");
      return false;
    }
    if (
      pickupObjectName.trim().toLowerCase() === dropoffObjectName.trim().toLowerCase()
      && distanceMeters(
        pickupCoords.lat,
        pickupCoords.lon,
        dropoffCoords.lat,
        dropoffCoords.lon,
      ) < 200
    ) {
      toast.warning("Объекты откуда и куда совпадают — проверьте, не перепутаны ли точки на карте");
    }
    if (!orderDate || !orderTime) {
      toast.error("Укажите дату и время поездки");
      return false;
    }
    if (isRoundTrip && (!returnDate || !returnTime)) {
      toast.error("Укажите дату и время обратной поездки");
      return false;
    }

    const pickupValidationError = validatePickupDateTime(orderDate, orderTime);
    if (pickupValidationError) {
      toast.error(pickupValidationError);
      return false;
    }
    if (isRoundTrip) {
      const returnValidationError = validatePickupDateTime(returnDate, returnTime);
      if (returnValidationError) {
        toast.error(`Обратная поездка: ${returnValidationError.toLowerCase()}`);
        return false;
      }
    }

    try {
      setCreatingOrder(true);

      const desiredPickupTime = buildAtyrauPickupDate(orderDate, orderTime);

      const pickupTitle = pickupAddress.trim() || `${pickupCoords!.lat.toFixed(6)}, ${pickupCoords!.lon.toFixed(6)}`;
      const dropoffTitle = dropoffAddress.trim() || `${dropoffCoords!.lat.toFixed(6)}, ${dropoffCoords!.lon.toFixed(6)}`;

      const buildOrderData = (pickup: { title: string; objectName: string; lat: number; lon: number }, dropoff: { title: string; objectName: string; lat: number; lon: number }, time: Date, note?: string) => {
        const data: any = {
          pickup_title: pickup.title,
          pickup_object_name: pickup.objectName,
          dropoff_title: dropoff.title,
          dropoff_object_name: dropoff.objectName,
          pickup_lat: pickup.lat,
          pickup_lon: pickup.lon,
          dropoff_lat: dropoff.lat,
          dropoff_lon: dropoff.lon,
          desired_pickup_time: time.toISOString(),
          note: note?.trim() || undefined,
          has_companion: orderHasCompanion,
          region_id: orderRegionId,
        };
        if (useExistingPassenger && passengerIdToUse) {
          data.passenger_id = passengerIdToUse;
        } else {
          const trimmedPhone = passengerPhone.trim();
          data.passenger_phone = trimmedPhone;
          if (useNewPassenger || passengerName || passengerDisabilityCategory) {
            data.passenger_name = passengerName.trim() || `Пассажир ${trimmedPhone}`;
            if (orderRegionId) data.passenger_region_id = orderRegionId;
            data.passenger_disability_category = passengerDisabilityCategory || 'III группа';
            data.passenger_allowed_companion = passengerAllowedCompanion;
          }
        }
        return data;
      };

      const pickupData = { title: pickupTitle, objectName: pickupObjectName.trim(), lat: pickupCoords!.lat, lon: pickupCoords!.lon };
      const dropoffData = { title: dropoffTitle, objectName: dropoffObjectName.trim(), lat: dropoffCoords!.lat, lon: dropoffCoords!.lon };

      const orderDataThere = buildOrderData(pickupData, dropoffData, desiredPickupTime, orderNote);
      if (!useExistingPassenger && !orderDataThere.passenger_phone) {
        toast.error("Телефон пассажира не может быть пустым");
        setCreatingOrder(false);
        return false;
      }

      console.log('Отправляем данные заказа (туда):', orderDataThere);
      const newOrderThere = await ordersApi.createOrder(orderDataThere);

      if (isRoundTrip) {
        const returnPickupTime = buildAtyrauPickupDate(returnDate, returnTime);

        const returnOrderData = buildOrderData(dropoffData, pickupData, returnPickupTime, orderNote);
        returnOrderData.passenger_id = newOrderThere.passenger.id;

        console.log('Отправляем данные заказа (обратно):', returnOrderData);
        await ordersApi.createOrder(returnOrderData);
        toast.success("Заказы «туда» и «обратно» успешно созданы!");
      } else {
        toast.success("Заказ успешно создан!");
      }

      notifyDispatchOrdersChanged(desiredPickupTime.toISOString());
      loadOrders();
      return true;
    } catch (err: any) {
      console.error("Ошибка создания заказа:", err);
      toast.error(err.response?.data?.detail || err.message || "Ошибка создания заказа");
      return false;
    } finally {
      setCreatingOrder(false);
    }
  };

  const resetPassengerFields = () => {
    setPassengerPhone("");
    setPassengerName("");
    setPassengerRegionId("");
    setOrderRegionId("");
    setPassengerDisabilityCategory("");
    setPassengerAllowedCompanion(false);
    setMatchingPassengers([]);
    setSelectedPassengerMode(null);
    setSelectedExistingPassengerId(null);
    setSelectedPassengerId("");
    setOrderNote("");
  };

  const resetRouteAndTime = () => {
    setGeocodeErrorPickup(null);
    setGeocodeErrorDropoff(null);
    setPickupAddress("");
    setPickupObjectName("");
    setDropoffAddress("");
    setDropoffObjectName("");
    setPickupCoords(null);
    setDropoffCoords(null);
    setPickupCoordsInput("");
    setDropoffCoordsInput("");
    setOrderRegionId("");
    setOrderNote("");
    setOrderHasCompanion(false);
    setIsRoundTrip(false);
    setReturnDate("");
    setReturnTime("");
    setOrderDate(getTomorrowDateInAtyrau());
    setOrderTime(getDefaultTimeGMT5());
  };

  const handleCreateOrder = async () => {
    const success = await performCreateOrder();
    if (success) {
      setCreateModal(false);
      setGeocodeErrorPickup(null);
      setGeocodeErrorDropoff(null);
      setPassengerPhone("");
      setPassengerName("");
      setPassengerRegionId("");
      setPassengerDisabilityCategory("");
      setPassengerAllowedCompanion(false);
      setMatchingPassengers([]);
      setSelectedPassengerMode(null);
      setSelectedExistingPassengerId(null);
      resetRouteAndTime();
      setSelectedPassengerId("");
      setMamashChildIndex(1);
    }
  };

  const handleCreateOrderAndAddAnother = async () => {
    const success = await performCreateOrder();
    if (success) {
      resetRouteAndTime();
    }
  };

  const handleCreateOrderMamash = async () => {
    if (isRoundTrip) {
      toast.error("Режим «Мамаш» не поддерживает «Туда-обратно». Создайте отдельные заказы.");
      return;
    }
    const success = await performCreateOrder();
    if (success) {
      const nextChild = mamashChildIndex + 1;
      setMamashChildIndex(nextChild);
      resetPassengerFields();
      toast.success(
        mamashChildIndex === 1
          ? "Заказ создан. Введите данные следующего ребёнка с того же адреса."
          : `Ребёнок ${mamashChildIndex} добавлен. Введите данные ребёнка ${nextChild}.`
      );
    }
  };

  // Auto-open order if selectedOrderId is provided
  useEffect(() => {
    if (selectedOrderId) {
      setViewModal(selectedOrderId);
    }
  }, [selectedOrderId]);

  // Handle modal close and notify parent
  const handleViewModalClose = () => {
    setViewModal(null);
    if (onOrderClose) {
      onOrderClose();
    }
  };

  // Refresh orders after status update
  const refreshOrders = () => {
    loadOrders();
  };

  // Load candidates when assign modal opens
  useEffect(() => {
    const loadCandidates = async () => {
      if (assignModal) {
        try {
          setLoadingCandidates(true);
          setError(null);
          
          const order = orders.find(o => o.id === assignModal);
          
          // Блокируем назначение для завершенных и отмененных заказов
          const blockedStatuses = ['completed', 'cancelled'];
          if (order && blockedStatuses.includes(order.status)) {
            setError(`Нельзя назначить водителя на заказ в статусе "${statusMap[order.status] || order.status}". Заказ уже завершен или отменен.`);
            setCandidates([]);
            setLoadingCandidates(false);
            return;
          }
          
          const response = await dispatchApi.getCandidates(assignModal);
          setCandidates(response.candidates || []);
          setSelectedDriverId(null); // Reset selection
        } catch (err: any) {
          setError(err.message || "Ошибка загрузки кандидатов");
          setCandidates([]);
        } finally {
          setLoadingCandidates(false);
        }
      }
    };
    loadCandidates();
  }, [assignModal, orders]);

  // Helper function to safely format numbers
  const safeToFixed = useCallback((value: any, decimals: number = 2): string => {
    if (value === null || value === undefined) return '0.00';
    const num = typeof value === 'string' ? parseFloat(value) : Number(value);
    return !isNaN(num) ? num.toFixed(decimals) : '0.00';
  }, []);

  // Helper function to safely convert to number
  const safeToNumber = useCallback((value: any): number => {
    if (value === null || value === undefined) return 0;
    const num = typeof value === 'string' ? parseFloat(value) : Number(value);
    return !isNaN(num) ? num : 0;
  }, []);

  // Helper function to format order for display (moved before useMemo that uses it)
  const formatOrderForDisplay = useCallback((order: Order) => {
    const displayStatus = statusMap[order.status] || order.status;
    const pickupParts = formatPickupDateParts(order.desired_pickup_time);
    const priceRaw = order.final_price || order.estimated_price || order.quote;
    // Преобразуем price в число, если это строка или Decimal
    const price = priceRaw ? (typeof priceRaw === 'string' ? parseFloat(priceRaw) : Number(priceRaw)) : null;
    return {
      id: order.id,
      passenger: order.passenger.full_name,
      driver: order.driver?.name || "Неназначен",
      from: formatOrderAddressDisplay(order.pickup_object_name, order.pickup_title),
      to: formatOrderAddressDisplay(order.dropoff_object_name, order.dropoff_title),
      regionTitle: order.region?.title || order.passenger?.region?.title || "—",
      status: displayStatus,
      time: pickupParts.time,
      date: pickupParts.date,
      price: price && !isNaN(price) ? `${price.toFixed(2)} ₸` : "—",
      priceValue: price && !isNaN(price) ? price : 0,
      distance: order.distance_km,
      order: order,
    };
  }, []);

  // Find selected order data (using useMemo to ensure it's computed correctly)
  const selectedOrderData = useMemo(() => {
    return orders.find(
      (o) => o.id === viewModal || o.id === editModal || o.id === assignModal
    );
  }, [orders, viewModal, editModal, assignModal]);

  const selectedOrder = useMemo(() => {
    return selectedOrderData ? formatOrderForDisplay(selectedOrderData) : null;
  }, [selectedOrderData, formatOrderForDisplay]);

  // Get available status transitions (соответствует логике бэкенда из OrderService.validate_status_transition)
  const getAvailableStatuses = (currentStatus: string): string[] => {
    // Валидные переходы для каждого статуса (точно соответствуют бэкенду)
    const statusTransitions: Record<string, string[]> = {
      'draft': ['submitted', 'cancelled'],
      'submitted': ['awaiting_dispatcher_decision', 'rejected', 'cancelled'],
      'awaiting_dispatcher_decision': ['active_queue', 'rejected', 'cancelled'],
      'rejected': ['submitted', 'cancelled'], // Можно восстановить отклоненный заказ, вернув в submitted
      'active_queue': ['assigned', 'cancelled'],
      'assigned': ['driver_en_route', 'cancelled'],
      'driver_en_route': ['arrived_waiting', 'cancelled'],
      'arrived_waiting': ['ride_ongoing', 'no_show', 'cancelled'],
      'no_show': ['cancelled'],
      'ride_ongoing': ['completed', 'incident', 'cancelled'],
      'incident': ['completed', 'cancelled'],
      'completed': [], // Завершенный заказ нельзя изменить (нет переходов в бэкенде)
      'cancelled': ['submitted', 'active_queue'], // Можно восстановить отмененный заказ
    };

    // Возвращаем валидные переходы для текущего статуса
    const validTransitions = statusTransitions[currentStatus];
    return validTransitions || [];
  };

  // Handle edit modal open
  useEffect(() => {
    if (editModal && selectedOrderData) {
      setEditingStatus(selectedOrderData.status);
      setEditingNote(selectedOrderData.note || "");
      setEditingPickupObjectName(selectedOrderData.pickup_object_name || "");
      setEditingDropoffObjectName(selectedOrderData.dropoff_object_name || "");
      setEditingPickupAddress(selectedOrderData.pickup_title || "");
      setEditingDropoffAddress(selectedOrderData.dropoff_title || "");
      const pickup = {
        lat: selectedOrderData.pickup_lat ?? selectedOrderData.pickup_coordinate?.lat,
        lon: selectedOrderData.pickup_lon ?? selectedOrderData.pickup_coordinate?.lon,
      };
      const dropoff = {
        lat: selectedOrderData.dropoff_lat ?? selectedOrderData.dropoff_coordinate?.lat,
        lon: selectedOrderData.dropoff_lon ?? selectedOrderData.dropoff_coordinate?.lon,
      };
      if (pickup.lat != null && pickup.lon != null) {
        setEditingPickupCoords(pickup);
        setEditingPickupCoordsInput(formatLatLonPair(pickup.lat, pickup.lon));
      } else {
        setEditingPickupCoords(null);
        setEditingPickupCoordsInput("");
      }
      if (dropoff.lat != null && dropoff.lon != null) {
        setEditingDropoffCoords(dropoff);
        setEditingDropoffCoordsInput(formatLatLonPair(dropoff.lat, dropoff.lon));
      } else {
        setEditingDropoffCoords(null);
        setEditingDropoffCoordsInput("");
      }
      setEditingGeocodeErrorPickup(null);
      setEditingGeocodeErrorDropoff(null);
      const dt = selectedOrderData.desired_pickup_time
        ? new Date(selectedOrderData.desired_pickup_time)
        : new Date();
      setEditingOrderDate(dt.toLocaleDateString("en-CA", { timeZone: "Asia/Atyrau" }));
      setEditingOrderTime(
        dt.toLocaleTimeString("en-GB", {
          timeZone: "Asia/Atyrau",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      );
    }
  }, [editModal, selectedOrderData]);

  // Handle save order edit
  const handleSaveOrder = async () => {
    if (!editModal || !selectedOrderData) return;

    try {
      setSaving(true);
      setError(null);

      // Если статус изменился, обновляем через updateOrderStatus
      if (editingStatus !== selectedOrderData.status) {
        await ordersApi.updateOrderStatus(editModal, {
          status: editingStatus,
          reason: `Изменение статуса с ${selectedOrderData.status} на ${editingStatus}`
        });
        if (editingStatus === "cancelled") {
          notifyDispatchOrdersChanged(selectedOrderData.desired_pickup_time);
        }
      }

      // Собираем изменения для updateOrder
      const updates: Record<string, any> = {};
      if (editingNote !== (selectedOrderData.note || "")) {
        updates.note = editingNote;
      }
      const originalDt = selectedOrderData.desired_pickup_time
        ? new Date(selectedOrderData.desired_pickup_time)
        : new Date();
      const originalDate = originalDt.toLocaleDateString("en-CA", { timeZone: "Asia/Atyrau" });
      const originalTime = originalDt.toLocaleTimeString("en-GB", {
        timeZone: "Asia/Atyrau",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      if (editingOrderDate !== originalDate || editingOrderTime !== originalTime) {
        const pickupValidationError = validatePickupDateTime(editingOrderDate, editingOrderTime);
        if (pickupValidationError) {
          toast.error(pickupValidationError);
          setSaving(false);
          return;
        }
        const newPickupTime = buildAtyrauPickupDate(editingOrderDate, editingOrderTime);
        updates.desired_pickup_time = newPickupTime.toISOString();
      }
      if (editingPickupObjectName !== (selectedOrderData.pickup_object_name || "")) {
        updates.pickup_object_name = editingPickupObjectName;
      }
      if (editingDropoffObjectName !== (selectedOrderData.dropoff_object_name || "")) {
        updates.dropoff_object_name = editingDropoffObjectName;
      }
      if (editingPickupAddress !== (selectedOrderData.pickup_title || "")) {
        updates.pickup_title = editingPickupAddress;
      }
      if (editingDropoffAddress !== (selectedOrderData.dropoff_title || "")) {
        updates.dropoff_title = editingDropoffAddress;
      }
      if (editingPickupCoords) {
        if (
          editingPickupCoords.lat !== selectedOrderData.pickup_lat ||
          editingPickupCoords.lon !== selectedOrderData.pickup_lon
        ) {
          updates.pickup_lat = editingPickupCoords.lat;
          updates.pickup_lon = editingPickupCoords.lon;
        }
      }
      if (editingDropoffCoords) {
        if (
          editingDropoffCoords.lat !== selectedOrderData.dropoff_lat ||
          editingDropoffCoords.lon !== selectedOrderData.dropoff_lon
        ) {
          updates.dropoff_lat = editingDropoffCoords.lat;
          updates.dropoff_lon = editingDropoffCoords.lon;
        }
      }
      if (Object.keys(updates).length > 0) {
        await ordersApi.updateOrder(editModal, updates);
      }

      // Обновляем список заказов
      await refreshOrders();
      setEditModal(null);
      setEditingStatus("");
      setEditingNote("");
      setEditingPickupObjectName("");
      setEditingDropoffObjectName("");
      setEditingPickupAddress("");
      setEditingDropoffAddress("");
      setEditingPickupCoords(null);
      setEditingDropoffCoords(null);
      setEditingPickupCoordsInput("");
      setEditingDropoffCoordsInput("");
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.message || "Ошибка сохранения заказа";
      setError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  // Generate random coordinates within city bounds (Атырау)
  const generateRandomCoordinates = () => {
    // Центр Атырау: 47.10869114222083, 51.9049072265625
    // Генерируем координаты в радиусе примерно 10 км от центра
    const centerLat = 47.10869114222083;
    const centerLon = 51.9049072265625;
    const radiusKm = 10;
    
    // Примерно 1 градус широты = 111 км
    // Примерно 1 градус долготы на этой широте ≈ 75 км
    const latOffset = (Math.random() * 2 - 1) * (radiusKm / 111);
    const lonOffset = (Math.random() * 2 - 1) * (radiusKm / 75);
    
    return {
      lat: centerLat + latOffset,
      lon: centerLon + lonOffset
    };
  };

  // Generate random address
  const generateRandomAddress = () => {
    const streets = [
      'ул. Абая',
      'ул. Сатпаева',
      'пр. Азаттык',
      'ул. Байтурсынова',
      'ул. Жамбыла',
      'пр. Назарбаева',
      'ул. Казыбек би',
      'ул. Муканова',
      'ул. Пушкина',
      'ул. Ленина',
      'ул. Гагарина',
      'ул. Мира',
      'ул. Центральная',
      'ул. Новая',
      'ул. Советская',
      'ул. Ауэзова',
      'ул. Достык',
      'ул. Курмангазы',
      'пр. Республики',
      'ул. Шевченко'
    ];
    
    const street = streets[Math.floor(Math.random() * streets.length)];
    const building = Math.floor(Math.random() * 200) + 1;
    
    return `${street}, ${building}`;
  };

  const handleGenerateAtyrauOrders = async () => {
    if (passengers.length === 0) {
      toast.error("Нет доступных пассажиров для создания заказов");
      return;
    }

    if (ordersPerSlot < 1 || ordersPerSlot > 20) {
      toast.error("На каждый час — от 1 до 20 заказов");
      return;
    }

    try {
      setGeneratingOrders(true);
      setError(null);

      const result = await ordersApi.generateAtyrauOrders({
        date: generateDate,
        orders_per_slot: ordersPerSlot,
        replace: replaceGenerated,
      });

      await refreshOrders();

      toast.success(
        `Создано ${result.created_count} заказов на ${result.date} ` +
          `(${result.orders_per_slot}×${result.slots_count} слотов, 06:00–23:00, Атырау)`
      );
      if (result.skipped_count) {
        toast.info(`Пропущено (уже существуют): ${result.skipped_count}`);
      }
      if (result.auto_dispatch?.status === "scheduled") {
        toast.info("Автоназначение выполняется в фоне…");
        window.dispatchEvent(
          new CustomEvent("invotaxi:orders-generated", { detail: { date: result.date } })
        );
        const pollUntil = Date.now() + 30000;
        const pollAutoDispatch = async () => {
          if (Date.now() > pollUntil) return;
          await refreshOrders();
          setTimeout(pollAutoDispatch, 2500);
        };
        setTimeout(pollAutoDispatch, 2500);
      }

      setGenerateModal(false);
      setOrdersPerSlot(5);
      setGenerateDate(getTomorrowDateInAtyrau());
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.message || "Ошибка генерации заказов";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setGeneratingOrders(false);
    }
  };

  // Handle driver assignment
  const handleAssignDriver = async () => {
    if (!assignModal || !selectedDriverId) {
      setError("Выберите водителя");
      return;
    }

    // Проверяем, что выбранный водитель есть в списке кандидатов
    const selectedDriver = candidates.find(c => String(c.driver_id) === String(selectedDriverId));
    if (!selectedDriver && candidates.length > 0) {
      console.warn(`Выбранный водитель ${selectedDriverId} не найден в списке кандидатов`);
      // Продолжаем попытку назначения - возможно водитель был добавлен после загрузки кандидатов
    }

    try {
      setAssigning(true);
      setError(null);
      
      console.log(`Назначение водителя ${selectedDriverId} на заказ ${assignModal}`);
      const response = await dispatchApi.assignOrder(assignModal, String(selectedDriverId));
      
      if (response.success) {
        // Refresh orders list
        await refreshOrders();
        setAssignModal(null);
        setSelectedDriverId(null);
        setCandidates([]);
        const sch = response.schedule;
        if (sch?.timeline?.length) {
          toast.success(
            `Водитель назначен. В очереди ${sch.timeline.length} этап(ов), ~${Math.round(sch.total_chain_minutes ?? 0)} мин по расчёту.`
          );
        } else {
          toast.success(`Водитель успешно назначен на заказ`);
        }
      } else {
        const errorMsg = response.rejection_reason || response.error || response.reason || "Не удалось назначить водителя";
        setError(errorMsg);
        toast.error(errorMsg);
      }
    } catch (err: any) {
      // Получаем детальное сообщение об ошибке
      const errorDetails = err.response?.data;
      let errorMessage = err.message || "Ошибка назначения водителя";
      
      console.error("Ошибка назначения водителя:", err);
      console.error("Детали ошибки:", errorDetails);
      console.error("Полный ответ:", err.response);
      
      if (errorDetails) {
        if (errorDetails.error) {
          errorMessage = errorDetails.error;
          // Добавляем дополнительную информацию если есть
          const details: string[] = [];
          
          if (errorDetails.current_status) {
            details.push(`Текущий статус: ${errorDetails.current_status}`);
          }
          if (errorDetails.valid_transitions && Array.isArray(errorDetails.valid_transitions) && errorDetails.valid_transitions.length > 0) {
            details.push(`Допустимые переходы: ${errorDetails.valid_transitions.join(', ')}`);
          }
          if (errorDetails.driver_name) {
            details.push(`Водитель: ${errorDetails.driver_name}`);
          }
          if (errorDetails.is_online === false) {
            details.push(`Водитель не онлайн. Включите онлайн статус.`);
          }
          if (errorDetails.driver_capacity !== undefined && errorDetails.required_seats !== undefined) {
            details.push(`Вместимость: ${errorDetails.driver_capacity}, требуется: ${errorDetails.required_seats}`);
          }
          if (errorDetails.driver_status) {
            details.push(`Статус водителя: ${errorDetails.driver_status}`);
          }
          if (Array.isArray(errorDetails.schedule) && errorDetails.schedule.length > 0) {
            const legs = errorDetails.schedule.map(
              (leg: { order_id?: string; arrival_at_pickup?: string; deadline?: string }) =>
                `${leg.order_id ?? "?"}: прибытие ~${(leg.arrival_at_pickup || "").slice(11, 16)}, крайний срок ${(leg.deadline || "").slice(11, 16)}`
            );
            details.push(`Расчёт очереди: ${legs.join(" | ")}`);
          }
          
          if (details.length > 0) {
            errorMessage += '\n' + details.join('\n');
          }
        } else if (errorDetails.detail) {
          errorMessage = errorDetails.detail;
        } else if (typeof errorDetails === 'string') {
          errorMessage = errorDetails;
        }
      }
      
      setError(errorMessage);
      toast.error(errorMessage.split('\n')[0]); // Показываем только первую строку в toast
    } finally {
      setAssigning(false);
    }
  };

  const handleAutoAssign = async () => {
    if (!assignModal) return;
    try {
      setAssigning(true);
      setError(null);
      await dispatchApi.assignOrder(assignModal);
      await refreshOrders();
      setAssignModal(null);
      setSelectedDriverId(null);
      setCandidates([]);
      toast.success("Заказ передан на автоматическое распределение");
    } catch (err: any) {
      const message = err?.response?.data?.error?.message || err?.message || "Не удалось распределить заказ";
      setError(message);
      toast.error(message);
    } finally {
      setAssigning(false);
    }
  };

  // Сортировка (фильтрация на сервере)
  const sortedOrders = useMemo(() => {
    return [...orders].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortField) {
        case 'id':
          aValue = a.id;
          bValue = b.id;
          break;
        case 'pickup':
          aValue = a.desired_pickup_time
            ? new Date(a.desired_pickup_time).getTime()
            : 0;
          bValue = b.desired_pickup_time
            ? new Date(b.desired_pickup_time).getTime()
            : 0;
          break;
        case 'status':
          aValue = statusMap[a.status] || a.status;
          bValue = statusMap[b.status] || b.status;
          break;
        case 'passenger':
          aValue = a.passenger.full_name;
          bValue = b.passenger.full_name;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [orders, sortField, sortDirection]);

  // Sort function
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-4 h-4" />;
    return sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Ожидание":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "В пути":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "Выполнено":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "Отменён":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl dark:text-white">Управление заказами</h1>
          <p className="text-gray-600 dark:text-gray-400">Просмотр и управление всеми заказами</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {user?.role !== "operator" && (
          <button 
            onClick={() => setGenerateModal(true)}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600"
          >
            <Sparkles className="w-5 h-5" />
            Генерировать заказы
          </button>
          )}
          {user?.role !== "operator" && (
            <button 
              onClick={() => setImportModal(true)}
              className="bg-green-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600"
            >
              <Upload className="w-5 h-5" />
              Импорт заказов
            </button>
          )}
          <button 
            onClick={() => setExportModal(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            <Download className="w-5 h-5" />
            Экспорт
          </button>
          {user?.role !== "operator" && (
            <button 
              onClick={() => setClearAllModal(true)}
              className="bg-red-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600"
            >
              <X className="w-5 h-5" />
              Очистить все заказы
            </button>
          )}
          <button 
            onClick={() => {
              setMamashChildIndex(1);
              setCreateModal(true);
            }}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            <Plus className="w-5 h-5" />
            Создать заказ
          </button>
        </div>
      </div>

      {/* Navigation Alert */}
      {selectedOrderId && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-lg p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center">
            <Phone className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-indigo-900 dark:text-indigo-200">
              <strong>Переход из модуля звонков</strong>
            </p>
            <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-1">
              Заказ {selectedOrderId} выделен и открыт
            </p>
          </div>
          <button 
            onClick={handleViewModalClose}
            className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder="Поиск по ID, пассажиру или водителю..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div className="flex gap-2">
            {statuses.map((status) => (
              <button
                key={status}
                onClick={() => setSelectedStatus(status)}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  selectedStatus === status
                    ? "bg-indigo-600 text-white dark:bg-indigo-500"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Orders Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            <span className="ml-3 text-gray-600 dark:text-gray-400">Загрузка заказов...</span>
          </div>
        ) : (
        <>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
              <tr>
                  <th 
                    className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                    onClick={() => handleSort('id')}
                  >
                    <div className="flex items-center gap-2">
                  ID
                      {getSortIcon('id')}
                    </div>
                </th>
                  <th 
                    className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                    onClick={() => handleSort('passenger')}
                  >
                    <div className="flex items-center gap-2">
                  Пассажир
                      {getSortIcon('passenger')}
                    </div>
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Водитель
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Маршрут
                </th>
                  <th 
                    className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center gap-2">
                  Статус
                      {getSortIcon('status')}
                    </div>
                </th>
                  <th 
                    className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                    onClick={() => handleSort('pickup')}
                  >
                    <div className="flex items-center gap-2">
                  Забор (Атырау)
                      {getSortIcon('pickup')}
                    </div>
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {sortedOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                      Заказы не найдены
                    </td>
                  </tr>
                ) : (
                  sortedOrders.map((order) => {
                    const displayOrder = formatOrderForDisplay(order);
                    return (
                <tr 
                  key={order.id} 
                  className={`hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                    selectedOrderId === order.id 
                      ? 'bg-indigo-50 dark:bg-indigo-900/20 ring-2 ring-indigo-500 dark:ring-indigo-400' 
                      : ''
                  }`}
                >
                  <td className="px-6 py-4 whitespace-nowrap dark:text-white">
                          {displayOrder.id}
                  </td>
                        <td className="px-6 py-4 dark:text-white">{displayOrder.passenger}</td>
                  <td className="px-6 py-4 dark:text-white">
                          {displayOrder.driver === "Неназначен" ? (
                            <span className="text-gray-400 dark:text-gray-500">{displayOrder.driver}</span>
                    ) : (
                            displayOrder.driver
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm">
                            <p className="text-gray-900 dark:text-white">{displayOrder.from}</p>
                            <p className="text-gray-500 dark:text-gray-400">→ {displayOrder.to}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-xs ${getStatusColor(
                              displayOrder.status
                      )}`}
                    >
                            {displayOrder.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    <div>
                            <p>{displayOrder.date}</p>
                            <p>{displayOrder.time}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setViewModal(order.id)}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                        title="Просмотр"
                      >
                        <Eye className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setEditModal(order.id)}
                        className="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300"
                        title="Редактировать"
                      >
                        <Edit className="w-5 h-5" />
                      </button>
                            {displayOrder.driver === "Неназначен" &&
                        !['completed', 'cancelled'].includes(order.status) && (
                        <button
                          onClick={() => setAssignModal(order.id)}
                          className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
                          title="Назначить водителя"
                        >
                          <CarIcon className="w-5 h-5" />
                        </button>
                      )}
                      <button
                              onClick={() => setCallModal({ 
                                name: displayOrder.passenger, 
                                phone: order.passenger.user.phone, 
                                type: "passenger" 
                              })}
                        className="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300"
                        title="Позвонить пассажиру"
                      >
                        <Phone className="w-5 h-5" />
                      </button>
                            {displayOrder.driver !== "Неназначен" && order.driver && (
                        <button
                                onClick={() => setCallModal({ 
                                  name: displayOrder.driver, 
                                  phone: order.driver.user.phone, 
                                  type: "driver" 
                                })}
                          className="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300"
                          title="Позвонить водителю"
                        >
                          <Phone className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                    );
                  })
                )}
            </tbody>
          </table>
        </div>

        {/* Пагинация */}
        {totalCount > 0 && (
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Показано <span className="font-medium text-gray-900 dark:text-white">{sortedOrders.length}</span> из <span className="font-medium text-gray-900 dark:text-white">{totalCount}</span> заказов
            </p>
            <div className="flex gap-2">
              <button
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Предыдущая
              </button>
              <span className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg font-medium">
                {page}
              </span>
              <button
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={page * pageSize >= totalCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Следующая
              </button>
            </div>
          </div>
        )}
        </>
        )}
      </div>

      {/* View Modal */}
      <Modal
        isOpen={viewModal !== null}
        onClose={handleViewModalClose}
        title="Детали заказа"
        size="lg"
      >
        {selectedOrder && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">ID заказа</p>
                <p className="text-lg dark:text-white font-mono">{selectedOrder.id}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Статус</p>
                <span className={`inline-block px-3 py-1 rounded-full text-xs ${getStatusColor(selectedOrder.order.status)}`}>
                  {selectedOrder.status}
                </span>
              </div>
            </div>

            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Пассажир</p>
              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg space-y-2">
                <div className="flex items-center gap-3">
                  <UserCircle className="w-10 h-10 text-gray-400" />
                  <div className="flex-1">
                    <p className="dark:text-white font-medium">{selectedOrder.order.passenger.full_name}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{selectedOrder.order.passenger.user.phone}</p>
                    {selectedOrder.order.passenger.user.email && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">{selectedOrder.order.passenger.user.email}</p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                  {(selectedOrder.order.region || selectedOrder.order.passenger.region) && (
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Район заказа</p>
                      <p className="text-sm dark:text-white">
                        {selectedOrder.order.region?.title
                          || selectedOrder.order.passenger.region?.title
                          || "—"}
                      </p>
                    </div>
                  )}
                  {selectedOrder.order.passenger.disability_category && (
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Категория</p>
                      <p className="text-sm dark:text-white">{selectedOrder.order.passenger.disability_category}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {selectedOrder.driver !== "Неназначен" && selectedOrder.order.driver && (
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Водитель</p>
                <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg space-y-2">
                  <div className="flex items-center gap-3">
                    <CarIcon className="w-10 h-10 text-gray-400" />
                    <div className="flex-1">
                      <p className="dark:text-white font-medium">{selectedOrder.order.driver.name}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{selectedOrder.order.driver.user.phone}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Машина</p>
                      <p className="text-sm dark:text-white">{selectedOrder.order.driver.car_model}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Гос. номер</p>
                      <p className="text-sm dark:text-white">{selectedOrder.order.driver.plate_number}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <CabinRecordingPanel
              orderId={selectedOrder.id}
              orderStatus={selectedOrder.order.status}
              initial={selectedOrder.order.cabin_recording}
              videoRecording={selectedOrder.order.video_recording}
            />

            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Маршрут</p>
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex items-start gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs">A</div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Откуда</p>
                      <p className="dark:text-white">{selectedOrder.from}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center text-white text-xs">B</div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Куда</p>
                      <p className="dark:text-white">{selectedOrder.to}</p>
                    </div>
                  </div>
                </div>
                
                {/* Мини-карта с маршрутом */}
                {selectedOrder.order.pickup_lat && selectedOrder.order.pickup_lon && 
                 selectedOrder.order.dropoff_lat && selectedOrder.order.dropoff_lon && (
                  <RouteMapView
                    pickupLat={selectedOrder.order.pickup_lat}
                    pickupLon={selectedOrder.order.pickup_lon}
                    dropoffLat={selectedOrder.order.dropoff_lat}
                    dropoffLon={selectedOrder.order.dropoff_lon}
                    pickupTitle={selectedOrder.from}
                    dropoffTitle={selectedOrder.to}
                    distanceKm={selectedOrder.order.distance_km}
                    orderId={selectedOrder.id}
                    height="250px"
                  />
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Желаемое время забора</p>
                <p className="dark:text-white">
                  {selectedOrder.order.desired_pickup_time
                    ? (() => {
                        const p = formatPickupDateParts(selectedOrder.order.desired_pickup_time);
                        return `${p.date}, ${p.time}`;
                      })()
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Расстояние</p>
                <p className="dark:text-white">{selectedOrder.order.distance_km ? `${safeToFixed(selectedOrder.order.distance_km, 2)} км` : "—"}</p>
              </div>
            </div>

            {/* Дополнительная информация */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Создан</p>
                <p className="dark:text-white">
                  {new Date(selectedOrder.order.created_at).toLocaleString('ru-RU', {
                    timeZone: ATYRAU_TZ,
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                </p>
              </div>
              {selectedOrder.order.assigned_at && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Назначен</p>
                  <p className="dark:text-white">
                    {new Date(selectedOrder.order.assigned_at).toLocaleString('ru-RU', {
                      timeZone: ATYRAU_TZ,
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </p>
                </div>
              )}
              {selectedOrder.order.completed_at && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Завершен</p>
                  <p className="dark:text-white">
                    {new Date(selectedOrder.order.completed_at).toLocaleString('ru-RU', {
                      timeZone: ATYRAU_TZ,
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </p>
                </div>
              )}
              {selectedOrder.order.waiting_time_minutes && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Время ожидания</p>
                  <p className="dark:text-white">{selectedOrder.order.waiting_time_minutes} мин</p>
                </div>
              )}
            </div>

            {/* Особенности заказа */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Особенности</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  {selectedOrder.order.has_companion && (
                    <span className="inline-block px-2 py-1 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded text-xs">
                      С сопровождением
                    </span>
                  )}
                  {selectedOrder.order.video_recording && (
                    <span className="inline-block px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded text-xs">
                      Видеозапись
                    </span>
                  )}
                  {selectedOrder.order.seats_needed > 1 && (
                    <span className="inline-block px-2 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded text-xs">
                      Мест: {selectedOrder.order.seats_needed}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Координаты</p>
                <div className="text-xs dark:text-gray-300 mt-1">
                  <p>Откуда: {safeToFixed(selectedOrder.order.pickup_lat, 6)}, {safeToFixed(selectedOrder.order.pickup_lon, 6)}</p>
                  <p>Куда: {safeToFixed(selectedOrder.order.dropoff_lat, 6)}, {safeToFixed(selectedOrder.order.dropoff_lon, 6)}</p>
                </div>
              </div>
            </div>

            {/* Примечание */}
            {selectedOrder.order.note && (
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Примечание</p>
                <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <p className="text-sm dark:text-white">{selectedOrder.order.note}</p>
                </div>
              </div>
            )}

            {/* Причины */}
            {(selectedOrder.order.assignment_reason || selectedOrder.order.rejection_reason) && (
              <div className="space-y-2">
                {selectedOrder.order.assignment_reason && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Причина назначения</p>
                    <p className="text-sm dark:text-white p-2 bg-green-50 dark:bg-green-900/20 rounded">{selectedOrder.order.assignment_reason}</p>
                  </div>
                )}
                {selectedOrder.order.rejection_reason && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Причина отклонения</p>
                    <p className="text-sm dark:text-white p-2 bg-red-50 dark:bg-red-900/20 rounded">{selectedOrder.order.rejection_reason}</p>
                  </div>
                )}
              </div>
            )}

            {/* Цена */}
            {(selectedOrder.order.final_price || selectedOrder.order.estimated_price) && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {selectedOrder.order.final_price ? "Финальная стоимость" : "Предварительная стоимость"}
                    </p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
                      {safeToFixed(selectedOrder.order.final_price || selectedOrder.order.estimated_price || selectedOrder.order.quote)} ₸
                    </p>
                  </div>
                  {selectedOrder.order.final_price && selectedOrder.order.estimated_price && (
                    <div className="text-right">
                      <p className="text-xs text-gray-500 dark:text-gray-400">Было оценено</p>
                      <p className="text-sm line-through text-gray-400">
                        {safeToFixed(selectedOrder.order.estimated_price || selectedOrder.order.quote)} ₸
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Детализация цены */}
            {selectedOrder.order.price_breakdown && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Детализация стоимости</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Расстояние ({safeToFixed(selectedOrder.order.distance_km, 2)} км)</span>
                    <span className="dark:text-white">{safeToFixed(selectedOrder.order.price_breakdown.base_distance_price)} ₸</span>
                  </div>
                  {selectedOrder.order.price_breakdown.waiting_time_price > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Ожидание ({selectedOrder.order.waiting_time_minutes || 0} мин)</span>
                      <span className="dark:text-white">{safeToFixed(selectedOrder.order.price_breakdown.waiting_time_price)} ₸</span>
                    </div>
                  )}
                  {selectedOrder.order.has_companion && selectedOrder.order.price_breakdown.companion_fee > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Доплата за сопровождение</span>
                      <span className="dark:text-white">{safeToFixed(selectedOrder.order.price_breakdown.companion_fee)} ₸</span>
                    </div>
                  )}
                  {selectedOrder.order.price_breakdown.disability_multiplier && selectedOrder.order.price_breakdown.disability_multiplier !== 1.0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Множитель категории</span>
                      <span className="dark:text-white">×{safeToFixed(selectedOrder.order.price_breakdown.disability_multiplier)}</span>
                    </div>
                  )}
                  {selectedOrder.order.price_breakdown.night_multiplier && selectedOrder.order.price_breakdown.night_multiplier !== 1.0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Ночной тариф</span>
                      <span className="dark:text-white">×{safeToFixed(selectedOrder.order.price_breakdown.night_multiplier)}</span>
                    </div>
                  )}
                  {selectedOrder.order.price_breakdown.weekend_multiplier && selectedOrder.order.price_breakdown.weekend_multiplier !== 1.0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Выходной день</span>
                      <span className="dark:text-white">×{safeToFixed(selectedOrder.order.price_breakdown.weekend_multiplier)}</span>
                    </div>
                  )}
                  {selectedOrder.order.price_breakdown.minimum_fare_adjustment && selectedOrder.order.price_breakdown.minimum_fare_adjustment > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Минимальная стоимость</span>
                      <span className="dark:text-white">+{safeToFixed(selectedOrder.order.price_breakdown.minimum_fare_adjustment)} ₸</span>
                    </div>
                  )}
                  {selectedOrder.order.price_breakdown.subtotal && (
                    <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                      <span className="text-gray-600 dark:text-gray-400">Промежуточный итог</span>
                      <span className="dark:text-white">{safeToFixed(selectedOrder.order.price_breakdown.subtotal)} ₸</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700 font-semibold">
                    <span className="text-gray-900 dark:text-white">Итого</span>
                    <span className="text-xl text-green-600 dark:text-green-400">
                      {selectedOrder.order.price_breakdown.total ? 
                        `${safeToFixed(selectedOrder.order.price_breakdown.total)} ₸` : 
                        (selectedOrder.order.final_price || selectedOrder.order.estimated_price || selectedOrder.order.quote ? 
                          `${safeToFixed(selectedOrder.order.final_price || selectedOrder.order.estimated_price || selectedOrder.order.quote)} ₸` : 
                          "—")}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button className="flex-1 bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700">
                На карте
              </button>
              <button
                onClick={handleViewModalClose}
                className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Закрыть
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={editModal !== null}
        onClose={() => {
          setEditModal(null);
          setEditingStatus("");
          setEditingNote("");
          setEditingOrderDate("");
          setEditingOrderTime("");
          setEditingPickupObjectName("");
          setEditingDropoffObjectName("");
          setEditingPickupAddress("");
          setEditingDropoffAddress("");
          setEditingPickupCoords(null);
          setEditingDropoffCoords(null);
          setEditingPickupCoordsInput("");
          setEditingDropoffCoordsInput("");
          setEditingGeocodeErrorPickup(null);
          setEditingGeocodeErrorDropoff(null);
        }}
        title="Редактировать заказ"
        size="xl"
      >
        {selectedOrder && (
          <div className="space-y-4">
            <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <p className="text-sm text-gray-500 dark:text-gray-400">Заказ</p>
              <p className="dark:text-white font-medium">{selectedOrder.id}</p>
            </div>

            {user?.role !== "operator" && getAvailableStatuses(selectedOrder.order.status).includes('cancelled') && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">Отменить заказ</p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">Чтобы отменить заказ, выберите «Отменено» в статусе ниже или нажмите кнопку:</p>
                <button
                  type="button"
                  onClick={async () => {
                    if (!editModal) return;
                    setSaving(true);
                    try {
                      await ordersApi.updateOrderStatus(editModal, { status: 'cancelled', reason: 'Отменено диспетчером' });
                      notifyDispatchOrdersChanged(selectedOrder.order.desired_pickup_time);
                      toast.success('Заказ отменён');
                      await refreshOrders();
                      setEditModal(null);
                    } catch (err: any) {
                      toast.error(err.response?.data?.error || 'Не удалось отменить заказ');
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm disabled:opacity-50"
                >
                  Отменить заказ
                </button>
              </div>
            )}

            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Статус</label>
              {getAvailableStatuses(selectedOrder.order.status).length > 0 ? (
                <>
                  <select
                    value={editingStatus}
                    onChange={(e) => setEditingStatus(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value={selectedOrder.order.status}>
                      {statusMap[selectedOrder.order.status] || selectedOrder.order.status} (текущий)
                    </option>
                    {getAvailableStatuses(selectedOrder.order.status).map((status) => (
                      <option key={status} value={status}>
                        {statusMap[status] || status}
                      </option>
                    ))}
              </select>
                  {editingStatus !== selectedOrder.order.status && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                      Статус будет изменен с "{statusMap[selectedOrder.order.status] || selectedOrder.order.status}" на "{statusMap[editingStatus] || editingStatus}"
                    </p>
                  )}
                </>
              ) : (
                <div className="px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 bg-gray-50">
                  <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                    {statusMap[selectedOrder.order.status] || selectedOrder.order.status}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Изменение статуса недоступно для этого заказа
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Дата и время</label>
                <input
                  type="date"
                  value={editingOrderDate}
                  onChange={(e) => setEditingOrderDate(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">&nbsp;</label>
                <input
                  type="time"
                  value={editingOrderTime}
                  onChange={(e) => setEditingOrderTime(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {selectedOrderData.status !== "completed" && (
              <div className="space-y-4 border-t border-gray-200 dark:border-gray-600 pt-4">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Маршрут</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                      Название объекта (откуда)
                    </label>
                    <input
                      type="text"
                      value={editingPickupObjectName}
                      onChange={(e) => setEditingPickupObjectName(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                      Название объекта (куда)
                    </label>
                    <input
                      type="text"
                      value={editingDropoffObjectName}
                      onChange={(e) => setEditingDropoffObjectName(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                      Откуда (адрес)
                    </label>
                    <div className="relative">
                      <input
                        ref={editingPickupAddressInputRef}
                        type="text"
                        value={editingPickupAddress}
                        onChange={(e) => {
                          setEditingPickupAddress(e.target.value);
                          setEditingGeocodeErrorPickup(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          geocodeEditingPickupAddress(editingPickupAddress);
                        }}
                        className={`w-full px-4 py-2 pr-10 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white ${
                          editingGeocodeErrorPickup
                            ? "border-red-300 dark:border-red-600"
                            : "border-gray-300 dark:border-gray-600"
                        }`}
                      />
                      {editingGeocodingPickup && (
                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                        </div>
                      )}
                    </div>
                    {editingGeocodeErrorPickup && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{editingGeocodeErrorPickup}</p>
                    )}
                    <input
                      type="text"
                      value={editingPickupCoordsInput}
                      onChange={(e) => setEditingPickupCoordsInput(e.target.value)}
                      onBlur={() =>
                        applyCoordsInput(
                          editingPickupCoordsInput,
                          setEditingPickupCoords,
                          setEditingGeocodeErrorPickup,
                        )
                      }
                      onPaste={(e) => {
                        const text = e.clipboardData.getData("text");
                        if (parseLatLonPair(text)) {
                          e.preventDefault();
                          setEditingPickupCoordsInput(text.trim());
                          applyCoordsInput(text, setEditingPickupCoords, setEditingGeocodeErrorPickup);
                        }
                      }}
                      placeholder="47.125778, 51.923010"
                      className="w-full mt-2 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                      Куда (адрес)
                    </label>
                    <div className="relative">
                      <input
                        ref={editingDropoffAddressInputRef}
                        type="text"
                        value={editingDropoffAddress}
                        onChange={(e) => {
                          setEditingDropoffAddress(e.target.value);
                          setEditingGeocodeErrorDropoff(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          geocodeEditingDropoffAddress(editingDropoffAddress);
                        }}
                        className={`w-full px-4 py-2 pr-10 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white ${
                          editingGeocodeErrorDropoff
                            ? "border-red-300 dark:border-red-600"
                            : "border-gray-300 dark:border-gray-600"
                        }`}
                      />
                      {editingGeocodingDropoff && (
                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                        </div>
                      )}
                    </div>
                    {editingGeocodeErrorDropoff && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{editingGeocodeErrorDropoff}</p>
                    )}
                    <input
                      type="text"
                      value={editingDropoffCoordsInput}
                      onChange={(e) => setEditingDropoffCoordsInput(e.target.value)}
                      onBlur={() =>
                        applyCoordsInput(
                          editingDropoffCoordsInput,
                          setEditingDropoffCoords,
                          setEditingGeocodeErrorDropoff,
                        )
                      }
                      onPaste={(e) => {
                        const text = e.clipboardData.getData("text");
                        if (parseLatLonPair(text)) {
                          e.preventDefault();
                          setEditingDropoffCoordsInput(text.trim());
                          applyCoordsInput(text, setEditingDropoffCoords, setEditingGeocodeErrorDropoff);
                        }
                      }}
                      placeholder="47.125778, 51.923010"
                      className="w-full mt-2 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Примечания</label>
              <textarea
                value={editingNote}
                onChange={(e) => setEditingNote(e.target.value)}
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Добавьте примечания к заказу..."
              />
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                onClick={handleSaveOrder}
                disabled={saving}
                className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 transition-colors ${
                  saving
                    ? "bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                    : "bg-indigo-600 text-white hover:bg-indigo-700"
                }`}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Сохранение...
                  </>
                ) : (
                  <>
                <Check className="w-5 h-5" />
                Сохранить
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setEditModal(null);
                  setEditingStatus("");
                  setEditingNote("");
                  setEditingOrderDate("");
                  setEditingOrderTime("");
                  setEditingPickupObjectName("");
                  setEditingDropoffObjectName("");
                  setEditingPickupAddress("");
                  setEditingDropoffAddress("");
                  setEditingPickupCoords(null);
                  setEditingDropoffCoords(null);
                  setEditingPickupCoordsInput("");
                  setEditingDropoffCoordsInput("");
                  setEditingGeocodeErrorPickup(null);
                  setEditingGeocodeErrorDropoff(null);
                }}
                disabled={saving}
                className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <X className="w-5 h-5" />
                Отмена
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Assign Driver Modal */}
      <Modal
        isOpen={assignModal !== null}
        onClose={() => {
          setAssignModal(null);
          setSelectedDriverId(null);
          setCandidates([]);
          setError(null); // Очищаем ошибку при закрытии
        }}
        title="Назначить водителя"
        size="md"
      >
        {selectedOrder && (
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <p className="text-sm text-gray-500 dark:text-gray-400">Заказ</p>
              <p className="dark:text-white">{selectedOrder.id} - {selectedOrder.passenger}</p>
              {selectedOrder.status && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Статус: {statusMap[selectedOrder.status] || selectedOrder.status}
                </p>
              )}
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-700 dark:text-red-400 whitespace-pre-line">{error}</p>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm text-gray-700 dark:text-gray-300">Доступные водители</p>
              {loadingCandidates ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                  <span className="ml-3 text-gray-600 dark:text-gray-400">Загрузка водителей...</span>
                </div>
              ) : candidates.length === 0 ? (
                <div className="text-center p-8 text-gray-500 dark:text-gray-400">
                  Нет доступных водителей
                </div>
              ) : (
                candidates.map((candidate) => (
                <button
                    key={candidate.driver_id}
                    onClick={() => setSelectedDriverId(candidate.driver_id)}
                    className={`w-full flex items-center gap-3 p-3 border rounded-lg transition-colors ${
                      selectedDriverId === candidate.driver_id
                        ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 dark:border-indigo-400"
                        : "border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                >
                  <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                      {candidate.name[0]}
                  </div>
                  <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <p className="dark:text-white font-medium">{candidate.name}</p>
                        {!candidate.is_online && (
                          <span className="px-2 py-0.5 text-xs bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded">
                            Офлайн
                          </span>
                        )}
                        {candidate.is_online && (
                          <span className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                            Онлайн
                          </span>
                        )}
                  </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {candidate.car_model} • Вместимость: {candidate.capacity}
                        {candidate.priority.distance !== null && candidate.priority.distance !== undefined && (
                          <> • {safeToFixed(candidate.priority.distance, 1)} км</>
                        )}
                        {candidate.priority.region_match && (
                          <span className="ml-2 text-green-600 dark:text-green-400">✓ Регион совпадает</span>
                        )}
                      </p>
                    </div>
                    {selectedDriverId === candidate.driver_id && (
                  <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
                    )}
                </button>
                ))
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={handleAssignDriver}
                disabled={!selectedDriverId || assigning}
                className={`flex-1 py-2 rounded-lg transition-colors flex items-center justify-center gap-2 ${
                  selectedDriverId && !assigning
                    ? "bg-green-600 text-white hover:bg-green-700"
                    : "bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                }`}
              >
                {assigning ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Назначение...
                  </>
                ) : (
                  "Назначить"
                )}
              </button>
              <button
                onClick={handleAutoAssign}
                disabled={assigning}
                className="flex-1 bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                Автораспределение
              </button>
              <button
                onClick={() => {
                  setAssignModal(null);
                  setSelectedDriverId(null);
                  setCandidates([]);
                }}
                disabled={assigning}
                className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Call Modal */}
      <Modal
        isOpen={callModal !== null}
        onClose={() => setCallModal(null)}
        title={`Позвонить ${callModal?.type === 'passenger' ? 'пассажиру' : 'водителю'}`}
        size="sm"
        footer={
          callModal ? (
            <>
              <button
                onClick={() => setCallModal(null)}
                className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Отмена
              </button>
              <button className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 shadow-lg shadow-green-500/30">
                <Phone className="w-5 h-5" />
                Позвонить
              </button>
            </>
          ) : undefined
        }
      >
        {callModal && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl border border-green-200 dark:border-green-800">
              <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center ring-4 ring-green-50 dark:ring-green-900/50">
                <Phone className="w-7 h-7 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1">
                <p className="dark:text-white mb-1">{callModal.name}</p>
                <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">{callModal.phone}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {callModal.type === 'passenger' ? '👤 Пассажир' : '🚗 Водитель'}
                </p>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                💡 <strong>Совет:</strong> Убедитесь, что микрофон и наушники подключены перед началом звонка.
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Create Order Modal */}
      <Modal
        isOpen={createModal}
        onClose={() => {
          setCreateModal(false);
          setGeocodeErrorPickup(null);
          setGeocodeErrorDropoff(null);
          setPickupAddress("");
          setPickupObjectName("");
          setDropoffAddress("");
          setDropoffObjectName("");
          setPickupCoords(null);
          setDropoffCoords(null);
          setPickupCoordsInput("");
          setDropoffCoordsInput("");
          setSelectedPassengerId("");
          setOrderNote("");
          setOrderHasCompanion(false);
          setIsRoundTrip(false);
          setReturnDate("");
          setReturnTime("");
          // Сброс формы пассажира
          setPassengerPhone("");
          setPassengerName("");
          setPassengerRegionId("");
          setOrderRegionId("");
          setPassengerDisabilityCategory("");
          setPassengerAllowedCompanion(false);
          setMatchingPassengers([]);
          setSelectedPassengerMode(null);
          setSelectedExistingPassengerId(null);
          setMamashChildIndex(1);
          const now = new Date();
          setOrderDate(getTomorrowDateInAtyrau());
          setOrderTime(getDefaultTimeGMT5());
        }}
        title={mamashChildIndex > 1 ? `Создать заказ · ребёнок ${mamashChildIndex}` : "Создать новый заказ"}
        size="xl"
        footer={
          <>
            <button
              onClick={() => {
                setCreateModal(false);
      setGeocodeErrorPickup(null);
      setGeocodeErrorDropoff(null);
                setPickupAddress("");
                setDropoffAddress("");
                setPickupCoords(null);
                setDropoffCoords(null);
                setSelectedPassengerId("");
                setOrderNote("");
                setOrderHasCompanion(false);
                setIsRoundTrip(false);
                setReturnDate("");
                setReturnTime("");
                setGeocodeErrorPickup(null);
                setGeocodeErrorDropoff(null);
                // Сброс формы пассажира
                setPassengerPhone("");
                setPassengerName("");
                setPassengerRegionId("");
          setOrderRegionId("");
                setPassengerDisabilityCategory("");
                setPassengerAllowedCompanion(false);
                setMatchingPassengers([]);
                setSelectedPassengerMode(null);
                setSelectedExistingPassengerId(null);
                setMamashChildIndex(1);
                setOrderDate(getTomorrowDateInAtyrau());
                setOrderTime(getDefaultTimeGMT5());
              }}
              className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleCreateOrderMamash}
              disabled={!isCreateOrderFormValid() || creatingOrder || isRoundTrip}
              title={isRoundTrip ? "Отключите «Туда-обратно» для режима Мамаш" : "Несколько детей с одного адреса — отдельный заказ на каждого"}
              className="px-6 py-2.5 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <UserCircle className="w-5 h-5" />
              Мамаш{mamashChildIndex > 1 ? ` (${mamashChildIndex})` : ""}
            </button>
            <button
              onClick={handleCreateOrderAndAddAnother}
              disabled={!isCreateOrderFormValid() || creatingOrder}
              className="px-6 py-2.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-5 h-5" />
              Создать и добавить ещё
            </button>
            <button 
              onClick={handleCreateOrder}
              disabled={!isCreateOrderFormValid() || creatingOrder}
              className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creatingOrder ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Создание...
                </>
              ) : (
                <>
                  <Plus className="w-5 h-5" />
                  Создать заказ
                </>
              )}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {mamashChildIndex > 1 && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-200">
              Режим «Мамаш»: адрес и время сохранены. Укажите данные ребёнка {mamashChildIndex}.
            </div>
          )}
          {/* Форма выбора/создания пассажира */}
          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Пассажир *</label>
            
            {/* Поле ввода телефона */}
            <div className="mb-3">
              <div className="relative">
                <PhoneInput
                  international
                  value={passengerPhone || undefined}
                  onChange={(val) => setPassengerPhone(val || "")}
                  placeholder="Введите телефон пассажира"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white [&_.PhoneInputInput]:bg-transparent [&_.PhoneInputInput]:border-none [&_.PhoneInputInput]:outline-none [&_.PhoneInputInput]:flex-1"
                />
                {searchingPassenger && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                  </div>
                )}
              </div>
            </div>

            {/* Найденные пассажиры */}
            {matchingPassengers.length > 0 && selectedPassengerMode !== 'new' && (
              <div className="mb-3 space-y-2">
                {selectedExistingPassengerId ? (
                  /* Выбран один пассажир — показываем только его */
                  (() => {
                    const selected = matchingPassengers.find((p) => p.id === selectedExistingPassengerId);
                    if (!selected) {
                      return (
                        <div className="space-y-2">
                          <p className="text-sm text-gray-500 dark:text-gray-400">Выбранный пассажир не найден в текущем поиске.</p>
                          <button
                            type="button"
                            onClick={() => setSelectedExistingPassengerId(null)}
                            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            Выбрать другого
                          </button>
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-2">
                        <p className="text-sm text-gray-600 dark:text-gray-400">Выбран пассажир:</p>
                        <div className="p-3 border border-indigo-500 rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium dark:text-white">{passengerDisplayName(selected)}</p>
                              <p className="text-sm text-gray-600 dark:text-gray-400">{selected?.user?.phone ?? "—"}</p>
                              {selected.region && (
                                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                                  Регион: {selected.region?.title ?? ""}
                                </p>
                              )}
                            </div>
                            <Check className="w-5 h-5 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedExistingPassengerId(null);
                            }}
                            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            Выбрать другого
                          </button>
                          <span className="text-gray-400">|</span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPassengerMode('new');
                              setSelectedExistingPassengerId(null);
                            }}
                            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            Добавить нового пассажира
                          </button>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  /* Список для выбора */
                  <>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Найдены пассажиры:</p>
                    {matchingPassengers.map((passenger) => (
                      <div
                        key={passenger.id}
                        className="p-3 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer transition-colors hover:border-indigo-300 dark:hover:border-indigo-700"
                        onClick={() => {
                          setSelectedPassengerMode('existing');
                          setSelectedExistingPassengerId(passenger.id);
                          const nm = passengerDisplayName(passenger);
                          setPassengerName(nm === "—" ? "" : nm);
                          if (passenger.region?.id) {
                            setOrderRegionId(passenger.region.id);
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium dark:text-white">{passengerDisplayName(passenger)}</p>
                            <p className="text-sm text-gray-600 dark:text-gray-400">{passenger?.user?.phone ?? "—"}</p>
                            {passenger.region && (
                              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                                Регион: {passenger.region?.title ?? ""}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPassengerMode('new');
                        setSelectedExistingPassengerId(null);
                      }}
                      className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Добавить нового пассажира
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Форма создания нового пассажира */}
            {(selectedPassengerMode === 'new' || (matchingPassengers.length === 0 && passengerPhone.length >= 4)) && (
              <div className="space-y-3 p-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {selectedPassengerMode === 'new' ? 'Добавление нового пассажира' : 'Пассажир не найден. Заполните данные для создания:'}
                </p>
                
                <div>
                  <label className="block text-sm mb-1 text-gray-700 dark:text-gray-300">Имя *</label>
                  <input
                    type="text"
                    value={passengerName}
                    onChange={(e) => setPassengerName(e.target.value)}
                    placeholder="Полное имя пассажира"
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm mb-1 text-gray-700 dark:text-gray-300">Категория инвалидности *</label>
                  <select
                    value={passengerDisabilityCategory}
                    onChange={(e) => setPassengerDisabilityCategory(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Выберите категорию</option>
                    <option value="I группа">I группа</option>
                    <option value="II группа">II группа</option>
                    <option value="III группа">III группа</option>
                    <option value="Ребенок-инвалид">Ребенок-инвалид</option>
                  </select>
                </div>

                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={passengerAllowedCompanion}
                      onChange={(e) => setPassengerAllowedCompanion(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Разрешено сопровождение</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Карта для выбора точек маршрута */}
          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Выберите маршрут на карте *
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              Первый клик — откуда (A, зелёный), второй — куда (B, красный). Затем клик переключает точку.
            </p>
            <RouteMapPicker
              height="400px"
              onPickupChange={handleCreateMapPickupChange}
              onDropoffChange={handleCreateMapDropoffChange}
              initialPickup={pickupCoords ? { lat: pickupCoords.lat, lon: pickupCoords.lon } : undefined}
              initialDropoff={dropoffCoords ? { lat: dropoffCoords.lat, lon: dropoffCoords.lon } : undefined}
            />
          </div>

          {/* Поля для адресов */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Название объекта (откуда) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={pickupObjectName}
                onChange={(e) => setPickupObjectName(e.target.value)}
                placeholder="Например: Дом инвалида, Поликлиника 3. Обязательно для диспетчера."
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Карта ищет по улице, диспетчер ориентируется по названию объекта
              </p>
            </div>

            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Откуда (адрес для карты)
              </label>
              <div className="relative">
                <input
                  ref={pickupAddressInputRef}
                  type="text"
                  value={pickupAddress}
                  onChange={(e) => handlePickupAddressChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    geocodePickupAddress(pickupAddress);
                  }}
                  placeholder="ТЦ, поликлиника, мамекулы 33…"
                  className={`w-full px-4 py-2 pr-10 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white ${
                    geocodeErrorPickup
                      ? "border-red-300 dark:border-red-600"
                      : "border-gray-300 dark:border-gray-600"
                  }`}
                />
                {geocodingPickup && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                  </div>
                )}
              </div>
              {geocodeErrorPickup && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {geocodeErrorPickup}
                </p>
              )}
              <div className="mt-2">
                <label className="block text-xs mb-1 text-gray-600 dark:text-gray-400">
                  Координаты (широта, долгота)
                </label>
                <input
                  type="text"
                  value={pickupCoordsInput}
                  onChange={(e) => setPickupCoordsInput(e.target.value)}
                  onBlur={() => applyCoordsInput(pickupCoordsInput, setPickupCoords, setGeocodeErrorPickup)}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    if (parseLatLonPair(text)) {
                      e.preventDefault();
                      setPickupCoordsInput(text.trim());
                      applyCoordsInput(text, setPickupCoords, setGeocodeErrorPickup);
                    }
                  }}
                  placeholder="47.125778, 51.923010"
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Вставьте координаты из Яндекс.Карт одной строкой
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Название объекта (куда) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={dropoffObjectName}
                onChange={(e) => setDropoffObjectName(e.target.value)}
                placeholder="Например: Поликлиника 3, Школа №5. Обязательно для диспетчера."
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Карта ищет по улице, диспетчер ориентируется по названию объекта
              </p>
            </div>

            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Куда (адрес для карты)
              </label>
              <div className="relative">
                <input
                  ref={dropoffAddressInputRef}
                  type="text"
                  value={dropoffAddress}
                  onChange={(e) => handleDropoffAddressChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    geocodeDropoffAddress(dropoffAddress);
                  }}
                  placeholder="ТЦ, поликлиника, мамекулы 33…"
                  className={`w-full px-4 py-2 pr-10 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white ${
                    geocodeErrorDropoff
                      ? "border-red-300 dark:border-red-600"
                      : "border-gray-300 dark:border-gray-600"
                  }`}
                />
                {geocodingDropoff && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                  </div>
                )}
              </div>
              {geocodeErrorDropoff && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {geocodeErrorDropoff}
                </p>
              )}
              <div className="mt-2">
                <label className="block text-xs mb-1 text-gray-600 dark:text-gray-400">
                  Координаты (широта, долгота)
                </label>
                <input
                  type="text"
                  value={dropoffCoordsInput}
                  onChange={(e) => setDropoffCoordsInput(e.target.value)}
                  onBlur={() => applyCoordsInput(dropoffCoordsInput, setDropoffCoords, setGeocodeErrorDropoff)}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    if (parseLatLonPair(text)) {
                      e.preventDefault();
                      setDropoffCoordsInput(text.trim());
                      applyCoordsInput(text, setDropoffCoords, setGeocodeErrorDropoff);
                    }
                  }}
                  placeholder="47.125778, 51.923010"
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Вставьте координаты из Яндекс.Карт одной строкой
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
              Район заказа <span className="text-red-500">*</span>
            </label>
            <select
              value={orderRegionId}
              onChange={(e) => {
                setOrderRegionId(e.target.value);
                if (selectedPassengerMode === 'new') {
                  setPassengerRegionId(e.target.value);
                }
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">Выберите район</option>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.title} {region.city ? `(${region.city.title})` : ""}
                </option>
              ))}
            </select>
          </div>

          {(pickupCoords || dropoffCoords || pickupObjectName || dropoffObjectName) && (
            <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/20 p-4 space-y-3">
              <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">Проверьте маршрут перед созданием</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400">
                      <th className="pb-2 pr-3 font-medium">Точка</th>
                      <th className="pb-2 pr-3 font-medium">Объект</th>
                      <th className="pb-2 pr-3 font-medium">Адрес</th>
                      <th className="pb-2 font-medium">Координаты</th>
                    </tr>
                  </thead>
                  <tbody className="dark:text-white">
                    <tr>
                      <td className="py-1 pr-3 text-green-700 dark:text-green-400 font-medium">A — Откуда</td>
                      <td className="py-1 pr-3">{pickupObjectName || "—"}</td>
                      <td className="py-1 pr-3">{pickupAddress || "—"}</td>
                      <td className="py-1 font-mono text-xs">
                        {pickupCoords ? `${pickupCoords.lat.toFixed(6)}, ${pickupCoords.lon.toFixed(6)}` : "—"}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1 pr-3 text-red-700 dark:text-red-400 font-medium">B — Куда</td>
                      <td className="py-1 pr-3">{dropoffObjectName || "—"}</td>
                      <td className="py-1 pr-3">{dropoffAddress || "—"}</td>
                      <td className="py-1 font-mono text-xs">
                        {dropoffCoords ? `${dropoffCoords.lat.toFixed(6)}, ${dropoffCoords.lon.toFixed(6)}` : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Дата *</label>
              <input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Время *</label>
              <input
                type="time"
                value={orderTime}
                onChange={(e) => setOrderTime(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isRoundTrip}
                onChange={(e) => {
                  setIsRoundTrip(e.target.checked);
                  if (e.target.checked && !returnDate) {
                    setReturnDate(orderDate);
                    setReturnTime(orderTime);
                  }
                }}
                className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Туда-обратно</span>
            </label>
            {isRoundTrip && (
              <div className="grid grid-cols-2 gap-4 mt-3 ml-6">
                <div>
                  <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Дата обратной поездки *</label>
                  <input
                    type="date"
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Время обратной поездки *</label>
                  <input
                    type="time"
                    value={returnTime}
                    onChange={(e) => setReturnTime(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={orderHasCompanion}
                onChange={(e) => setOrderHasCompanion(e.target.checked)}
                className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">С сопровождением</span>
            </label>
          </div>

          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">Примечания</label>
            <textarea
              rows={3}
              value={orderNote}
              onChange={(e) => setOrderNote(e.target.value)}
              placeholder="Дополнительная информация о заказе..."
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={generateModal}
        onClose={() => {
          setGenerateModal(false);
          setOrdersPerSlot(5);
          setGenerateDate(getTomorrowDateInAtyrau());
        }}
        title="Генерация заказов — Атырау"
        size="md"
        footer={
          <>
            <button
              onClick={() => {
                setGenerateModal(false);
                setOrdersPerSlot(5);
                setGenerateDate(getTomorrowDateInAtyrau());
              }}
              disabled={generatingOrders}
              className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              onClick={handleGenerateAtyrauOrders}
              disabled={generatingOrders || passengers.length === 0}
              className={`px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors ${
                generatingOrders || passengers.length === 0
                  ? "bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                  : "bg-purple-600 text-white hover:bg-purple-700"
              }`}
            >
              {generatingOrders ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Генерация...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Создать {ordersPerSlot * 17} заказов
                </>
              )}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {passengers.length === 0 ? (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                Нет доступных пассажиров в базе данных. Сначала создайте пассажиров.
              </p>
            </div>
          ) : (
            <>
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  Заказы по реальным маршрутам города <strong>Атырау</strong>, равномерно по часовым
                  слотам <strong>06:00–23:00</strong> (Asia/Atyrau). На каждый час — не более{" "}
                  <strong>20</strong> заказов. Статус «Новый» — сработает автоназначение.
                </p>
              </div>

              <div>
                <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                  Дата заказов
                </label>
                <input
                  type="date"
                  value={generateDate}
                  onChange={(e) => setGenerateDate(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 dark:bg-gray-700 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                  Заказов на каждый час (1–20)
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={ordersPerSlot}
                  onChange={(e) => setOrdersPerSlot(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 dark:bg-gray-700 dark:text-white"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Итого: {ordersPerSlot * 17} заказов (17 часовых слотов × {ordersPerSlot}) ·
                  пассажиров: {passengers.length}
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={replaceGenerated}
                  onChange={(e) => setReplaceGenerated(e.target.checked)}
                  className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                />
                Заменить ранее сгенерированные заказы на эту дату
              </label>
            </>
          )}
        </div>
      </Modal>

      {/* Import Orders Modal */}
      <Modal
        isOpen={importModal}
        onClose={() => {
          setImportModal(false);
          setImportFile(null);
          setImportOptions({ dryRun: false, skipErrors: false });
          setImportResult(null);
        }}
        title="Импорт заказов из CSV"
        size="lg"
        footer={
          <>
            <button
              onClick={() => {
                setImportModal(false);
                setImportFile(null);
                setImportOptions({ dryRun: false, skipErrors: false });
                setImportResult(null);
              }}
              className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Отмена
            </button>
            <button 
              onClick={async () => {
                if (!importFile) {
                  toast.error("Выберите CSV файл");
                  return;
                }
                
                try {
                  setImporting(true);
                  const result = await ordersApi.importOrders(importFile, importOptions);
                  setImportResult(result);
                  
                  if (result.success_count > 0) {
                    toast.success(`Успешно импортировано: ${result.success_count} заказов`);
                    if (!importOptions.dryRun) {
                      await refreshOrders();
                    }
                  }
                  if (result.failed_count > 0) {
                    toast.warning(`Ошибок: ${result.failed_count}`);
                  }
                } catch (err: any) {
                  toast.error(err.response?.data?.error || err.message || "Ошибка импорта");
                } finally {
                  setImporting(false);
                }
              }}
              disabled={importing || !importFile}
              className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Импорт...
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5" />
                  Импортировать
                </>
              )}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">CSV файл *</label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  if (file.size > 10 * 1024 * 1024) {
                    toast.error("Файл слишком большой (максимум 10MB)");
                    return;
                  }
                  setImportFile(file);
                  setImportResult(null);
                }
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white"
            />
            {importFile && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Выбран файл: {importFile.name} ({(importFile.size / 1024).toFixed(2)} KB)
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={importOptions.dryRun}
                onChange={(e) => setImportOptions({ ...importOptions, dryRun: e.target.checked })}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              Только валидация (не создавать заказы)
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={importOptions.skipErrors}
                onChange={(e) => setImportOptions({ ...importOptions, skipErrors: e.target.checked })}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              Пропускать строки с ошибками
            </label>
          </div>

          <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <p className="font-medium dark:text-gray-300">Формат CSV:</p>
            <p>Обязательные поля: passenger_id или passenger_phone, pickup_title, pickup_lat, pickup_lon, dropoff_title, dropoff_lat, dropoff_lon, desired_pickup_time</p>
            <p>Опциональные: has_companion, note, status</p>
          </div>

          {importResult && (
            <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <h3 className="font-semibold mb-2 text-gray-900 dark:text-white">Результаты импорта:</h3>
              <div className="space-y-1 text-sm">
                <p className="text-green-600 dark:text-green-400">
                  Успешно: {importResult.success_count}
                </p>
                <p className="text-red-600 dark:text-red-400">
                  Ошибок: {importResult.failed_count}
                </p>
                {importResult.errors.length > 0 && (
                  <div className="mt-2">
                    <p className="font-medium text-gray-700 dark:text-gray-300">Детали ошибок:</p>
                    <div className="max-h-40 overflow-y-auto mt-1">
                      {importResult.errors.slice(0, 10).map((error, idx) => (
                        <p key={idx} className="text-xs text-red-600 dark:text-red-400">
                          Строка {error.row}: {error.message}
                        </p>
                      ))}
                      {importResult.errors.length > 10 && (
                        <p className="text-xs text-gray-500">... и еще {importResult.errors.length - 10} ошибок</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Clear All Orders Modal */}
      <Modal
        isOpen={clearAllModal}
        onClose={() => setClearAllModal(false)}
        title="Очистить все заказы"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-red-600 dark:text-red-400 font-medium">
            Внимание! Будут удалены все заказы из базы данных. Это действие необратимо.
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Завтра будут добавлять половину всех заказов — очистите список перед импортом.
          </p>
          <div className="flex gap-3 pt-4">
            <button
              onClick={async () => {
                try {
                  setClearingAll(true);
                  const result = await ordersApi.clearAllOrders(true);
                  toast.success(`Удалено заказов: ${result.deleted_count}`);
                  await refreshOrders();
                  setClearAllModal(false);
                } catch (err: any) {
                  toast.error(err.response?.data?.error || 'Ошибка очистки');
                } finally {
                  setClearingAll(false);
                }
              }}
              disabled={clearingAll}
              className="flex-1 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {clearingAll ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              Подтвердить удаление
            </button>
            <button
              onClick={() => setClearAllModal(false)}
              className="flex-1 py-2 bg-gray-200 dark:bg-gray-600 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500"
            >
              Отмена
            </button>
          </div>
        </div>
      </Modal>

      {/* Export Orders Modal */}
      <Modal
        isOpen={exportModal}
        onClose={() => setExportModal(false)}
        title="Экспорт заказов"
        size="md"
        footer={
          <>
            <button
              onClick={() => setExportModal(false)}
              className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Закрыть
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            <p className="font-medium mb-2">Период (дата поездки):</p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <label className="block text-xs mb-1">Дата с</label>
                <input
                  type="date"
                  value={exportDateFrom}
                  onChange={(e) => setExportDateFrom(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Дата по</label>
                <input
                  type="date"
                  value={exportDateTo}
                  onChange={(e) => setExportDateTo(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>
            <p className="text-xs mt-2 text-gray-500 dark:text-gray-400">
              Пустые даты — все заказы в базе (без фильтра по дате).
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <button
              onClick={async () => {
                try {
                  setExporting(true);
                  const params: Record<string, string | boolean> = { all_statuses: true };
                  if (exportDateFrom) params.date_from = exportDateFrom;
                  if (exportDateTo) params.date_to = exportDateTo;
                  const blob = await ordersApi.exportExcelTemplate(params);
                  const url = window.URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `orders_all_${new Date().toISOString().slice(0, 10)}.xlsx`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  window.URL.revokeObjectURL(url);
                  toast.success("Экспорт всех заказов завершён");
                  setExportModal(false);
                } catch (err: any) {
                  toast.error(err.response?.data?.error || err.message || "Ошибка экспорта");
                } finally {
                  setExporting(false);
                }
              }}
              disabled={exporting}
              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {exporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              Все заказы (Excel)
            </button>
            <button
              onClick={async () => {
                try {
                  setExporting(true);
                  const params: Record<string, string | boolean> = {
                    all_statuses: true,
                    assigned_only: true,
                  };
                  if (exportDateFrom) params.date_from = exportDateFrom;
                  if (exportDateTo) params.date_to = exportDateTo;
                  const blob = await ordersApi.exportExcelTemplate(params);
                  const url = window.URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `orders_with_drivers_${new Date().toISOString().slice(0, 10)}.xlsx`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  window.URL.revokeObjectURL(url);
                  toast.success("Экспорт заказов с водителями завершён");
                  setExportModal(false);
                } catch (err: any) {
                  toast.error(err.response?.data?.error || err.message || "Ошибка экспорта");
                } finally {
                  setExporting(false);
                }
              }}
              disabled={exporting}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {exporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              С водителями (Excel)
            </button>
            <button
              onClick={async () => {
                try {
                  setExporting(true);
                  const params: Record<string, string | boolean> = { all_statuses: true };
                  if (exportDateFrom) params.date_from = exportDateFrom;
                  if (exportDateTo) params.date_to = exportDateTo;
                  const blob = await ordersApi.exportOrdersByDrivers(params);
                  const url = window.URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `orders_by_drivers_${new Date().toISOString().slice(0, 10)}.zip`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  window.URL.revokeObjectURL(url);
                  toast.success("Экспорт по водителям (ZIP) завершён");
                  setExportModal(false);
                } catch (err: any) {
                  toast.error(err.response?.data?.error || err.message || "Ошибка экспорта");
                } finally {
                  setExporting(false);
                }
              }}
              disabled={exporting}
              className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {exporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              По водителям (ZIP — отдельный CSV на каждого)
            </button>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            <p>Excel и CSV: полные данные заказа — адреса, координаты, дата и время (Asia/Atyrau), район, водитель, статус, цены. Включая неназначенные заказы. ZIP: отдельный CSV на водителя + файл неназначенных.</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
