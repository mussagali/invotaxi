"""Versioned realtime event contracts."""

from datetime import UTC, date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.domain.enums import OrderStatus


class RoutePublishedPayload(BaseModel):
    plan_id: UUID
    service_date: date
    orders: list[dict[str, Any]] = Field(default_factory=list)


class PlanPublishedPayload(BaseModel):
    plan_id: UUID
    service_date: date
    district: str


class RouteUpdatedPayload(BaseModel):
    plan_id: UUID
    reason: str


class OrderStatusChangedPayload(BaseModel):
    order_id: UUID
    client_id: UUID
    from_status: OrderStatus
    status: OrderStatus
    meta: dict[str, Any] = Field(default_factory=dict)


class DriverPositionPayload(BaseModel):
    order_id: UUID | None = None
    driver_id: UUID
    lat: float
    lon: float
    ts: datetime
    speed: float | None = None
    heading: float | None = None


class PlanDraftReadyPayload(BaseModel):
    plan_id: UUID
    district: str


class OrderExceptionPayload(BaseModel):
    order_id: UUID
    reason: str


EventType = Literal[
    "route.published",
    "plan.published",
    "route.updated",
    "order.status_changed",
    "driver.position",
    "plan.draft_ready",
    "order.exception",
]


class RealtimeEvent(BaseModel):
    v: Literal[1] = 1
    type: EventType
    ts: datetime = Field(default_factory=lambda: datetime.now(UTC))
    payload: dict[str, Any]


def event(event_type: EventType, payload: BaseModel | dict[str, Any]) -> RealtimeEvent:
    values = payload.model_dump(mode="json") if isinstance(payload, BaseModel) else payload
    return RealtimeEvent(type=event_type, payload=values)
