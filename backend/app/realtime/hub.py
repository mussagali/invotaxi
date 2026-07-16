"""Process-local WebSocket registry backed by a single Redis pub/sub listener."""

import asyncio
import contextlib
import json
import time
import uuid
from collections import defaultdict, deque
from collections.abc import Awaitable
from dataclasses import dataclass, field
from typing import Any, cast

import structlog
from anyio import BrokenResourceError, ClosedResourceError, WouldBlock
from fastapi import WebSocket
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.security import InvalidTokenError, decode_token
from app.domain.enums import OrderStatus, UserRole, UserStatus
from app.domain.models import Driver, Order, RoutePlan, User
from app.metrics import ACTIVE_WEBSOCKETS
from app.services.auth import AuthService
from app.services.event_bus import PRESENCE_KEY

logger = structlog.get_logger(__name__)
ACTIVE_ORDERS_KEY = "realtime:active_orders"
ACTIVE_DISTRICTS_KEY = "realtime:active_districts"
ORDER_CONNECTIONS_KEY = "realtime:order:{order_id}"
DISTRICT_CONNECTIONS_KEY = "realtime:district:{district}"
USER_CONNECTIONS_KEY = "realtime:user_connections:{user_id}"
ACTIVE_STATUSES = (
    OrderStatus.assigned,
    OrderStatus.driver_en_route,
    OrderStatus.picked_up,
)
TRANSPORT_ERRORS = (RuntimeError, ClosedResourceError, BrokenResourceError, WouldBlock)


@dataclass(eq=False)
class Connection:
    websocket: WebSocket
    user_id: uuid.UUID
    role: UserRole
    channels: set[str]
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    last_pong: float = field(default_factory=time.monotonic)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def send_json(self, value: dict[str, Any]) -> None:
        async with self.send_lock:
            await self.websocket.send_json(value)


class RealtimeHub:
    def __init__(
        self,
        redis: Redis,
        session_factory: async_sessionmaker[AsyncSession],
        secret_key: str,
    ) -> None:
        self.redis = redis
        self.session_factory = session_factory
        self.secret_key = secret_key
        self._channels: dict[str, set[Connection]] = defaultdict(set)
        self._users: dict[uuid.UUID, deque[Connection]] = defaultdict(deque)
        self._connections_by_id: dict[str, Connection] = {}
        self._lock = asyncio.Lock()
        self._listener_task: asyncio.Task[None] | None = None
        self._ready = asyncio.Event()

    async def start(self) -> None:
        self._listener_task = asyncio.create_task(self._listen(), name="redis-realtime-listener")
        await asyncio.wait_for(self._ready.wait(), timeout=5)

    async def stop(self) -> None:
        listener = self._listener_task
        self._listener_task = None
        if listener is not None:
            listener.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await listener
        async with self._lock:
            connections = list(self._connections_by_id.values())
            self._connections_by_id.clear()
            self._users.clear()
            self._channels.clear()
        ACTIVE_WEBSOCKETS.dec(len(connections))
        for connection in connections:
            with contextlib.suppress(*TRANSPORT_ERRORS):
                await connection.websocket.close(code=1001)

    async def authenticate(self, token: str | None) -> User | None:
        if not token:
            return None
        try:
            payload = decode_token(token, secret_key=self.secret_key, expected_type="access")
        except InvalidTokenError:
            return None
        async with self.session_factory() as session:
            if await AuthService(session, self.redis, self.secret_key).is_access_revoked(payload):
                return None
            try:
                user_id = uuid.UUID(payload["sub"])
            except (KeyError, ValueError):
                return None
            user = await session.get(User, user_id)
            if (
                user is None
                or user.status != UserStatus.active
                or user.role.value != payload.get("role")
            ):
                return None
            return user

    async def channels_for(self, user: User) -> set[str]:
        if user.role == UserRole.driver:
            return {f"driver:{user.id}"}
        async with self.session_factory() as session:
            if user.role == UserRole.client:
                ids = await session.scalars(
                    select(Order.id).where(
                        Order.client_id == user.id,
                        Order.status.in_(ACTIVE_STATUSES),
                    )
                )
                return {f"order:{order_id}" for order_id in ids}
            if user.role in (UserRole.dispatcher, UserRole.admin):
                districts = set(await session.scalars(select(RoutePlan.district).distinct()))
                districts.update(await session.scalars(select(Driver.region).distinct()))
                return {f"dispatch:{district}" for district in districts} | {"dispatch:*"}
        return set()

    async def register(self, websocket: WebSocket, user: User) -> Connection:
        connection = Connection(websocket, user.id, user.role, await self.channels_for(user))
        evicted: Connection | None = None
        async with self._lock:
            rows = self._users[user.id]
            if len(rows) >= 3:
                evicted = rows.popleft()
                self._remove_local(evicted)
            rows.append(connection)
            self._connections_by_id[connection.id] = connection
            for channel in connection.channels:
                self._channels[channel].add(connection)
        ACTIVE_WEBSOCKETS.inc()
        if evicted is not None:
            ACTIVE_WEBSOCKETS.dec()
            await self._remove_redis(evicted)
            with contextlib.suppress(*TRANSPORT_ERRORS):
                await evicted.websocket.close(code=4408, reason="connection limit exceeded")
        await self._add_redis(connection)
        return connection

    async def unregister(self, connection: Connection) -> None:
        async with self._lock:
            was_registered = connection.id in self._connections_by_id
            rows = self._users.get(connection.user_id)
            if rows is not None:
                with contextlib.suppress(ValueError):
                    rows.remove(connection)
                if not rows:
                    self._users.pop(connection.user_id, None)
            self._remove_local(connection)
        if was_registered:
            ACTIVE_WEBSOCKETS.dec()
        await self._remove_redis(connection)

    def _remove_local(self, connection: Connection) -> None:
        self._connections_by_id.pop(connection.id, None)
        for channel in connection.channels:
            rows = self._channels.get(channel)
            if rows is not None:
                rows.discard(connection)
                if not rows:
                    self._channels.pop(channel, None)

    async def _add_redis(self, connection: Connection) -> None:
        pipe = self.redis.pipeline(transaction=False)
        presence = PRESENCE_KEY.format(user_id=connection.user_id)
        pipe.sadd(presence, connection.id)
        pipe.expire(presence, 90)
        user_connections = USER_CONNECTIONS_KEY.format(user_id=connection.user_id)
        pipe.zadd(user_connections, {connection.id: time.time()})
        pipe.expire(user_connections, 90)
        for channel in connection.channels:
            if channel.startswith("order:"):
                order_id = channel.removeprefix("order:")
                pipe.sadd(ORDER_CONNECTIONS_KEY.format(order_id=order_id), connection.id)
                pipe.sadd(ACTIVE_ORDERS_KEY, order_id)
            elif channel.startswith("dispatch:") and channel != "dispatch:*":
                district = channel.removeprefix("dispatch:")
                pipe.sadd(DISTRICT_CONNECTIONS_KEY.format(district=district), connection.id)
                pipe.sadd(ACTIVE_DISTRICTS_KEY, district)
        await pipe.execute()
        excess = max(0, int(await self.redis.zcard(user_connections)) - 3)
        if excess:
            oldest = await self.redis.zrange(user_connections, 0, excess - 1)
            for connection_id in oldest:
                await self.redis.publish(f"realtime:control:{connection_id}", "connection_limit")

    async def _remove_redis(self, connection: Connection) -> None:
        await cast(
            Awaitable[int],
            self.redis.srem(PRESENCE_KEY.format(user_id=connection.user_id), connection.id),
        )
        await self.redis.zrem(
            USER_CONNECTIONS_KEY.format(user_id=connection.user_id), connection.id
        )
        for channel in connection.channels:
            if channel.startswith("order:"):
                order_id = channel.removeprefix("order:")
                key = ORDER_CONNECTIONS_KEY.format(order_id=order_id)
                await cast(Awaitable[int], self.redis.srem(key, connection.id))
                if not await cast(Awaitable[int], self.redis.scard(key)):
                    await cast(Awaitable[int], self.redis.srem(ACTIVE_ORDERS_KEY, order_id))
            elif channel.startswith("dispatch:") and channel != "dispatch:*":
                district = channel.removeprefix("dispatch:")
                key = DISTRICT_CONNECTIONS_KEY.format(district=district)
                await cast(Awaitable[int], self.redis.srem(key, connection.id))
                if not await cast(Awaitable[int], self.redis.scard(key)):
                    await cast(
                        Awaitable[int],
                        self.redis.srem(ACTIVE_DISTRICTS_KEY, district),
                    )

    async def refresh_presence(self, connection: Connection) -> None:
        pipe = self.redis.pipeline(transaction=False)
        pipe.expire(PRESENCE_KEY.format(user_id=connection.user_id), 90)
        key = USER_CONNECTIONS_KEY.format(user_id=connection.user_id)
        pipe.zadd(key, {connection.id: time.time()})
        pipe.expire(key, 90)
        await pipe.execute()

    async def send(self, connection: Connection, value: dict[str, Any]) -> bool:
        """Send to a local connection, pruning it when its transport is unusable."""
        try:
            await connection.send_json(value)
        except TRANSPORT_ERRORS:
            await self.unregister(connection)
            with contextlib.suppress(*TRANSPORT_ERRORS):
                await connection.websocket.close(code=1011, reason="connection unavailable")
            return False
        return True

    async def _listen(self) -> None:
        async with self.redis.pubsub() as pubsub:
            await pubsub.psubscribe("driver:*", "order:*", "dispatch:*", "realtime:control:*")
            self._ready.set()
            async for message in pubsub.listen():
                if message.get("type") != "pmessage":
                    continue
                channel = str(message["channel"])
                if channel.startswith("realtime:control:"):
                    connection_id = channel.removeprefix("realtime:control:")
                    connection = self._connections_by_id.get(connection_id)
                    if connection is not None:
                        with contextlib.suppress(*TRANSPORT_ERRORS):
                            await connection.websocket.close(
                                code=4408, reason="connection limit exceeded"
                            )
                        await self.unregister(connection)
                    continue
                try:
                    body = json.loads(message["data"])
                except (TypeError, json.JSONDecodeError):
                    logger.warning("realtime.invalid_event", channel=message.get("channel"))
                    continue
                await self._deliver(channel, body)

    async def _deliver(self, channel: str, body: dict[str, Any]) -> None:
        targets = set(self._channels.get(channel, set()))
        if channel.startswith("dispatch:"):
            targets.update(self._channels.get("dispatch:*", set()))
        payload = body.get("payload", {})
        if body.get("type") == "order.status_changed" and payload.get("client_id"):
            try:
                client_id = uuid.UUID(str(payload["client_id"]))
            except ValueError:
                client_id = None
            if client_id is not None:
                client_connections = tuple(self._users.get(client_id, ()))
                targets.update(client_connections)
                try:
                    status = OrderStatus(str(payload.get("status")))
                    order_id = uuid.UUID(str(payload["order_id"]))
                except (KeyError, ValueError):
                    pass
                else:
                    for connection in client_connections:
                        await self._set_order_subscription(
                            connection, order_id, status in ACTIVE_STATUSES
                        )
        for connection in targets:
            await self.send(connection, body)

    async def _set_order_subscription(
        self, connection: Connection, order_id: uuid.UUID, active: bool
    ) -> None:
        channel = f"order:{order_id}"
        if active and channel not in connection.channels:
            async with self._lock:
                connection.channels.add(channel)
                self._channels[channel].add(connection)
            pipe = self.redis.pipeline(transaction=False)
            pipe.sadd(ORDER_CONNECTIONS_KEY.format(order_id=order_id), connection.id)
            pipe.sadd(ACTIVE_ORDERS_KEY, str(order_id))
            await pipe.execute()
        elif not active and channel in connection.channels:
            async with self._lock:
                connection.channels.discard(channel)
                rows = self._channels.get(channel)
                if rows is not None:
                    rows.discard(connection)
                    if not rows:
                        self._channels.pop(channel, None)
            key = ORDER_CONNECTIONS_KEY.format(order_id=order_id)
            await cast(Awaitable[int], self.redis.srem(key, connection.id))
            if not await cast(Awaitable[int], self.redis.scard(key)):
                await cast(Awaitable[int], self.redis.srem(ACTIVE_ORDERS_KEY, str(order_id)))
