import { useState, useEffect, useRef } from "react";
import { 
  Car, 
  User, 
  MapPin, 
  Clock, 
  CheckCircle, 
  PlayCircle, 
  StopCircle,
  Phone,
  Navigation,
  Loader2,
  AlertCircle
} from "lucide-react";
import { ordersApi, Order } from "../services/orders";
import { RouteMapView } from "./RouteMapView";
import { toast } from "sonner";
import { format } from "date-fns";

type RideStatus = "assigned" | "driver_en_route" | "arrived_waiting" | "ride_ongoing" | "completed";

interface RideSimulationState {
  order: Order | null;
  status: RideStatus;
  startTime: Date | null;
  rideStartTime: Date | null;
  completedTime: Date | null;
  elapsedTime: number; // секунды
  rideElapsedTime: number; // секунды
}

const statusLabels: Record<RideStatus, string> = {
  assigned: "Заказ принят",
  driver_en_route: "Водитель в пути к пассажиру",
  arrived_waiting: "Ожидание пассажира",
  ride_ongoing: "Поездка началась",
  completed: "Поездка завершена",
};

const statusColors: Record<RideStatus, string> = {
  assigned: "bg-blue-500",
  driver_en_route: "bg-yellow-500",
  arrived_waiting: "bg-orange-500",
  ride_ongoing: "bg-green-500",
  completed: "bg-gray-500",
};

export function RideSimulation() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [simulation, setSimulation] = useState<RideSimulationState>({
    order: null,
    status: "assigned",
    startTime: null,
    rideStartTime: null,
    completedTime: null,
    elapsedTime: 0,
    rideElapsedTime: 0,
  });
  const [isSimulating, setIsSimulating] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const rideIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Загрузка заказов
  useEffect(() => {
    const loadOrders = async () => {
      try {
        setLoading(true);
        const data = await ordersApi.getOrders();
        // Фильтруем только заказы, которые могут быть приняты водителем
        const availableOrders = data.filter(
          (order) => 
            order.status === "assigned" || 
            order.status === "driver_en_route" ||
            order.status === "arrived_waiting" ||
            order.status === "ride_ongoing"
        );
        setOrders(availableOrders);
      } catch (err: any) {
        toast.error(err.message || "Ошибка загрузки заказов");
      } finally {
        setLoading(false);
      }
    };
    loadOrders();
  }, []);

  // Таймер для отслеживания времени
  useEffect(() => {
    if (isSimulating && simulation.startTime) {
      intervalRef.current = setInterval(() => {
        const now = new Date();
        const elapsed = Math.floor((now.getTime() - simulation.startTime!.getTime()) / 1000);
        setSimulation((prev) => ({ ...prev, elapsedTime: elapsed }));
      }, 1000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isSimulating, simulation.startTime]);

  // Таймер для времени поездки
  useEffect(() => {
    if (isSimulating && simulation.status === "ride_ongoing" && simulation.rideStartTime) {
      rideIntervalRef.current = setInterval(() => {
        const now = new Date();
        const elapsed = Math.floor((now.getTime() - simulation.rideStartTime!.getTime()) / 1000);
        setSimulation((prev) => ({ ...prev, rideElapsedTime: elapsed }));
      }, 1000);
    }

    return () => {
      if (rideIntervalRef.current) {
        clearInterval(rideIntervalRef.current);
      }
    };
  }, [isSimulating, simulation.status, simulation.rideStartTime]);

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  };

  const handleStartSimulation = async () => {
    if (!selectedOrderId) {
      toast.error("Выберите заказ");
      return;
    }

    try {
      const order = await ordersApi.getOrder(selectedOrderId);
      if (!order.driver) {
        toast.error("Заказ не назначен водителю");
        return;
      }

      setSimulation({
        order,
        status: "assigned",
        startTime: new Date(),
        rideStartTime: null,
        completedTime: null,
        elapsedTime: 0,
        rideElapsedTime: 0,
      });
      setIsSimulating(true);
      toast.success("Имитация поездки начата");
    } catch (err: any) {
      toast.error(err.message || "Ошибка загрузки заказа");
    }
  };

  const handleNextStatus = async () => {
    if (!simulation.order) return;

    const statusFlow: RideStatus[] = [
      "assigned",
      "driver_en_route",
      "arrived_waiting",
      "ride_ongoing",
      "completed",
    ];

    const currentIndex = statusFlow.indexOf(simulation.status);
    if (currentIndex === -1 || currentIndex === statusFlow.length - 1) {
      return;
    }

    const nextStatus = statusFlow[currentIndex + 1];

    try {
      // Обновляем статус через API
      await ordersApi.updateOrderStatus(simulation.order.id, {
        status: nextStatus,
      });

      const updates: Partial<RideSimulationState> = {
        status: nextStatus,
      };

      if (nextStatus === "ride_ongoing") {
        updates.rideStartTime = new Date();
      }

      if (nextStatus === "completed") {
        updates.completedTime = new Date();
        setIsSimulating(false);
        toast.success("Поездка завершена!");
      }

      setSimulation((prev) => ({ ...prev, ...updates } as RideSimulationState));

      // Обновляем заказ
      const updatedOrder = await ordersApi.getOrder(simulation.order.id);
      setSimulation((prev) => ({ ...prev, order: updatedOrder }));
    } catch (err: any) {
      toast.error(err.message || "Ошибка обновления статуса");
    }
  };

  const handleReset = () => {
    setIsSimulating(false);
    setSimulation({
      order: null,
      status: "assigned",
      startTime: null,
      rideStartTime: null,
      completedTime: null,
      elapsedTime: 0,
      rideElapsedTime: 0,
    });
    setSelectedOrderId("");
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    if (rideIntervalRef.current) {
      clearInterval(rideIntervalRef.current);
    }
  };

  const selectedOrder = orders.find((o) => o.id === selectedOrderId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Имитация поездки таксиста
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Симуляция процесса принятия заказа и выполнения поездки
          </p>
        </div>
      </div>

      {/* Выбор заказа */}
      {!isSimulating && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
            Выберите заказ для имитации
          </h2>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <AlertCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Нет доступных заказов для имитации</p>
            </div>
          ) : (
            <div className="space-y-4">
              <select
                value={selectedOrderId}
                onChange={(e) => setSelectedOrderId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">-- Выберите заказ --</option>
                {orders.map((order) => (
                  <option key={order.id} value={order.id}>
                    Заказ #{order.id} - {order.passenger.full_name} ({order.pickup_title} → {order.dropoff_title})
                  </option>
                ))}
              </select>

              {selectedOrder && (
                <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Пассажир:</span>
                      <span className="ml-2 font-medium text-gray-900 dark:text-white">
                        {selectedOrder.passenger.full_name}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Телефон:</span>
                      <span className="ml-2 font-medium text-gray-900 dark:text-white">
                        {selectedOrder.passenger.user.phone}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Откуда:</span>
                      <span className="ml-2 font-medium text-gray-900 dark:text-white">
                        {selectedOrder.pickup_title}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Куда:</span>
                      <span className="ml-2 font-medium text-gray-900 dark:text-white">
                        {selectedOrder.dropoff_title}
                      </span>
                    </div>
                    {selectedOrder.driver && (
                      <>
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">Водитель:</span>
                          <span className="ml-2 font-medium text-gray-900 dark:text-white">
                            {selectedOrder.driver.name}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">Автомобиль:</span>
                          <span className="ml-2 font-medium text-gray-900 dark:text-white">
                            {selectedOrder.driver.car_model} ({selectedOrder.driver.plate_number})
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              <button
                onClick={handleStartSimulation}
                disabled={!selectedOrderId}
                className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
              >
                Начать имитацию
              </button>
            </div>
          )}
        </div>
      )}

      {/* Имитация поездки */}
      {isSimulating && simulation.order && (
        <div className="space-y-6">
          {/* Статус и информация */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className={`w-4 h-4 rounded-full ${statusColors[simulation.status]}`} />
                <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
                  {statusLabels[simulation.status]}
                </h2>
              </div>
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Сбросить
              </button>
            </div>

            {/* Информация о заказе */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <User className="w-5 h-5 text-indigo-600 mt-1" />
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Пассажир</p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {simulation.order.passenger.full_name}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-500">
                      {simulation.order.passenger.user.phone}
                    </p>
                  </div>
                </div>

                {simulation.order.driver && (
                  <div className="flex items-start gap-3">
                    <Car className="w-5 h-5 text-indigo-600 mt-1" />
                    <div>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Водитель</p>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {simulation.order.driver.name}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-500">
                        {simulation.order.driver.car_model} ({simulation.order.driver.plate_number})
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-500">
                        {simulation.order.driver.user.phone}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-green-600 mt-1" />
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Откуда</p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {simulation.order.pickup_title}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-red-600 mt-1" />
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Куда</p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {simulation.order.dropoff_title}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Таймеры */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Общее время
                  </span>
                </div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {formatTime(simulation.elapsedTime)}
                </p>
              </div>

              {simulation.status === "ride_ongoing" && (
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Navigation className="w-4 h-4 text-green-600 dark:text-green-400" />
                    <span className="text-sm text-green-600 dark:text-green-400">
                      Время поездки
                    </span>
                  </div>
                  <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                    {formatTime(simulation.rideElapsedTime)}
                  </p>
                </div>
              )}
            </div>

            {/* Кнопки управления */}
            <div className="flex gap-4">
              {simulation.status !== "completed" && (
                <button
                  onClick={handleNextStatus}
                  className="flex-1 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium flex items-center justify-center gap-2"
                >
                  {simulation.status === "assigned" && (
                    <>
                      <PlayCircle className="w-5 h-5" />
                      Водитель в пути
                    </>
                  )}
                  {simulation.status === "driver_en_route" && (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      Прибыл к пассажиру
                    </>
                  )}
                  {simulation.status === "arrived_waiting" && (
                    <>
                      <PlayCircle className="w-5 h-5" />
                      Начать поездку
                    </>
                  )}
                  {simulation.status === "ride_ongoing" && (
                    <>
                      <StopCircle className="w-5 h-5" />
                      Завершить поездку
                    </>
                  )}
                </button>
              )}

              {simulation.status === "completed" && (
                <div className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg font-medium flex items-center justify-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  Поездка завершена
                </div>
              )}
            </div>
          </div>

          {/* Карта */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Маршрут поездки
              </h3>
            </div>
            <div className="h-[500px]">
              <RouteMapView
                pickupLat={simulation.order.pickup_lat}
                pickupLon={simulation.order.pickup_lon}
                dropoffLat={simulation.order.dropoff_lat}
                dropoffLon={simulation.order.dropoff_lon}
                pickupTitle={simulation.order.pickup_title}
                dropoffTitle={simulation.order.dropoff_title}
                distanceKm={simulation.order.distance_km}
                orderId={simulation.order.id}
              />
            </div>
          </div>

          {/* Детали заказа */}
          {simulation.status === "completed" && simulation.order.final_price && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
                Итоговая информация
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Расстояние</p>
                  <p className="text-lg font-medium text-gray-900 dark:text-white">
                    {simulation.order.distance_km?.toFixed(2) || "—"} км
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Итоговая стоимость</p>
                  <p className="text-lg font-medium text-indigo-600 dark:text-indigo-400">
                    {simulation.order.final_price.toFixed(2)} ₸
                  </p>
                </div>
                {simulation.completedTime && (
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Завершено</p>
                    <p className="text-lg font-medium text-gray-900 dark:text-white">
                      {format(simulation.completedTime, "HH:mm:ss")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
