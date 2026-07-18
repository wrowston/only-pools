#!/usr/bin/env node
/**
 * Repeatable page-load TTFB bench against a running `next start` server.
 *
 * Metric: curl time_starttransfer (TTFB) for the HTML document.
 * Conditions: warm process, localhost, fixed iterations, discard cold run.
 *
 * Usage:
 *   node scripts/bench-page-load.mjs [--base http://127.0.0.1:3000] [--iters 20] [--threshold 50]
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function arg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const BASE = arg("--base", process.env.BENCH_BASE_URL ?? "http://127.0.0.1:3000");
const ITERS = Number(arg("--iters", process.env.BENCH_ITERS ?? "20"));
const THRESHOLD_MS = Number(arg("--threshold", process.env.BENCH_THRESHOLD_MS ?? "50"));
const LABEL = arg("--label", "bench");
const OUT = arg(
  "--out",
  join(root, "scripts", "bench-results", `${LABEL}-${Date.now()}.json`),
);

/** Every App Router page under app/, with fixture params where needed. */
const PAGES = [
  { path: "/", name: "home" },
  { path: "/guides", name: "guides-index" },
  { path: "/guides/getting-started", name: "guides-getting-started" },
  { path: "/guides/create-a-pool", name: "guides-create-a-pool" },
  { path: "/guides/invites-and-joining", name: "guides-invites" },
  { path: "/guides/members-roles-and-ownership", name: "guides-members" },
  { path: "/guides/archive-audit-and-reports", name: "guides-archive" },
  { path: "/guides/week-board-picks-and-locks", name: "guides-week-board" },
  { path: "/guides/survivor-picks", name: "guides-survivor" },
  { path: "/guides/confidence-picks", name: "guides-confidence" },
  { path: "/guides/standings-and-results", name: "guides-standings" },
  { path: "/guides/pool-rules-and-lifecycle", name: "guides-rules" },
  { path: "/guides/accounts-verification-and-privacy", name: "guides-accounts" },
  { path: "/guides/faq", name: "guides-faq" },
  { path: "/sign-in", name: "sign-in" },
  { path: "/sign-up", name: "sign-up" },
  // Protected shells (unauthenticated → redirect). Still part of the suite.
  { path: "/my-pools", name: "my-pools", allowRedirect: true },
  { path: "/join", name: "join", allowRedirect: true },
  { path: "/join/bench-fixture-token", name: "join-token", allowRedirect: true },
  { path: "/return/bench-fixture-token", name: "return-token", allowRedirect: true },
  { path: "/pools/benchfixture000000000000000", name: "pool-week", allowRedirect: true },
  {
    path: "/pools/benchfixture000000000000000/pool",
    name: "pool-panel",
    allowRedirect: true,
  },
  {
    path: "/pools/benchfixture000000000000000/standings",
    name: "pool-standings",
    allowRedirect: true,
  },
  { path: "/operator", name: "operator", allowRedirect: true },
  {
    path: "/prototype/game-day-flows",
    name: "prototype-game-day",
    allowRedirect: true,
  },
];

function curlOnce(url) {
  const result = spawnSync(
    "curl",
    [
      "-sS",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}\t%{time_starttransfer}\t%{time_total}\t%{num_redirects}",
      "-L",
      "--max-redirs",
      "0",
      "-H",
      "Accept: text/html",
      "-H",
      "Connection: keep-alive",
      url,
    ],
    { encoding: "utf8" },
  );

  // With --max-redirs 0, redirects exit non-zero; still parse -w output.
  const line = (result.stdout || "").trim();
  const [code, ttfb, total, redirects] = line.split("\t");
  if (!code || !ttfb) {
    throw new Error(
      `curl failed for ${url}: ${result.stderr || result.error || "unknown"}`,
    );
  }
  return {
    status: Number(code),
    ttfbMs: Number(ttfb) * 1000,
    totalMs: Number(total) * 1000,
    redirects: Number(redirects),
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0],
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
  };
}

function measurePage(page) {
  const url = `${BASE.replace(/\/$/, "")}${page.path}`;
  // Discard cold sample
  curlOnce(url);
  const samples = [];
  let lastStatus = 0;
  for (let i = 0; i < ITERS; i++) {
    const r = curlOnce(url);
    lastStatus = r.status;
    samples.push(r.ttfbMs);
  }
  const stats = summarize(samples);
  const okStatus =
    lastStatus === 200 ||
    (page.allowRedirect && (lastStatus === 307 || lastStatus === 302 || lastStatus === 303));
  return {
    ...page,
    url,
    status: lastStatus,
    okStatus,
    ...stats,
    pass: okStatus && stats.median <= THRESHOLD_MS,
  };
}

function main() {
  // Health check
  try {
    curlOnce(BASE);
  } catch (e) {
    console.error(`Server not reachable at ${BASE}`);
    console.error(e.message);
    process.exit(2);
  }

  const results = PAGES.map((page) => {
    process.stdout.write(`measuring ${page.path} ... `);
    const r = measurePage(page);
    const mark = r.pass ? "PASS" : "FAIL";
    console.log(
      `${mark} median=${r.median.toFixed(1)}ms p95=${r.p95.toFixed(1)}ms status=${r.status}`,
    );
    return r;
  });

  const failed = results.filter((r) => !r.pass);
  const report = {
    label: LABEL,
    base: BASE,
    iters: ITERS,
    thresholdMs: THRESHOLD_MS,
    measuredAt: new Date().toISOString(),
    metric: "curl time_starttransfer (TTFB), warm, median of N after 1 discard",
    pages: results,
    summary: {
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      slowestMedian: Math.max(...results.map((r) => r.median)),
      slowestPage: results.reduce((a, b) => (a.median >= b.median ? a : b)).path,
    },
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log("\n=== Summary ===");
  console.log(
    `${report.summary.passed}/${report.summary.total} pages median TTFB ≤ ${THRESHOLD_MS}ms`,
  );
  console.log(
    `Slowest: ${report.summary.slowestPage} @ ${report.summary.slowestMedian.toFixed(1)}ms median`,
  );
  console.log(`Wrote ${OUT}`);

  // Markdown table for PR
  console.log("\n| Page | Status | Median ms | p95 ms | Pass |");
  console.log("|---|---:|---:|---:|---|");
  for (const r of results) {
    console.log(
      `| \`${r.path}\` | ${r.status} | ${r.median.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.pass ? "✓" : "✗"} |`,
    );
  }

  process.exit(failed.length ? 1 : 0);
}

main();
