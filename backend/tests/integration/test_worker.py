from arq import Worker
from arq.connections import RedisSettings, create_pool
from testcontainers.redis import RedisContainer

from app.workers.main import ping_task


async def test_ping_task_through_arq(redis_container: RedisContainer) -> None:
    redis_settings = RedisSettings(
        host=redis_container.get_container_host_ip(),
        port=int(redis_container.get_exposed_port(6379)),
    )

    pool = await create_pool(redis_settings)
    try:
        job = await pool.enqueue_job("ping_task")
        assert job is not None

        worker = Worker(
            functions=[ping_task],
            redis_settings=redis_settings,
            burst=True,
            poll_delay=0.1,
        )
        try:
            await worker.main()
        finally:
            await worker.close()

        result = await job.result(timeout=5)
        assert result == "pong"
    finally:
        await pool.aclose()
