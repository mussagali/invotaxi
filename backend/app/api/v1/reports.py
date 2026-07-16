"""Report queue, downloads, and reporting statistics."""

import json
import uuid
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Annotated

from arq.connections import ArqRedis
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.deps import get_app_settings, get_db, get_redis, require_roles
from app.domain.enums import UserRole
from app.domain.models import Driver, User
from app.domain.schemas import (
    AnomalyStatsOut,
    DriverAnomalyOut,
    ReportCreate,
    ReportCreated,
    ReportOut,
    UnassignedSlotOut,
    UnassignedStatsOut,
)
from app.services.reports import (
    anomaly_counts,
    get_report_metadata,
    save_report_metadata,
    unassigned_stats,
)

router = APIRouter(tags=["reports"])
dispatcher = require_roles(UserRole.dispatcher)
report_reader = require_roles(UserRole.dispatcher, UserRole.admin)


def _is_expected_report_file(path: Path, reports_dir: str, report_id: uuid.UUID) -> bool:
    root = Path(reports_dir).resolve()
    return (
        path.name == f"{report_id}.xlsx"
        and path.resolve().parent == root
        and path.is_file()
    )


async def _visible_report(redis: Redis, report_id: uuid.UUID, actor: User) -> dict[str, str]:
    metadata = await get_report_metadata(redis, report_id)
    if not metadata or (
        actor.role != UserRole.admin and metadata.get("requested_by") != str(actor.id)
    ):
        raise HTTPException(status_code=404, detail="report not found")
    return metadata


@router.post("/reports", response_model=ReportCreated, status_code=202)
async def create_report(
    body: ReportCreate,
    actor: Annotated[User, Depends(dispatcher)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> ReportCreated:
    report_id = uuid.uuid4()
    await save_report_metadata(
        redis,
        report_id,
        {
            "type": body.type,
            "status": "queued",
            "params": json.dumps(body.params, ensure_ascii=False, separators=(",", ":")),
            "path": "",
            "requested_by": str(actor.id),
            "created_at": datetime.now(UTC).isoformat(),
        },
    )
    queued = await ArqRedis(redis.connection_pool).enqueue_job("generate_report", str(report_id))
    if queued is None:
        await redis.delete(f"report:{report_id}")
        raise HTTPException(status_code=503, detail="could not enqueue report")
    return ReportCreated(report_id=report_id)


@router.get("/reports/{report_id}", response_model=ReportOut)
async def get_report(
    report_id: uuid.UUID,
    actor: Annotated[User, Depends(report_reader)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> ReportOut:
    metadata = await _visible_report(redis, report_id, actor)
    return ReportOut(
        report_id=report_id,
        type=metadata["type"],
        status=metadata["status"],
        params=json.loads(metadata["params"]),
        created_at=datetime.fromisoformat(metadata["created_at"]),
        download_url=(
            f"/api/v1/reports/{report_id}/download"
            if metadata["status"] == "done"
            else None
        ),
        error=metadata.get("error") or None,
    )


@router.get("/reports/{report_id}/download", response_class=FileResponse)
async def download_report(
    report_id: uuid.UUID,
    actor: Annotated[User, Depends(report_reader)],
    redis: Annotated[Redis, Depends(get_redis)],
    settings: Annotated[Settings, Depends(get_app_settings)],
) -> FileResponse:
    metadata = await _visible_report(redis, report_id, actor)
    if metadata["status"] != "done":
        raise HTTPException(status_code=409, detail="report is not ready")
    path = Path(metadata.get("path", ""))
    if not _is_expected_report_file(path, settings.reports_dir, report_id):
        raise HTTPException(status_code=404, detail="report file not found")
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"{metadata['type']}-{report_id}.xlsx",
    )


@router.get("/stats/unassigned", response_model=UnassignedStatsOut)
async def get_unassigned_stats(
    actor: Annotated[User, Depends(report_reader)],
    session: Annotated[AsyncSession, Depends(get_db)],
    date_from: Annotated[date, Query(alias="from")],
    date_to: Annotated[date, Query(alias="to")],
) -> UnassignedStatsOut:
    if date_from > date_to:
        raise HTTPException(status_code=422, detail="from must not be after to")
    stats = await unassigned_stats(session, date_from, date_to)
    districts = sorted({district for values in stats.values() for district in values})
    return UnassignedStatsOut(
        date_from=date_from,
        date_to=date_to,
        districts=districts,
        slots=[
            UnassignedSlotOut(
                slot=slot,
                districts={district: values.get(district, 0) for district in districts},
            )
            for slot, values in stats.items()
        ],
    )


@router.get("/stats/anomalies", response_model=AnomalyStatsOut)
async def get_anomaly_stats(
    actor: Annotated[User, Depends(report_reader)],
    session: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
    date_from: Annotated[date, Query(alias="from")],
    date_to: Annotated[date, Query(alias="to")],
) -> AnomalyStatsOut:
    if date_from > date_to:
        raise HTTPException(status_code=422, detail="from must not be after to")
    counts = await anomaly_counts(redis, date_from, date_to)
    names = {
        driver.user_id: driver.full_name
        for driver in await session.scalars(
            select(Driver).where(Driver.user_id.in_(counts))
        )
    }
    return AnomalyStatsOut(
        date_from=date_from,
        date_to=date_to,
        drivers=[
            DriverAnomalyOut(driver_id=driver_id, full_name=names.get(driver_id), count=count)
            for driver_id, count in sorted(
                counts.items(), key=lambda item: (-item[1], str(item[0]))
            )
        ],
    )
