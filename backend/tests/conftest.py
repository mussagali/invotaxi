import os

# Set safe defaults BEFORE any app import: Settings requires these at import
# time in some modules (e.g. app.workers.main). Real integration tests
# override URLs with testcontainer endpoints.
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:59999/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:59998/0")
os.environ.setdefault("ENV", "dev")
os.environ.setdefault("LOG_LEVEL", "INFO")
