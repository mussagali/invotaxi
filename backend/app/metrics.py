"""Prometheus metrics shared by the API and ARQ worker."""

from prometheus_client import Counter, Gauge, Histogram

ACTIVE_WEBSOCKETS = Gauge(
    "invotaxi_websocket_connections",
    "Currently active WebSocket connections.",
    multiprocess_mode="livesum",
)

HTTP_REQUESTS_INPROGRESS = Gauge(
    "http_requests_inprogress",
    "Number of HTTP requests currently being processed.",
    multiprocess_mode="livesum",
)

GPS_POINTS = Counter(
    "invotaxi_gps_points_total",
    "Driver GPS points processed by ingestion.",
    ("result",),
)

GPS_ANOMALIES = Counter(
    "invotaxi_gps_anomalies_dropped_total",
    "GPS points dropped as anomalous or outside the accepted time window.",
    ("reason",),
)

ARQ_QUEUE_SIZE = Gauge(
    "invotaxi_arq_queue_size",
    "Number of jobs waiting in the default ARQ queue.",
)

DISPATCH_JOB_DURATION = Histogram(
    "invotaxi_dispatch_job_duration_seconds",
    "Dispatch job duration, including failed jobs.",
    ("status",),
    buckets=(1, 5, 15, 30, 60, 120, 300, 600, 900, 1200, 1800, 3600),
)

DISPATCH_JOB_LAST_DURATION = Gauge(
    "invotaxi_dispatch_job_last_duration_seconds",
    "Duration of the last completed dispatch job.",
    ("status",),
)

DISPATCH_JOB_IN_PROGRESS = Gauge(
    "invotaxi_dispatch_job_in_progress",
    "Number of dispatch jobs currently executing in this worker.",
)

DISPATCH_JOB_STARTED_TIMESTAMP = Gauge(
    "invotaxi_dispatch_job_started_timestamp_seconds",
    "Unix timestamp at which the currently executing dispatch job started; zero when idle.",
)

CUSTOM_METRICS = (
    ACTIVE_WEBSOCKETS,
    HTTP_REQUESTS_INPROGRESS,
    GPS_POINTS,
    GPS_ANOMALIES,
    ARQ_QUEUE_SIZE,
    DISPATCH_JOB_DURATION,
    DISPATCH_JOB_LAST_DURATION,
    DISPATCH_JOB_IN_PROGRESS,
    DISPATCH_JOB_STARTED_TIMESTAMP,
)
