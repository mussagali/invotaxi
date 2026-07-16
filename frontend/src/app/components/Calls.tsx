import { useState } from "react";
import {
  Phone,
  PhoneCall,
  PhoneMissed,
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  User,
  Search,
  Play,
  Pause,
  Volume2,
  Mic,
  MicOff,
  PhoneOff,
  Filter,
} from "lucide-react";
import { Modal } from "./Modal";

interface Call {
  id: string;
  type: "incoming" | "outgoing" | "missed";
  status: "active" | "completed" | "missed" | "rejected";
  caller: {
    name: string;
    phone: string;
    type: "passenger" | "driver";
    id: string;
  };
  operator: string;
  startTime: string;
  endTime?: string;
  duration?: string;
  orderId?: string;
  recording?: string;
  notes?: string;
}

const mockCalls: Call[] = [
  {
    id: "CALL001",
    type: "outgoing",
    status: "completed",
    caller: {
      name: "Алия Карим",
      phone: "+7 777 111 2222",
      type: "passenger",
      id: "PS001",
    },
    operator: "Оператор 1",
    startTime: "2025-01-02 10:15:00",
    endTime: "2025-01-02 10:18:30",
    duration: "3:30",
    orderId: "#4532",
    notes: "Уточнение адреса доставки",
  },
  {
    id: "CALL002",
    type: "incoming",
    status: "completed",
    caller: {
      name: "Ержан Бектемиров",
      phone: "+7 777 222 3333",
      type: "passenger",
      id: "PS002",
    },
    operator: "Оператор 2",
    startTime: "2025-01-02 10:30:00",
    endTime: "2025-01-02 10:32:15",
    duration: "2:15",
    notes: "Запрос на создание заказа",
  },
  {
    id: "CALL003",
    type: "outgoing",
    status: "completed",
    caller: {
      name: "Асан Мукашев",
      phone: "+7 777 123 4567",
      type: "driver",
      id: "DR001",
    },
    operator: "Оператор 1",
    startTime: "2025-01-02 11:00:00",
    endTime: "2025-01-02 11:02:45",
    duration: "2:45",
    orderId: "#4530",
    notes: "Координация маршрута",
  },
  {
    id: "CALL004",
    type: "incoming",
    status: "missed",
    caller: {
      name: "Сауле Тулеуова",
      phone: "+7 777 333 4444",
      type: "passenger",
      id: "PS003",
    },
    operator: "-",
    startTime: "2025-01-02 11:15:00",
  },
  {
    id: "CALL005",
    type: "outgoing",
    status: "active",
    caller: {
      name: "Мурат Казбеков",
      phone: "+7 777 234 5678",
      type: "driver",
      id: "DR002",
    },
    operator: "Оператор 3",
    startTime: "2025-01-02 11:45:00",
    orderId: "#4529",
  },
];

const mockActiveCall: Call | null = {
  id: "CALL005",
  type: "outgoing",
  status: "active",
  caller: {
    name: "Мурат Казбеков",
    phone: "+7 777 234 5678",
    type: "driver",
    id: "DR002",
  },
  operator: "Оператор 3",
  startTime: "2025-01-02 11:45:00",
  orderId: "#4529",
};

export function Calls({ onNavigateToOrder }: { onNavigateToOrder?: (orderId: string) => void }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "incoming" | "outgoing" | "missed">("all");
  const [callerTypeFilter, setCallerTypeFilter] = useState<"all" | "passenger" | "driver">("all");
  const [viewModal, setViewModal] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<Call | null>(mockActiveCall);
  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);

  const filteredCalls = mockCalls.filter((call) => {
    const matchesSearch =
      call.caller.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      call.caller.phone.includes(searchTerm) ||
      call.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === "all" || call.type === typeFilter;
    const matchesCallerType =
      callerTypeFilter === "all" || call.caller.type === callerTypeFilter;
    return matchesSearch && matchesType && matchesCallerType;
  });

  const selectedCall = mockCalls.find((c) => c.id === viewModal);

  const getCallIcon = (type: string, status: string) => {
    if (status === "missed") return PhoneMissed;
    if (type === "incoming") return PhoneIncoming;
    return PhoneOutgoing;
  };

  const getCallColor = (type: string, status: string) => {
    if (status === "missed") return "text-red-600 dark:text-red-400";
    if (status === "active") return "text-green-600 dark:text-green-400";
    if (type === "incoming") return "text-blue-600 dark:text-blue-400";
    return "text-gray-600 dark:text-gray-400";
  };

  const handleEndCall = () => {
    setActiveCall(null);
    setIsMuted(false);
    setIsOnHold(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl dark:text-white">Телефонные звонки</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Управление звонками и история вызовов
          </p>
        </div>
      </div>

      {/* Active Call Panel */}
      {activeCall && (
        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg p-6 text-white shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                <User className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-2xl">{activeCall.caller.name}</h3>
                <p className="text-green-100">{activeCall.caller.phone}</p>
                <p className="text-sm text-green-100">
                  {activeCall.caller.type === "passenger" ? "Пассажир" : "Водитель"}
                  {activeCall.orderId && ` • Заказ ${activeCall.orderId}`}
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-4xl font-light">00:02:15</div>
              <div className="text-sm text-green-100 mt-1">
                {activeCall.type === "incoming" ? "Входящий" : "Исходящий"} звонок
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
                isMuted
                  ? "bg-red-500 hover:bg-red-600"
                  : "bg-white/20 hover:bg-white/30"
              }`}
            >
              {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>
            <button
              onClick={() => setIsOnHold(!isOnHold)}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
                isOnHold
                  ? "bg-yellow-500 hover:bg-yellow-600"
                  : "bg-white/20 hover:bg-white/30"
              }`}
            >
              {isOnHold ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            </button>
            <button className="w-14 h-14 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors">
              <Volume2 className="w-6 h-6" />
            </button>
            <button
              onClick={handleEndCall}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors shadow-lg"
            >
              <PhoneOff className="w-8 h-8" />
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
              <PhoneCall className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-sm">Всего звонков</p>
          </div>
          <p className="text-3xl dark:text-white">
            {mockCalls.filter((c) => c.status === "completed").length}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
              <PhoneIncoming className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-sm">Входящие</p>
          </div>
          <p className="text-3xl dark:text-white">
            {mockCalls.filter((c) => c.type === "incoming").length}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
              <PhoneOutgoing className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-sm">Исходящие</p>
          </div>
          <p className="text-3xl dark:text-white">
            {mockCalls.filter((c) => c.type === "outgoing").length}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center">
              <PhoneMissed className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-sm">Пропущенные</p>
          </div>
          <p className="text-3xl dark:text-white">
            {mockCalls.filter((c) => c.status === "missed").length}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Поиск по имени, телефону или ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            >
              <option value="all">Все типы</option>
              <option value="incoming">Входящие</option>
              <option value="outgoing">Исходящие</option>
              <option value="missed">Пропущенные</option>
            </select>
            <select
              value={callerTypeFilter}
              onChange={(e) => setCallerTypeFilter(e.target.value as any)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            >
              <option value="all">Все абоненты</option>
              <option value="passenger">Пассажиры</option>
              <option value="driver">Водители</option>
            </select>
          </div>
        </div>
      </div>

      {/* Calls Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
              <tr>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Тип
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Абонент
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Оператор
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Время
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Длительность
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Заказ
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Статус
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredCalls.map((call) => {
                const Icon = getCallIcon(call.type, call.status);
                const color = getCallColor(call.type, call.status);
                return (
                  <tr key={call.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4">
                      <Icon className={`w-5 h-5 ${color}`} />
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="dark:text-white">{call.caller.name}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {call.caller.phone}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          {call.caller.type === "passenger" ? "Пассажир" : "Водитель"}
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-4 dark:text-white">{call.operator}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                        <Clock className="w-4 h-4" />
                        {call.startTime}
                      </div>
                    </td>
                    <td className="px-6 py-4 dark:text-white">
                      {call.duration || "-"}
                    </td>
                    <td className="px-6 py-4">
                      {call.orderId ? (
                        <span className="text-blue-600 dark:text-blue-400">
                          {call.orderId}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs ${
                          call.status === "active"
                            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                            : call.status === "missed"
                            ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                            : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                        }`}
                      >
                        {call.status === "active"
                          ? "Активный"
                          : call.status === "missed"
                          ? "Пропущен"
                          : "Завершен"}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setViewModal(call.id)}
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                          title="Подробнее"
                        >
                          <Phone className="w-5 h-5" />
                        </button>
                        {call.recording && (
                          <button
                            className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
                            title="Прослушать запись"
                          >
                            <Play className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* View Call Modal */}
      {viewModal && selectedCall && (
        <Modal isOpen={true} onClose={() => setViewModal(null)} title="Детали звонка">
          <div className="space-y-6">
            <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center">
                <User className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="flex-1">
                <p className="dark:text-white">{selectedCall.caller.name}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {selectedCall.caller.phone}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {selectedCall.caller.type === "passenger" ? "Пассажир" : "Водитель"} • ID:{" "}
                  {selectedCall.caller.id}
                </p>
              </div>
              {(() => {
                const Icon = getCallIcon(selectedCall.type, selectedCall.status);
                return (
                  <Icon
                    className={`w-8 h-8 ${getCallColor(
                      selectedCall.type,
                      selectedCall.status
                    )}`}
                  />
                );
              })()}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">ID звонка</p>
                <p className="dark:text-white">{selectedCall.id}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Тип</p>
                <p className="dark:text-white">
                  {selectedCall.type === "incoming" ? "Входящий" : "Исходящий"}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Оператор</p>
                <p className="dark:text-white">{selectedCall.operator}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Связанный заказ</p>
                <p className="dark:text-white">{selectedCall.orderId || "-"}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Время начала</p>
                <p className="dark:text-white">{selectedCall.startTime}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Длительность</p>
                <p className="dark:text-white">{selectedCall.duration || "-"}</p>
              </div>
            </div>

            {selectedCall.notes && (
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Примечания</p>
                <p className="dark:text-white p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  {selectedCall.notes}
                </p>
              </div>
            )}

            {selectedCall.recording && (
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Запись звонка</p>
                <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <button className="w-10 h-10 rounded-full bg-green-500 hover:bg-green-600 text-white flex items-center justify-center">
                    <Play className="w-5 h-5" />
                  </button>
                  <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-600 rounded-full">
                    <div className="h-full w-0 bg-green-500 rounded-full"></div>
                  </div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {selectedCall.duration}
                  </span>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button className="flex-1 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 flex items-center justify-center gap-2">
                <Phone className="w-5 h-5" />
                Перезвонить
              </button>
              {selectedCall.orderId && (
                <button
                  onClick={() => onNavigateToOrder && onNavigateToOrder(selectedCall.orderId)}
                  className="flex-1 bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700"
                >
                  Открыть заказ
                </button>
              )}
              <button
                onClick={() => setViewModal(null)}
                className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Закрыть
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}