# --- build stage: install dependencies into a venv ---
FROM python:3.12-slim AS build

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
WORKDIR /src

COPY pyproject.toml ./
COPY app ./app
COPY routing ./routing
RUN python -m venv /venv && /venv/bin/pip install .

# --- runtime stage: slim image, non-root ---
FROM python:3.12-slim AS runtime

RUN useradd --create-home --uid 1000 appuser
RUN mkdir -p /data/reports && chown appuser:appuser /data/reports

ENV PATH="/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

COPY --from=build /venv /venv
WORKDIR /app
COPY --chown=appuser:appuser app ./app
COPY --chown=appuser:appuser routing ./routing
COPY --chown=appuser:appuser migrations ./migrations
COPY --chown=appuser:appuser scripts ./scripts
COPY --chown=appuser:appuser alembic.ini ./
COPY --chown=appuser:appuser gunicorn.conf.py ./

USER appuser
EXPOSE 8000

CMD ["gunicorn", "app.main:app", "-k", "uvicorn.workers.UvicornWorker", "-w", "2", "-b", "0.0.0.0:8000"]
