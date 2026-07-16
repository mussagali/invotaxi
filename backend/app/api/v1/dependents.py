"""Guardian-managed children and dependents."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.domain.enums import UserRole
from app.domain.models import ClientProfile, Dependent, User
from app.domain.schemas import DependentCreate, DependentOut, DependentPatch

router = APIRouter(prefix="/dependents", tags=["dependents"])


async def _guardian_profile(session: AsyncSession, user: User) -> ClientProfile:
    if user.role != UserRole.client:
        raise HTTPException(status_code=403, detail="only clients can manage dependents")
    profile = await session.get(ClientProfile, user.id)
    if profile is None:
        raise HTTPException(status_code=409, detail="client profile is missing")
    return profile


async def _owned_dependent(
    session: AsyncSession, dependent_id: uuid.UUID, guardian_id: uuid.UUID
) -> Dependent:
    dependent = await session.scalar(
        select(Dependent).where(
            Dependent.id == dependent_id,
            Dependent.guardian_id == guardian_id,
            Dependent.is_active.is_(True),
        )
    )
    if dependent is None:
        raise HTTPException(status_code=404, detail="dependent not found")
    return dependent


@router.get("", response_model=list[DependentOut])
async def list_dependents(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> list[DependentOut]:
    await _guardian_profile(session, user)
    dependents = await session.scalars(
        select(Dependent)
        .where(Dependent.guardian_id == user.id, Dependent.is_active.is_(True))
        .order_by(Dependent.full_name, Dependent.id)
    )
    return [DependentOut.model_validate(item) for item in dependents]


@router.post("", response_model=DependentOut, status_code=201)
async def create_dependent(
    body: DependentCreate,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> DependentOut:
    await _guardian_profile(session, user)
    dependent = Dependent(
        guardian_id=user.id,
        full_name=body.full_name.strip(),
        needs_escort=body.needs_escort,
        notes=body.notes.strip() if body.notes else None,
    )
    session.add(dependent)
    await session.commit()
    await session.refresh(dependent)
    return DependentOut.model_validate(dependent)


@router.patch("/{dependent_id}", response_model=DependentOut)
async def patch_dependent(
    dependent_id: uuid.UUID,
    body: DependentPatch,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> DependentOut:
    await _guardian_profile(session, user)
    dependent = await _owned_dependent(session, dependent_id, user.id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(dependent, field, value.strip() if field == "full_name" else value)
    if not dependent.full_name:
        raise HTTPException(status_code=422, detail="full_name must not be blank")
    await session.commit()
    await session.refresh(dependent)
    return DependentOut.model_validate(dependent)


@router.delete("/{dependent_id}", status_code=204)
async def archive_dependent(
    dependent_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    await _guardian_profile(session, user)
    dependent = await _owned_dependent(session, dependent_id, user.id)
    # Keep historical family orders intact while removing the child from new orders.
    dependent.is_active = False
    await session.commit()
    return Response(status_code=204)
