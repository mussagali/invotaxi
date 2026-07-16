# P9 result — 2cpu-4g

- UTC: 2026-07-16T12:35:49+00:00
- Resource profile: **2 vCPU / 4 GiB**
- Duration: **30m** (ramp-up 3m, steady 27m)
- Workload: 250 drivers, 1100 clients, 150 dispatcher requests/min
- k6 exit code: `99`
- Verdict: **FAIL**

## Thresholds

| Threshold | Result |
|---|---|
| `http_req_duration: p(95)<300` | FAIL |
| `http_req_duration{persona:dispatcher}: p(95)<300` | FAIL |
| `http_req_duration{persona:dispatch-job}: p(95)<300` | FAIL |
| `dispatch_job_success: rate>0.99` | PASS |
| `http_req_duration{persona:client}: p(95)<300` | FAIL |
| `ws_disconnect_rate: rate<0.01` | FAIL |
| `http_req_duration{persona:driver}: p(95)<300` | FAIL |
| `http_req_failed: rate<0.001` | PASS |
| `dropped_iterations: count==0` | PASS |

## HTTP by persona

| Persona | p95 |
|---|---:|
| driver | 7085.5 ms |
| client | 11407.4 ms |
| dispatcher | 14686.2 ms |
| dispatch-job | 545.4 ms |
| **all HTTP** | **9995.0 ms** |

## Throughput and reliability

- HTTP RPS: 69.98
- HTTP error rate: 0.0458%
- WS abnormal disconnect rate: 56.5487%
- Dispatch: status=done, orders=600, duration=9.46 s

## Containers

| Service | Peak RAM | Steady CPU |
|---|---:|---:|
| api | 756.1 MiB | 62.2% |
| worker | 146.7 MiB | 6.5% |
| postgres | 287.4 MiB | 4.8% |
| redis | 8.7 MiB | 4.2% |
