"""Order lifecycle state machine and audit event creation."""
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.enums import OrderStatus, UserRole
from app.domain.models import Order, OrderEvent, User
from app.domain.repositories import OrdersRepository
from app.realtime.events import OrderStatusChangedPayload, event
from app.services.event_bus import EventBus


class OrderStateError(Exception):
    def __init__(self, message: str, status_code: int = 409) -> None:
        self.status_code = status_code
        super().__init__(message)


_ALLOWED_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    OrderStatus.created: {OrderStatus.scheduled, OrderStatus.cancelled},
    OrderStatus.scheduled: {
        OrderStatus.assigned,
        OrderStatus.cancelled,
        OrderStatus.exception,
    },
    OrderStatus.assigned: {
        OrderStatus.driver_en_route,
        OrderStatus.cancelled,
        OrderStatus.exception,
    },
    OrderStatus.driver_en_route: {OrderStatus.picked_up},
    OrderStatus.picked_up: {OrderStatus.completed},
    OrderStatus.exception: {OrderStatus.scheduled},
}


async def transition_order(
    session: AsyncSession,
    order_id: uuid.UUID,
    to_status: OrderStatus,
    *,
    actor: User | None,
    meta: dict[str, Any] | None = None,
    bus: EventBus | None = None,
) -> Order:
    """Lock, transition and audit an order without committing the transaction."""
    order = await OrdersRepository(session).get_for_update(order_id)
    if order is None:
        raise OrderStateError("order not found", status_code=404)

    from_status = order.status
    if to_status not in _ALLOWED_TRANSITIONS.get(from_status, set()):
        raise OrderStateError(f"transition {from_status.value} -> {to_status.value} is not allowed")

    event_meta = dict(meta or {})
    actor_role = actor.role if actor is not None else None
    if to_status == OrderStatus.cancelled:
        reason = event_meta.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            raise OrderStateError("cancellation reason is required", status_code=422)
        event_meta["reason"] = reason.strip()
        event_meta["cancelled_by"] = actor_role.value if actor_role is not None else "system"
        order.cancel_reason = reason.strip()

    if to_status == OrderStatus.exception:
        if actor_role not in (None, UserRole.dispatcher, UserRole.admin):
            raise OrderStateError(
                "only dispatcher or system may mark an exception", status_code=403
            )
        reason = event_meta.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            raise OrderStateError("exception reason is required in meta", status_code=422)

    if from_status == OrderStatus.exception and actor_role not in (
        UserRole.dispatcher,
        UserRole.admin,
    ):
        raise OrderStateError("only dispatcher may reschedule an exception", status_code=403)

    order.status = to_status
    session.add(
        OrderEvent(
            order_id=order.id,
            actor_id=actor.id if actor is not None else None,
            from_status=from_status,
            to_status=to_status,
            meta=event_meta,
        )
    )
    await session.flush()
    selected_bus = bus or session.info.get("event_bus")
    if isinstance(selected_bus, EventBus):
        await selected_bus.publish(
            f"order:{order.id}",
            event(
                "order.status_changed",
                OrderStatusChangedPayload(
                    order_id=order.id,
                    client_id=order.client_id,
                    from_status=from_status,
                    status=to_status,
                    meta=event_meta,
                ),
            ),
        )
    return order
