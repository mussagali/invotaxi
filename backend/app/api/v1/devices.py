"""Device-token registration."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from redis.asyncio import Redis

from app.core.deps import get_current_user, get_redis
from app.domain.models import User
from app.domain.schemas import DeviceRegistration
from app.workers.push import DEVICE_TOKENS_KEY

router = APIRouter(prefix="/devices", tags=["devices"])


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
async def register_device(
    body: DeviceRegistration,
    user: Annotated[User, Depends(get_current_user)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> Response:
    key = DEVICE_TOKENS_KEY.format(user_id=user.id)
    pipe = redis.pipeline(transaction=False)
    pipe.sadd(key, body.fcm_token)
    pipe.hset("devices:platform", body.fcm_token, body.platform)
    await pipe.execute()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
