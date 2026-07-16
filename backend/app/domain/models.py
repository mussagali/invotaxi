"""SQLAlchemy models. Structure only — no business logic (see P1 prompt)."""
import uuid
from datetime import date, datetime, time
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Identity,
    Index,
    Integer,
    PrimaryKeyConstraint,
    Text,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.base import Base, TimestampMixin
from app.domain.enums import (
    AssignmentKind,
    OrderStatus,
    PlanStatus,
    RoutingJobStatus,
    UserRole,
    UserStatus,
)


def _pg_enum(py_enum: type, name: str) -> SAEnum:
    return SAEnum(
        py_enum,
        name=name,
        values_callable=lambda e: [m.value for m in e],
    )


user_role = _pg_enum(UserRole, "user_role")
user_status = _pg_enum(UserStatus, "user_status")
order_status = _pg_enum(OrderStatus, "order_status")
plan_status = _pg_enum(PlanStatus, "plan_status")
assignment_kind = _pg_enum(AssignmentKind, "assignment_kind")
routing_job_status = _pg_enum(RoutingJobStatus, "routing_job_status")


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    phone: Mapped[str] = mapped_column(Text, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[UserRole] = mapped_column(user_role)
    status: Mapped[UserStatus] = mapped_column(
        user_status, server_default=UserStatus.active.value
    )


class ClientProfile(Base):
    __tablename__ = "client_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    full_name: Mapped[str] = mapped_column(Text)
    needs_escort: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    notes: Mapped[str | None] = mapped_column(Text)
    default_addresses: Mapped[list[Any]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))


class Driver(Base):
    __tablename__ = "drivers"
    __table_args__ = (CheckConstraint("capacity IN (4, 6)", name="capacity_4_or_6"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    full_name: Mapped[str] = mapped_column(Text)
    region: Mapped[str] = mapped_column(Text)
    vehicle_model: Mapped[str | None] = mapped_column(Text)
    plate: Mapped[str | None] = mapped_column(Text)
    capacity: Mapped[int] = mapped_column(Integer)
    is_online: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    shift_start: Mapped[time | None] = mapped_column(Time)
    shift_end: Mapped[time | None] = mapped_column(Time)
    home_lat: Mapped[float | None] = mapped_column(Float(53))
    home_lon: Mapped[float | None] = mapped_column(Float(53))


class Order(TimestampMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("seats IN (1, 2)", name="seats_1_or_2"),
        Index("ix_orders_service_date_status", "service_date", "status"),
        Index(
            "ix_orders_twin_group_id",
            "twin_group_id",
            postgresql_where=text("twin_group_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("client_profiles.user_id"), index=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    service_date: Mapped[date] = mapped_column(Date)
    # Client-requested time. NEVER overwritten by the planner (README bug #9/#10).
    desired_time: Mapped[time] = mapped_column(Time)
    pickup_addr: Mapped[str | None] = mapped_column(Text)
    pickup_lat: Mapped[float | None] = mapped_column(Float(53))
    pickup_lon: Mapped[float | None] = mapped_column(Float(53))
    dropoff_addr: Mapped[str | None] = mapped_column(Text)
    dropoff_lat: Mapped[float | None] = mapped_column(Float(53))
    dropoff_lon: Mapped[float | None] = mapped_column(Float(53))
    escort: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    seats: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    twin_group_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    status: Mapped[OrderStatus] = mapped_column(
        order_status, server_default=OrderStatus.created.value
    )
    cancel_reason: Mapped[str | None] = mapped_column(Text)
    external_id: Mapped[str | None] = mapped_column(Text, unique=True)


class RoutePlan(Base):
    __tablename__ = "route_plans"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    service_date: Mapped[date] = mapped_column(Date)
    district: Mapped[str] = mapped_column(Text)
    status: Mapped[PlanStatus] = mapped_column(
        plan_status, server_default=PlanStatus.draft.value
    )
    needs_review: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    stats: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    routing_job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RouteAssignment(Base):
    __tablename__ = "route_assignments"
    __table_args__ = (
        UniqueConstraint("plan_id", "driver_id", "seq", name="uq_assignment_plan_driver_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("route_plans.id", ondelete="CASCADE"), index=True
    )
    driver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drivers.user_id"))
    seq: Mapped[int] = mapped_column(Integer)
    kind: Mapped[AssignmentKind] = mapped_column(assignment_kind)
    order_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)))
    planned_pickup_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    planned_dropoff_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pickup_seq: Mapped[list[Any] | None] = mapped_column(JSONB)
    dropoff_seq: Mapped[list[Any] | None] = mapped_column(JSONB)


class DriverLunch(Base):
    __tablename__ = "driver_lunches"
    __table_args__ = (PrimaryKeyConstraint("plan_id", "driver_id", name="pk_driver_lunches"),)

    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("route_plans.id", ondelete="CASCADE"))
    driver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drivers.user_id"))
    start_min: Mapped[int] = mapped_column(Integer)
    end_min: Mapped[int] = mapped_column(Integer)
    is_full: Mapped[bool] = mapped_column(Boolean)


class DriverTrackHistory(Base):
    __tablename__ = "driver_track_history"
    __table_args__ = (
        PrimaryKeyConstraint("id", "ts", name="pk_driver_track_history"),
        Index("ix_track_history_driver_ts", "driver_id", "ts"),
        {"postgresql_partition_by": "RANGE (ts)"},
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity())
    driver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drivers.user_id"))
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    lat: Mapped[float] = mapped_column(Float(53))
    lon: Mapped[float] = mapped_column(Float(53))
    accuracy_m: Mapped[float | None] = mapped_column(Float(53))


class OrderEvent(Base):
    __tablename__ = "order_events"
    __table_args__ = (Index("ix_order_events_order_ts", "order_id", "ts"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    from_status: Mapped[OrderStatus | None] = mapped_column(order_status)
    to_status: Mapped[OrderStatus] = mapped_column(order_status)
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))


class RoutingJob(Base):
    __tablename__ = "routing_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    service_date: Mapped[date] = mapped_column(Date)
    district: Mapped[str] = mapped_column(Text)
    status: Mapped[RoutingJobStatus] = mapped_column(
        routing_job_status, server_default=RoutingJobStatus.queued.value
    )
    params: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    result_stats: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    unassigned_order_ids: Mapped[list[uuid.UUID] | None] = mapped_column(
        ARRAY(UUID(as_uuid=True))
    )
    bug_report: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
