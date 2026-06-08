import http from "k6/http";
import { check, sleep } from "k6";

const targetUrl = (__ENV.WISEEFF_CAPACITY_TARGET_URL || "").replace(/\/+$/, "");
const authorization = __ENV.WISEEFF_CAPACITY_AUTHORIZATION || "";
const vus = Number(__ENV.WISEEFF_CAPACITY_VUS || "10");
const duration = __ENV.WISEEFF_CAPACITY_DURATION || "2m";

export const options = {
  vus,
  duration,
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<750"]
  }
};

function headers() {
  return authorization ? { Authorization: authorization } : {};
}

export default function wiseEffCapacitySmoke() {
  if (!targetUrl) {
    throw new Error("WISEEFF_CAPACITY_TARGET_URL is required.");
  }

  const live = http.get(`${targetUrl}/health/live`);
  check(live, {
    "live health is 200": (response) => response.status === 200
  });

  const ready = http.get(`${targetUrl}/health/ready`);
  check(ready, {
    "ready health is 200": (response) => response.status === 200
  });

  const me = http.get(`${targetUrl}/api/v1/me`, { headers: headers() });
  check(me, {
    "current user is authorized": (response) => response.status === 200
  });

  const parameters = http.get(`${targetUrl}/api/v1/parameters?projectId=aurora`, { headers: headers() });
  check(parameters, {
    "parameter list is readable": (response) => response.status === 200
  });

  const logs = http.get(`${targetUrl}/api/v1/logs`, { headers: headers() });
  check(logs, {
    "log list is readable": (response) => response.status === 200
  });

  sleep(1);
}
