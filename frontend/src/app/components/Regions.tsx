import { useEffect, useState } from "react";
import { Activity, Car, Loader2, MapPin, ShoppingCart, Users } from "lucide-react";
import { Region, RegionStats, regionsApi } from "../services/regions";

const cards = [
  { key: "drivers", label: "Водители", icon: Car, color: "text-blue-600" },
  { key: "passengers", label: "Пассажиры", icon: Users, color: "text-violet-600" },
  { key: "active_orders", label: "Активные заказы", icon: Activity, color: "text-emerald-600" },
  { key: "total_orders", label: "Всего заказов", icon: ShoppingCart, color: "text-amber-600" },
] as const;

export function Regions() {
  const [region, setRegion] = useState<Region | null>(null);
  const [stats, setStats] = useState<RegionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([regionsApi.getRegions(), regionsApi.getRegionStats("atyrau")])
      .then(([regions, nextStats]) => {
        if (cancelled) return;
        setRegion(regions[0] ?? null);
        setStats(nextStats);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Не удалось загрузить зону");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl text-gray-900 dark:text-white">Зона обслуживания</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Рабочая зона задаётся конфигурацией backend и использует реальные данные системы.
        </p>
      </div>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center">
          <Loader2 className="h-9 w-9 animate-spin text-indigo-600" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : region && stats ? (
        <>
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-indigo-100 p-3 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
                <MapPin className="h-7 w-7" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{region.title}</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Центр: {region.center_lat.toFixed(5)}, {region.center_lon.toFixed(5)} · радиус обслуживания {(region.service_radius_meters ?? 0) / 1000} км
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map(({ key, label, icon: Icon, color }) => (
              <div key={key} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <Icon className={`mb-3 h-6 w-6 ${color}`} />
                <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
                <p className="mt-1 text-3xl font-semibold text-gray-900 dark:text-white">{stats[key]}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-gray-500 dark:text-gray-400">Зона обслуживания не настроена.</div>
      )}
    </div>
  );
}
