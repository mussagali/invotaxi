import enum


class UserRole(enum.StrEnum):
    client = "client"
    driver = "driver"
    dispatcher = "dispatcher"
    admin = "admin"


class UserStatus(enum.StrEnum):
    active = "active"
    blocked = "blocked"


class OrderStatus(enum.StrEnum):
    created = "created"
    scheduled = "scheduled"
    assigned = "assigned"
    driver_en_route = "driver_en_route"
    picked_up = "picked_up"
    completed = "completed"
    cancelled = "cancelled"
    exception = "exception"


class PlanStatus(enum.StrEnum):
    draft = "draft"
    published = "published"
    archived = "archived"


class AssignmentKind(enum.StrEnum):
    trip = "trip"
    run = "run"


class RoutingJobStatus(enum.StrEnum):
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"
