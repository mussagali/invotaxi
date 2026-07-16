"""WebSocket endpoint and application-level heartbeat."""

import asyncio
import contextlib
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.realtime.hub import Connection, RealtimeHub

router = APIRouter()


async def _heartbeat(hub: RealtimeHub, connection: Connection) -> None:
    while True:
        await asyncio.sleep(30)
        if time.monotonic() - connection.last_pong > 60:
            await connection.websocket.close(code=4408, reason="heartbeat timeout")
            return
        if not await hub.send(connection, {"type": "ping"}):
            return
        await hub.refresh_presence(connection)


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    hub: RealtimeHub = websocket.app.state.realtime_hub
    user = await hub.authenticate(websocket.query_params.get("token"))
    if user is None:
        await websocket.close(code=4401, reason="unauthorized")
        return
    await websocket.accept()
    connection = await hub.register(websocket, user)
    heartbeat = asyncio.create_task(_heartbeat(hub, connection))
    try:
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "pong":
                connection.last_pong = time.monotonic()
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        heartbeat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat
        await hub.unregister(connection)
