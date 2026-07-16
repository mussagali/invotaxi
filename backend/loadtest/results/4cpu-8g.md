# P9 result — 4cpu-8g

- UTC: 2026-07-16T12:04:28+00:00
- Resource profile: **4 vCPU / 8 GiB**
- Duration: **30m** (ramp-up 3m, steady 27m)
- Workload: 250 drivers, 1100 clients, 150 dispatcher requests/min
- k6 exit code: `0`
- Verdict: **PASS**

## Thresholds

| Threshold | Result |
|---|---|
| `dropped_iterations: count==0` | PASS |
| `ws_disconnect_rate: rate<0.01` | PASS |
| `http_req_failed: rate<0.001` | PASS |
| `http_req_duration{persona:dispatcher}: p(95)<300` | PASS |
| `http_req_duration{persona:driver}: p(95)<300` | PASS |
| `http_req_duration{persona:client}: p(95)<300` | PASS |
| `http_req_duration: p(95)<300` | PASS |
| `dispatch_job_success: rate>0.99` | PASS |
| `http_req_duration{persona:dispatch-job}: p(95)<300` | PASS |

## HTTP by persona

| Persona | p95 |
|---|---:|
| driver | 14.0 ms |
| client | 19.0 ms |
| dispatcher | 32.1 ms |
| dispatch-job | 52.7 ms |
| **all HTTP** | **17.7 ms** |

## Throughput and reliability

- HTTP RPS: 72.87
- HTTP error rate: 0.0000%
- WS abnormal disconnect rate: 0.0000%
- Dispatch: status=done, orders=600, duration=5.11 s

## Containers

| Service | Peak RAM | Steady CPU |
|---|---:|---:|
| api | 447.7 MiB | 56.8% |
| worker | 141.5 MiB | 9.9% |
| postgres | 118.7 MiB | 4.0% |
| redis | 8.4 MiB | 4.5% |
