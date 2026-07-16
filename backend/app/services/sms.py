"""SMS sending stub. Real OTP/SMS is out of scope (P2 prompt)."""
from typing import Protocol

import structlog

from app.core.security import mask_phone

logger = structlog.get_logger(__name__)


class SmsSender(Protocol):
    async def send(self, phone: str, text: str) -> None: ...


class LoggingSmsSender:
    """Dev stub: logs instead of sending."""

    async def send(self, phone: str, text: str) -> None:
        logger.info("sms.send_stub", phone=mask_phone(phone), length=len(text))
