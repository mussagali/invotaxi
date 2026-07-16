"""Pydantic schemas (API contracts)."""

import uuid
from datetime import date, datetime, time
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.enums import (
    AssignmentKind,
    OrderStatus,
    PlanStatus,
    RoutingJobStatus,
    UserRole,
    UserStatus,
)

ATYRAU_LAT_MIN = 46.85
ATYRAU_LAT_MAX = 47.35
ATYRAU_LON_MIN = 51.55
ATYRAU_LON_MAX = 52.15


class LoginRequest(BaseModel):
    phone: str = Field(min_length=6, max_length=20)
    password: str = Field(min_length=1, max_length=128)


class DevLoginRequest(LoginRequest):
    role: Literal["client", "driver", "dispatcher"]


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    phone: str
    role: UserRole
    status: UserStatus


class ClientProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: str
    needs_escort: bool
    notes: str | None = None


class ClientAdminOut(ClientProfileOut):
    user_id: uuid.UUID
    phone: str
    status: UserStatus
    default_addresses: list[Any] = Field(default_factory=list)
    orders_count: int = 0


class ClientAdminPatch(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    needs_escort: bool | None = None
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def is_not_empty(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("at least one client field is required")
        return self


class ClientStatsOut(BaseModel):
    total: int
    with_companion: int
    total_orders: int
    category_i: int = 0


class DriverProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: str
    region: str
    vehicle_model: str | None = None
    plate: str | None = None
    capacity: int
    is_online: bool
    shift_start: time | None = None
    shift_end: time | None = None
    home_lat: float | None = None
    home_lon: float | None = None


class MeResponse(BaseModel):
    user: UserOut
    client_profile: ClientProfileOut | None = None
    driver_profile: DriverProfileOut | None = None


class LoginResponse(BaseModel):
    tokens: TokenPair
    user: UserOut


class ClientProfileIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    needs_escort: bool = False
    notes: str | None = None


class DriverProfileIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    region: str = Field(min_length=1, max_length=100)
    vehicle_model: str | None = None
    plate: str | None = None
    capacity: Literal[4, 6]
    shift_start: time | None = None
    shift_end: time | None = None
    home_lat: float | None = Field(default=None, ge=-90, le=90)
    home_lon: float | None = Field(default=None, ge=-180, le=180)


class CreateUserRequest(BaseModel):
    phone: str = Field(min_length=6, max_length=20)
    # Temporary launch PIN requested by the product owner. Production rollout
    # must replace this with OTP or a stronger password policy.
    password: str = Field(min_length=4, max_length=128)
    role: UserRole
    client_profile: ClientProfileIn | None = None
    driver_profile: DriverProfileIn | None = None

    @model_validator(mode="after")
    def profile_matches_role(self) -> Self:
        if self.role == UserRole.client and self.client_profile is None:
            raise ValueError("client role requires client_profile")
        if self.role == UserRole.driver and self.driver_profile is None:
            raise ValueError("driver role requires driver_profile")
        if self.role in (UserRole.dispatcher, UserRole.admin) and (
            self.client_profile or self.driver_profile
        ):
            raise ValueError(f"{self.role} must not have a profile")
        return self


class CreateUserResponse(BaseModel):
    user: UserOut


class _AtyrauCoordinates(BaseModel):
    pickup_lat: float | None = None
    pickup_lon: float | None = None
    dropoff_lat: float | None = None
    dropoff_lon: float | None = None

    @model_validator(mode="after")
    def coordinates_are_in_atyrau(self) -> Self:
        for name in ("pickup_lat", "dropoff_lat"):
            value = getattr(self, name)
            if value is not None and not ATYRAU_LAT_MIN <= value <= ATYRAU_LAT_MAX:
                raise ValueError(f"{name} is outside Atyrau bbox (46.85..47.35)")
        for name in ("pickup_lon", "dropoff_lon"):
            value = getattr(self, name)
            if value is not None and not ATYRAU_LON_MIN <= value <= ATYRAU_LON_MAX:
                raise ValueError(f"{name} is outside Atyrau bbox (51.55..52.15)")
        return self


class OrderCreate(_AtyrauCoordinates):
    client_id: uuid.UUID | None = None
    service_date: date
    desired_time: time
    pickup_addr: str | None = Field(default=None, max_length=1000)
    dropoff_addr: str | None = Field(default=None, max_length=1000)
    escort: bool = False


class OrderPatch(_AtyrauCoordinates):
    desired_time: time | None = None
    pickup_addr: str | None = Field(default=None, max_length=1000)
    dropoff_addr: str | None = Field(default=None, max_length=1000)
    escort: bool | None = None

    @model_validator(mode="after")
    def is_not_empty(self) -> Self:
        allowed = {
            "desired_time",
            "pickup_addr",
            "pickup_lat",
            "pickup_lon",
            "dropoff_addr",
            "dropoff_lat",
            "dropoff_lon",
            "escort",
        }
        if not self.model_fields_set.intersection(allowed):
            raise ValueError("at least one editable order field is required")
        return self


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_id: uuid.UUID
    created_by: uuid.UUID | None
    service_date: date
    desired_time: time
    pickup_addr: str | None
    pickup_lat: float | None
    pickup_lon: float | None
    dropoff_addr: str | None
    dropoff_lat: float | None
    dropoff_lon: float | None
    escort: bool
    seats: int
    twin_group_id: uuid.UUID | None
    status: OrderStatus
    cancel_reason: str | None
    external_id: str | None
    created_at: datetime
    updated_at: datetime


class CancelOrderRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class TransitionOrderRequest(BaseModel):
    to: OrderStatus
    meta: dict[str, Any] = Field(default_factory=dict)


class TwinOrderRequest(BaseModel):
    other_order_id: uuid.UUID


class LegacyOrderImportRow(_AtyrauCoordinates):
    fio: str = Field(min_length=1, max_length=200)
    from_addr: str = Field(min_length=1, max_length=1000)
    to_addr: str = Field(min_length=1, max_length=1000)
    time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    phone: str = Field(min_length=6, max_length=30)
    external_id: str = Field(min_length=1, max_length=200)
    escort_note: str | None = None


class ImportErrorOut(BaseModel):
    index: int
    external_id: str | None = None
    message: str


class ImportReport(BaseModel):
    created: int
    skipped: int
    errors: list[ImportErrorOut]


class DriverOut(DriverProfileOut):
    user_id: uuid.UUID


class DriverShiftOut(BaseModel):
    start: time | None
    end: time | None
    is_active: bool


class DriverMeOut(BaseModel):
    profile: DriverOut
    current_shift: DriverShiftOut


class DriverPatch(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    region: str | None = Field(default=None, min_length=1, max_length=100)
    vehicle_model: str | None = Field(default=None, max_length=200)
    plate: str | None = Field(default=None, max_length=50)
    capacity: Literal[4, 6] | None = None
    is_online: bool | None = None
    shift_start: time | None = None
    shift_end: time | None = None

    @model_validator(mode="after")
    def is_not_empty(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("at least one driver field is required")
        if ("shift_start" in self.model_fields_set) != ("shift_end" in self.model_fields_set):
            raise ValueError("shift_start and shift_end must be updated together")
        return self


class TelemetryPoint(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    ts: datetime
    accuracy_m: float = Field(ge=0, le=10_000)
    speed: float | None = Field(default=None, ge=0)
    heading: float | None = Field(default=None, ge=0, lt=360)


class TelemetryIngestOut(BaseModel):
    accepted: int
    rejected: int


class DriverPositionOut(BaseModel):
    driver_id: uuid.UUID
    lat: float
    lon: float
    ts: datetime
    accuracy_m: float
    speed: float | None = None
    heading: float | None = None


class DeviceRegistration(BaseModel):
    fcm_token: str = Field(min_length=8, max_length=4096)
    platform: Literal["android", "ios", "web"]


class DispatchJobCreate(BaseModel):
    service_date: date
    district: str = Field(min_length=1, max_length=100)
    config_overrides: dict[str, Any] = Field(default_factory=dict)


class DispatchJobCreated(BaseModel):
    job_id: uuid.UUID


class DispatchInsertRequest(BaseModel):
    order_id: uuid.UUID


class DispatchInsertResult(BaseModel):
    placed: bool
    reason: str | None = None
    plan_id: uuid.UUID | None = None
    driver_id: uuid.UUID | None = None


class PlanMoveRequest(BaseModel):
    order_id: uuid.UUID
    to_driver_id: uuid.UUID
    position: int | None = Field(default=None, ge=0)


class PlanUnassignRequest(BaseModel):
    order_id: uuid.UUID


class PlanStopOut(BaseModel):
    order_id: uuid.UUID
    lat: float
    lon: float
    desired_time: time
    calculated_min: float


class PlanBlockOut(BaseModel):
    seq: int
    kind: AssignmentKind
    order_ids: list[uuid.UUID]
    desired_times: dict[str, time]
    planned_pickup_at: datetime | None
    planned_dropoff_at: datetime | None
    pickup_seq: list[PlanStopOut]
    dropoff_seq: list[PlanStopOut]


class PlanLunchOut(BaseModel):
    start_min: int
    end_min: int
    is_full: bool


class PlanDriverOut(BaseModel):
    driver_id: uuid.UUID
    blocks: list[PlanBlockOut]
    lunch: PlanLunchOut | None = None


class PlanExceptionOut(BaseModel):
    order_id: uuid.UUID
    desired_time: time
    reason: str


class PlanOut(BaseModel):
    id: uuid.UUID
    service_date: date
    district: str
    status: PlanStatus
    needs_review: bool
    stats: dict[str, Any] | None
    routing_job_id: uuid.UUID | None
    created_at: datetime
    published_at: datetime | None
    drivers: list[PlanDriverOut]
    exceptions: list[PlanExceptionOut]


class PlanSummaryOut(BaseModel):
    id: uuid.UUID
    service_date: date
    district: str
    status: PlanStatus
    needs_review: bool
    stats: dict[str, Any] | None
    routing_job_id: uuid.UUID | None
    created_at: datetime
    published_at: datetime | None


class ValidationIssueOut(BaseModel):
    code: str
    message: str
    driver_id: str | None = None
    order_id: str | None = None


class ValidationReportOut(BaseModel):
    is_valid: bool
    issues: list[ValidationIssueOut]


class RoutingJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    service_date: date
    district: str
    status: RoutingJobStatus


ReportType = Literal["dispatcher_sheet", "day_summary", "unassigned_heatmap"]
ReportStatus = Literal["queued", "running", "done", "failed"]


class ReportPlanParams(BaseModel):
    plan_id: uuid.UUID


class ReportPeriodParams(BaseModel):
    date_from: date = Field(alias="from")
    date_to: date = Field(alias="to")

    @model_validator(mode="after")
    def dates_are_ordered(self) -> Self:
        if self.date_from > self.date_to:
            raise ValueError("from must not be after to")
        return self


class ReportCreate(BaseModel):
    type: ReportType
    params: dict[str, Any]

    @model_validator(mode="after")
    def params_match_type(self) -> Self:
        model: type[BaseModel] = (
            ReportPeriodParams if self.type == "unassigned_heatmap" else ReportPlanParams
        )
        parsed = model.model_validate(self.params)
        self.params = parsed.model_dump(mode="json", by_alias=True)
        return self


class ReportCreated(BaseModel):
    report_id: uuid.UUID


class ReportOut(BaseModel):
    report_id: uuid.UUID
    type: ReportType
    status: ReportStatus
    params: dict[str, Any]
    created_at: datetime
    download_url: str | None = None
    error: str | None = None


class UnassignedSlotOut(BaseModel):
    slot: str
    districts: dict[str, int]


class UnassignedStatsOut(BaseModel):
    date_from: date = Field(serialization_alias="from")
    date_to: date = Field(serialization_alias="to")
    districts: list[str]
    slots: list[UnassignedSlotOut]


class DriverAnomalyOut(BaseModel):
    driver_id: uuid.UUID
    full_name: str | None = None
    count: int


class AnomalyStatsOut(BaseModel):
    date_from: date = Field(serialization_alias="from")
    date_to: date = Field(serialization_alias="to")
    drivers: list[DriverAnomalyOut]
