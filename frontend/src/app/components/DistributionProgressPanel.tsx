import type { DispatchJobProgress } from "../services/dispatch";

interface DistributionProgressPanelProps {
  progress: DispatchJobProgress;
  title?: string;
}

function slotStatusIcon(status: string): string {
  if (status === "done") return "✓";
  if (status === "running") return "…";
  return "○";
}

export function DistributionProgressPanel({ progress, title = "Распределение по слотам" }: DistributionProgressPanelProps) {
  const assigned = progress.orders_assigned ?? 0;
  const total = progress.orders_total ?? 0;
  const percent = progress.percent ?? 0;
  const percentMode =
    progress.percent_mode ??
    (progress.slots_total === 1 ? "orders" : "slots");
  const percentLabel = percentMode === "orders" ? "заказов" : "слотов";
  const phase = progress.phase;
  const minivanGroups = progress.minivan_groups_assigned ?? 0;
  const minivanAssigned = progress.minivan_group_orders_assigned ?? 0;
  const runningSlot = progress.slots.find((slot) => slot.status === "running");
  const radiusStage = runningSlot?.radius_stage;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/80 p-4 space-y-3">
      <div className="text-sm font-medium text-blue-900">{title}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-blue-800">
        {progress.slots.map((slot) => (
          <span
            key={slot.slot_label}
            className={
              slot.status === "running"
                ? "font-semibold text-blue-700"
                : slot.status === "done"
                  ? "text-green-700"
                  : "text-blue-600/70"
            }
          >
            {slot.slot_label} {slotStatusIcon(slot.status)}
          </span>
        ))}
      </div>
      {phase ? (
        <div className="text-xs text-blue-700">
          Фаза:{" "}
          {phase === "external_router"
            ? "внешний роутер"
            : phase === "minivan_groups"
            ? "минивэн-группы"
            : phase === "time_slots"
              ? "тайм-слоты"
              : "финализация"}
        </div>
      ) : null}
      {radiusStage ? (
        <div className="text-xs text-blue-700">
          Этап: {radiusStage === "finalize" ? "завершение" : `радиус ${radiusStage}`}
        </div>
      ) : null}
      {phase === "minivan_groups" || minivanAssigned > 0 || minivanGroups > 0 ? (
        <div className="text-xs text-blue-700">
          Минивэн-группы: {minivanGroups} групп, {minivanAssigned} заказов
        </div>
      ) : null}
      <div className="text-sm text-blue-900">
        Распределено: {assigned}
        {total > 0 ? ` / ${total}` : ""} ({percent}% {percentLabel})
      </div>
      <div className="h-2 w-full rounded-full bg-blue-100 overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all duration-500"
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </div>
  );
}
