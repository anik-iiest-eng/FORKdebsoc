#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const args = new Set(process.argv.slice(2));
const valueFor = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const baseUrl = valueFor("--base-url", process.env.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const concurrency = Math.max(1, Number(valueFor("--concurrency", "10")) || 10);
const requests = Math.max(1, Number(valueFor("--requests", "100")) || 100);
const timeoutMs = Math.max(100, Number(valueFor("--timeout-ms", "5000")) || 5000);
const mutate = args.has("--mutate");

const results = [];

const routes = [
  { name: "public-events", path: "/api/events", expected: [200] },
  { name: "public-history", path: "/api/history", expected: [200] },
  { name: "unauthenticated-event-create", path: "/api/events", method: "POST", body: {}, expected: [401] },
  { name: "unauthenticated-event-update", path: "/api/events/not-a-real-id", method: "PUT", body: {}, expected: [401] },
  { name: "unauthenticated-code-mint", path: "/api/admin/mint-codes", method: "POST", body: {}, expected: [401] },
  { name: "unauthenticated-role-assignment", path: "/api/admin/assign-role", method: "PATCH", body: {}, expected: [401] },
  { name: "public-achievement-privacy-check", path: "/api/achievements/user/not-a-real-id", expected: [200, 401, 403] }
];

const tokenRoutes = [
  { token: process.env.USER_TOKEN, name: "user-admin-events", path: "/api/admin/events", expected: [403] },
  { token: process.env.ORGANIZER_TOKEN, name: "organizer-admin-events", path: "/api/admin/events", expected: [200] },
  { token: process.env.ADMIN_TOKEN, name: "admin-admin-events", path: "/api/admin/events", expected: [200] },
  { token: process.env.ORGANIZER_TOKEN, name: "organizer-role-assignment", path: "/api/admin/assign-role", method: "PATCH", body: {}, expected: [403] },
  { token: process.env.ADMIN_TOKEN, name: "admin-invalid-role", path: "/api/admin/assign-role", method: "PATCH", body: { email: "not-a-real-user@example.invalid", role: "INVALID" }, expected: [400] }
].filter(test => test.token);

const requestOnce = async (test) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  try {
    const headers = {};
    if (test.token) headers.Authorization = `Bearer ${test.token}`;
    if (test.body !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetch(`${baseUrl}${test.path}`, {
      method: test.method || "GET",
      headers,
      body: test.body === undefined ? undefined : JSON.stringify(test.body),
      signal: controller.signal
    });

    const latencyMs = performance.now() - started;
    const passed = test.expected.includes(response.status);
    results.push({ ...test, status: response.status, latencyMs, passed, timeout: false });
  } catch (error) {
    results.push({ ...test, status: 0, latencyMs: performance.now() - started, passed: false, timeout: error.name === "AbortError", error: error.message });
  } finally {
    clearTimeout(timer);
  }
};

const runConcurrent = async (tests, totalRequests) => {
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= totalRequests) return;
      await requestOnce(tests[index % tests.length]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, totalRequests) }, worker));
};

const printSummary = () => {
  const completed = results.length;
  const passed = results.filter(result => result.passed).length;
  const failed = completed - passed;
  const latencies = results.map(result => result.latencyMs).sort((a, b) => a - b);
  const percentile = fraction => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))] || 0;
  const statuses = results.reduce((counts, result) => {
    const key = result.status || (result.timeout ? "TIMEOUT" : "ERROR");
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

  console.log(`\nStress test: ${baseUrl}`);
  console.log(`Requests: ${completed} | concurrency: ${concurrency} | passed: ${passed} | failed: ${failed}`);
  console.log(`Latency ms: p50=${percentile(0.50).toFixed(1)} p95=${percentile(0.95).toFixed(1)} p99=${percentile(0.99).toFixed(1)}`);
  console.log(`Statuses: ${JSON.stringify(statuses)}`);

  const failures = results.filter(result => !result.passed).slice(0, 20);
  if (failures.length) {
    console.log("\nFailures:");
    for (const failure of failures) {
      console.log(`- ${failure.name}: expected ${failure.expected.join("/")}, got ${failure.status || failure.error}`);
    }
  }

  return failed === 0;
};

if (mutate) {
  console.warn("--mutate is reserved for a disposable staging database; this harness keeps the default suite read-only.");
  console.warn("No mutation cases are enabled yet because safe cleanup requires dedicated fixture IDs.");
}

await runConcurrent(routes.concat(tokenRoutes), requests);
process.exitCode = printSummary() ? 0 : 1;
