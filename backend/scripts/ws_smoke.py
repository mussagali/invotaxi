"""Connect once to the configured WebSocket; used by deployment smoke checks."""

import asyncio
import os

import websockets


async def main() -> None:
    token = os.environ["WS_TOKEN"]
    url = os.getenv("WS_URL", "ws://localhost:8080/api/v1/ws")
    async with websockets.connect(f"{url}?token={token}") as socket:
        print(f"ws_connected={socket.state.name.lower()}")


if __name__ == "__main__":
    asyncio.run(main())
