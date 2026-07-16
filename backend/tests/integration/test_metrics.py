import httpx
from fastapi import FastAPI


async def test_metrics_endpoint_exposes_base_http_metrics(
    app_with_client: tuple[FastAPI, httpx.AsyncClient],
) -> None:
    _, client = app_with_client

    health = await client.get("/api/v1/health")
    response = await client.get("/metrics")

    assert health.status_code == 200
    assert response.status_code == 200
    assert "http_requests_total" in response.text
    assert "http_request_duration_seconds" in response.text
    assert "http_requests_inprogress" in response.text
