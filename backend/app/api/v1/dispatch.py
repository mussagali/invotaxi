"""Thin HTTP endpoints for dispatch jobs and route plans."""

import uuid
from datetime import date
from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, get_redis, require_roles
from app.domain.enums import UserRole
from app.domain.models import User
from app.domain.repositories import RoutingJobsRepository
from app.domain.schemas import (
    DispatchInsertRequest,
    DispatchInsertResult,
    DispatchJobCreate,
    DispatchJobCreated,
    PlanMoveRequest,
    PlanOut,
    PlanSummaryOut,
    PlanUnassignRequest,
    RoutingJobOut,
    ValidationReportOut,
)
from app.services.dispatch import DispatchService, DispatchServiceError
from app.services.plans import PlanServiceError, PlansService

router = APIRouter(tags=["dispatch"])
dispatcher = require_roles(UserRole.dispatcher, UserRole.admin)


def _raise_error(exc: DispatchServiceError | PlanServiceError) -> NoReturn:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post("/dispatch/jobs", response_model=DispatchJobCreated, status_code=202)
async def create_dispatch_job(
    body: DispatchJobCreate,
    actor: Annotated[User, Depends(dispatcher)],
    session: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> DispatchJobCreated:
    try:
        job_id = await DispatchService(session, redis).create_job(
            body.service_date,
            body.district,
            body.config_overrides,
            actor,
        )
    except DispatchServiceError as exc:
        _raise_error(exc)
    return DispatchJobCreated(job_id=job_id)


@router.get("/dispatch/jobs/{job_id}", response_model=RoutingJobOut)
async def get_dispatch_job(
    job_id: uuid.UUID,
    actor: Annotated[User, Depends(dispatcher)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> RoutingJobOut:
    job = await RoutingJobsRepository(session).get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return RoutingJobOut.model_validate(job)


@router.post("/dispatch/insert", response_model=DispatchInsertResult)
async def insert_order(
    body: DispatchInsertRequest,
    actor: Annotated[User, Depends(dispatcher)],
    session: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> DispatchInsertResult:
    try:
        return await DispatchService(session, redis).insert(body.order_id, actor)
    except DispatchServiceError as exc:
        _raise_error(exc)


@router.get("/plans", response_model=list[PlanSummaryOut])
async def list_plans(
    actor: Annotated[User, Depends(dispatcher)],
    session: Annotated[AsyncSession, Depends(get_db)],
    service_date: Annotated[date | None, Query(alias="date")] = None,
    district: str | None = None,
) -> list[PlanSummaryOut]:
    return await PlansService(session).list_plans(
        service_date=service_date, district=district
    )


@router.get("/plans/{plan_id}", response_model=PlanOut)
async def get_plan(
    plan_id: uuid.UUID,
    actor: Annotated[User, Depends(dispatcher)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> PlanOut:
    try:
        return await PlansService(session).get(plan_id)
    except PlanServiceError as exc:
        _raise_error(exc)


@router.post("/plans/{plan_id}/move", response_model=PlanOut)
async def move_order(
    plan_id: uuid.UUID,
    body: PlanMoveRequest,
    actor: Annotated[User, Depends(dispatcher)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> PlanOut:
    try:
        return await PlansService(session).move(
            plan_id, body.order_id, body.to_driver_id, body.position
        )
    except PlanServiceError as exc:
        await session.rollback()
        _raise_error(exc)


@router.post("/plans/{plan_id}/unassign", response_model=PlanOut)
async def unassign_order(
    plan_id: uuid.UUID,
    body: PlanUnassignRequest,
    actor: Annotated[User, Depends(dispatcher)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> PlanOut:
    try:
        return await PlansService(session).unassign(plan_id, body.order_id, actor)
    except PlanServiceError as exc:
        await session.rollback()
        _raise_error(exc)


@router.post("/plans/{plan_id}/revalidate", response_model=ValidationReportOut)
async def revalidate_plan(
    plan_id: uuid.UUID,
    actor: Annotated[User, Depends(dispatcher)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> ValidationReportOut:
    try:
        return await PlansService(session).revalidate(plan_id)
    except PlanServiceError as exc:
        _raise_error(exc)


@router.post("/plans/{plan_id}/publish", response_model=PlanOut)
async def publish_plan(
    plan_id: uuid.UUID,
    actor: Annotated[User, Depends(dispatcher)],
    session: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
    force: bool = False,
) -> PlanOut:
    try:
        return await PlansService(session).publish(plan_id, actor, redis, force=force)
    except PlanServiceError as exc:
        await session.rollback()
        _raise_error(exc)
