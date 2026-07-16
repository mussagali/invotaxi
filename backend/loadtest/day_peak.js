import exec from 'k6/execution';
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://api:8000';
const WS_URL = __ENV.WS_URL || 'ws://api:8000';
const PASSWORD = __ENV.SEED_USER_PASSWORD || '';
const SMOKE_VUS = Number.parseInt(__ENV.VUS || '0', 10);
const DRIVER_VUS = Number.parseInt(
  __ENV.DRIVERS_VU || (SMOKE_VUS ? String(Math.max(1, Math.floor(SMOKE_VUS * 0.2))) : '250'),
  10,
);
const CLIENT_VUS = Number.parseInt(
  __ENV.CLIENTS_VU || (SMOKE_VUS ? String(Math.max(1, SMOKE_VUS - DRIVER_VUS - 1)) : '1100'),
  10,
);
const DISPATCHER_RPM = Number.parseInt(
  __ENV.DISPATCHER_RPM || (SMOKE_VUS ? '0' : '150'),
  10,
);
const LOGIN_ACCOUNT_POOL = Number.parseInt(__ENV.LOGIN_ACCOUNT_POOL || '2000', 10);
const RAMP_DURATION = __ENV.RAMP_DURATION || (SMOKE_VUS ? '3s' : '3m');
const STEADY_DURATION = __ENV.STEADY_DURATION || (SMOKE_VUS ? '20s' : '27m');
const TEST_DURATION = __ENV.TEST_DURATION || (SMOKE_VUS ? '23s' : '30m');
const DISPATCH_DELAY = __ENV.DISPATCH_DELAY || (SMOKE_VUS ? '10s' : '10m');
const DISPATCH_MAX_DURATION = __ENV.DISPATCH_MAX_DURATION || (SMOKE_VUS ? '30s' : '20m');
const DATASET = __ENV.DATASET || (SMOKE_VUS ? 'dev' : 'load');

const wsDisconnectRate = new Rate('ws_disconnect_rate');
const dispatchJobSuccess = new Rate('dispatch_job_success');
const dispatchJobDuration = new Trend('dispatch_job_duration', true);

function durationMs(value) {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value);
  if (!match) throw new Error(`unsupported duration: ${value}`);
  const factors = { ms: 1, s: 1000, m: 60000, h: 3600000 };
  return Number.parseInt(match[1], 10) * factors[match[2]];
}

const scenarios = {
  drivers: {
    executor: 'ramping-vus',
    exec: 'driver',
    startVUs: 0,
    stages: [
      { duration: RAMP_DURATION, target: DRIVER_VUS },
      { duration: STEADY_DURATION, target: DRIVER_VUS },
    ],
    gracefulRampDown: '10s',
    gracefulStop: '10s',
    tags: { persona: 'driver' },
  },
  clients: {
    executor: 'ramping-vus',
    exec: 'client',
    startVUs: 0,
    stages: [
      { duration: RAMP_DURATION, target: CLIENT_VUS },
      { duration: STEADY_DURATION, target: CLIENT_VUS },
    ],
    gracefulRampDown: '10s',
    gracefulStop: '10s',
    tags: { persona: 'client' },
  },
};

const thresholds = {
  http_req_duration: ['p(95)<300'],
  http_req_failed: ['rate<0.001'],
  dropped_iterations: ['count==0'],
  ws_disconnect_rate: ['rate<0.01'],
  'http_req_duration{persona:driver}': ['p(95)<300'],
  'http_req_duration{persona:client}': ['p(95)<300'],
};

if (DISPATCHER_RPM > 0) {
  scenarios.dispatcher = {
    executor: 'constant-arrival-rate',
    exec: 'dispatcher',
    rate: DISPATCHER_RPM,
    timeUnit: '1m',
    duration: TEST_DURATION,
    preAllocatedVUs: 150,
    maxVUs: 150,
    tags: { persona: 'dispatcher' },
  };
  scenarios.dispatchJob = {
    executor: 'per-vu-iterations',
    exec: 'startDispatch',
    vus: 1,
    iterations: 1,
    startTime: DISPATCH_DELAY,
    maxDuration: DISPATCH_MAX_DURATION,
    tags: { persona: 'dispatch-job' },
  };
  thresholds['http_req_duration{persona:dispatcher}'] = ['p(95)<300'];
  thresholds['http_req_duration{persona:dispatch-job}'] = ['p(95)<300'];
  thresholds.dispatch_job_success = ['rate>0.99'];
}

export const options = { scenarios, thresholds };

let accessToken = '';
let refreshToken = '';
let refreshAt = 0;

function driverPhone(index) {
  return DATASET === 'dev'
    ? `701${String((index % 20) + 1).padStart(7, '0')}`
    : `7048${String((index % LOGIN_ACCOUNT_POOL) + 1).padStart(6, '0')}`;
}

function clientPhone(index) {
  return DATASET === 'dev'
    ? `702${String((index % 60) + 1).padStart(7, '0')}`
    : `7049${String((index % LOGIN_ACCOUNT_POOL) + 1).padStart(6, '0')}`;
}

function dispatcherPhone(index) {
  return `7047${String((index % LOGIN_ACCOUNT_POOL) + 1).padStart(6, '0')}`;
}

function login(phone) {
  if (accessToken) return currentToken();
  const response = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ phone, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /auth/login' } },
  );
  const ok = check(response, { 'login succeeds': (r) => r.status === 200 });
  if (!ok) {
    // A failed VU must not turn into an artificial tight-loop auth flood.
    sleep(1);
    return '';
  }
  accessToken = response.json('tokens.access_token');
  refreshToken = response.json('tokens.refresh_token');
  refreshAt = Date.now() + 12 * 60 * 1000;
  return accessToken;
}

export function setup() {
  const token = login('7047999999');
  if (!token) throw new Error('dispatch user login failed during setup');
  return {
    dispatchAuth: {
      accessToken,
      refreshToken,
      refreshAt,
    },
  };
}

function currentToken() {
  if (!accessToken || Date.now() < refreshAt) return accessToken;
  const response = http.post(
    `${BASE_URL}/api/v1/auth/refresh`,
    JSON.stringify({ refresh_token: refreshToken }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /auth/refresh' } },
  );
  const ok = check(response, { 'token refresh succeeds': (r) => r.status === 200 });
  if (!ok) return accessToken;
  accessToken = response.json('access_token');
  refreshToken = response.json('refresh_token');
  refreshAt = Date.now() + 12 * 60 * 1000;
  return accessToken;
}

function authParams(token, name) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    tags: { name },
  };
}

function openSocket(token, onOpen) {
  const isTeardown = () => (
    exec.instance.currentTestRunDuration >= durationMs(TEST_DURATION) - 5000
  );
  const response = ws.connect(`${WS_URL}/api/v1/ws?token=${token}`, {}, (socket) => {
    socket.on('open', () => {
      wsDisconnectRate.add(false);
      onOpen(socket);
    });
    socket.on('message', (message) => {
      try {
        if (JSON.parse(message).type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
      } catch (_) {
        // The application protocol only requires pong for a JSON ping.
      }
    });
    socket.on('close', (code) => {
      if (!isTeardown()) wsDisconnectRate.add(code !== 1000 && code !== 1001);
    });
    socket.on('error', () => {
      if (!isTeardown()) wsDisconnectRate.add(true);
    });
  });
  const upgraded = check(response, {
    'websocket upgrade succeeds': (r) => r && r.status === 101,
  });
  if (!upgraded) wsDisconnectRate.add(true);
}

export function driver() {
  const token = login(driverPhone(exec.vu.idInTest - 1));
  if (!token) return;
  openSocket(token, (socket) => {
    const sendLocation = () => {
      const payload = {
        lat: 47.10 + Math.random() * 0.02,
        lon: 51.88 + Math.random() * 0.02,
        ts: new Date().toISOString(),
        accuracy_m: 1 + Math.random() * 3,
        speed: 30,
        heading: Math.random() * 359,
      };
      const response = http.post(
        `${BASE_URL}/api/v1/drivers/me/location`,
        JSON.stringify(payload),
        authParams(currentToken(), 'POST /drivers/me/location'),
      );
      check(response, { 'GPS accepted': (r) => r.status === 200 });
    };
    sendLocation();
    socket.setInterval(sendLocation, 7000);
  });
}

function serviceDate(daysAhead) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + daysAhead);
  return value.toISOString().slice(0, 10);
}

export function client() {
  const token = login(clientPhone(exec.vu.idInTest - 1));
  if (!token) return;
  openSocket(token, (socket) => {
    if (Math.random() < 0.05) {
      const minute = Math.floor(Math.random() * 60).toString().padStart(2, '0');
      const response = http.post(
        `${BASE_URL}/api/v1/orders`,
        JSON.stringify({
          service_date: serviceDate(2),
          desired_time: `12:${minute}:00`,
          pickup_addr: 'Атырау, нагрузочный pickup',
          pickup_lat: 47.105,
          pickup_lon: 51.89,
          dropoff_addr: 'Атырау, нагрузочный dropoff',
          dropoff_lat: 47.115,
          dropoff_lon: 51.91,
          escort: false,
        }),
        authParams(currentToken(), 'POST /orders'),
      );
      check(response, { 'order create succeeds': (r) => r.status === 201 });
    }

    const readStatus = () => {
      const list = http.get(
        `${BASE_URL}/api/v1/orders?limit=4`,
        authParams(currentToken(), 'GET /orders'),
      );
      if (!check(list, { 'order list succeeds': (r) => r.status === 200 })) return;
      const orders = list.json();
      if (orders.length > 0) {
        const response = http.get(
          `${BASE_URL}/api/v1/orders/${orders[0].id}`,
          authParams(currentToken(), 'GET /orders/:id'),
        );
        check(response, { 'order status succeeds': (r) => r.status === 200 });
      }
    };
    readStatus();
    socket.setInterval(readStatus, 30000 + Math.floor(Math.random() * 30001));
  });
}

export function dispatcher() {
  const token = login(dispatcherPhone(exec.vu.idInTest - 1));
  if (!token) return;
  const paths = [
    '/api/v1/orders?limit=100',
    `/api/v1/plans?date=${serviceDate(1)}&district=${encodeURIComponent('Центр')}`,
    `/api/v1/drivers/live?district=${encodeURIComponent('Центр')}`,
  ];
  const path = paths[exec.scenario.iterationInTest % paths.length];
  const response = http.get(
    `${BASE_URL}${path}`,
    authParams(currentToken(), `GET ${path.split('?')[0]}`),
  );
  check(response, { 'dispatcher request succeeds': (r) => r.status === 200 });
}

export function startDispatch(data) {
  // The token is acquired before ramp-up, so the job is not skipped merely
  // because the API is saturated at the exact ten-minute boundary.
  accessToken = data.dispatchAuth.accessToken;
  refreshToken = data.dispatchAuth.refreshToken;
  refreshAt = data.dispatchAuth.refreshAt;
  const token = currentToken();
  const started = Date.now();
  const response = http.post(
    `${BASE_URL}/api/v1/dispatch/jobs`,
    JSON.stringify({ service_date: serviceDate(1), district: 'Центр' }),
    authParams(currentToken(), 'POST /dispatch/jobs'),
  );
  if (!check(response, { 'dispatch job queued': (r) => r.status === 202 })) {
    dispatchJobSuccess.add(false);
    return;
  }

  const jobId = response.json('job_id');
  const pollingDeadline = started + durationMs(DISPATCH_MAX_DURATION) - 5000;
  while (Date.now() < pollingDeadline) {
    sleep(2);
    const status = http.get(
      `${BASE_URL}/api/v1/dispatch/jobs/${jobId}`,
      authParams(currentToken(), 'GET /dispatch/jobs/:id'),
    );
    if (!check(status, { 'dispatch status succeeds': (r) => r.status === 200 })) continue;
    const state = status.json('status');
    if (state === 'done' || state === 'failed') {
      dispatchJobDuration.add(Date.now() - started);
      dispatchJobSuccess.add(state === 'done');
      check(status, { 'dispatch job completed': () => state === 'done' });
      return;
    }
  }
  dispatchJobDuration.add(Date.now() - started);
  dispatchJobSuccess.add(false);
  check(response, { 'dispatch job completed': () => false });
}
