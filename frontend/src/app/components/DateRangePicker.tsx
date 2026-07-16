import { useState } from "react";
import { Calendar } from "lucide-react";

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

const PRESET_RANGES = [
  { label: "Сегодня", days: 0 },
  { label: "Последние 7 дней", days: 7 },
  { label: "Последние 30 дней", days: 30 },
  { label: "Последние 90 дней", days: 90 },
  { label: "Последний месяц", days: 30 },
  { label: "Последние 3 месяца", days: 90 },
  { label: "Последние 6 месяцев", days: 180 },
  { label: "Последний год", days: 365 },
];

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);

  const formatDate = (date: Date | null): string => {
    if (!date) return "";
    return date.toLocaleDateString("ru-RU", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const applyPreset = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    onChange({ from, to });
    setIsOpen(false);
    setShowCustom(false);
  };

  const handleCustomFromChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value ? new Date(e.target.value) : null;
    if (date) {
      date.setHours(0, 0, 0, 0);
    }
    onChange({ ...value, from: date });
  };

  const handleCustomToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value ? new Date(e.target.value) : null;
    if (date) {
      date.setHours(23, 59, 59, 999);
    }
    onChange({ ...value, to: date });
  };

  const getDisplayText = (): string => {
    if (value.from && value.to) {
      return `${formatDate(value.from)} - ${formatDate(value.to)}`;
    }
    return "Выберите период";
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-200 dark:hover:bg-gray-600"
      >
        <Calendar className="w-5 h-5" />
        <span>{getDisplayText()}</span>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 min-w-[300px]">
          <div className="p-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                Быстрый выбор
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {PRESET_RANGES.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => applyPreset(preset.days)}
                    className="text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <button
                onClick={() => setShowCustom(!showCustom)}
                className="text-sm font-semibold text-gray-900 dark:text-white mb-2"
              >
                {showCustom ? "Скрыть" : "Показать"} кастомный выбор
              </button>

              {showCustom && (
                <div className="space-y-3 mt-2">
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                      От
                    </label>
                    <input
                      type="date"
                      value={
                        value.from
                          ? value.from.toISOString().split("T")[0]
                          : ""
                      }
                      onChange={handleCustomFromChange}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                      До
                    </label>
                    <input
                      type="date"
                      value={
                        value.to ? value.to.toISOString().split("T")[0] : ""
                      }
                      onChange={handleCustomToChange}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    />
                  </div>
                  <button
                    onClick={() => {
                      if (value.from && value.to) {
                        setIsOpen(false);
                      }
                    }}
                    disabled={!value.from || !value.to}
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    Применить
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
