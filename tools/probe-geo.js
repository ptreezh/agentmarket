#!/usr/bin/env node
/**
 * probe-geo.js — GEO asset health probe for AgentBazaar.
 * Checks live Pages assets (index, llms.txt, robots.txt, sitemap.xml, data.json, favicon).
 * Network-adaptive: if the host is unreachable, reports NETWORK_UNREACHABLE instead of FAIL
 * (mirrors publish-json T20 behavior; avoids false alarms during GitHub CDN/HTTPS hiccups).
 *
 * Usage: node tools/probe-geo.js [--json]
 */
"use strict";
const https = require("https");
const http = require("http");

const BASE = "https://ptreezh.github.io/agentmarket";
const ASSETS = [
  ["index.html", 200],
  ["llms.txt", 200],
  ["robots.txt", 200],
  ["sitemap.xml", 200],
  ["data.json", 200],
  ["favicon.ico", 200],
  ["geo/GEO-AUDIT-REPORT-20260911.html", 200],
  ["geo/how-to-earn-credits-as-ai-agent.html", 200],
  ["geo/agent-marketplace-vs-upwork.html", 200],
];

function probe(url, timeout = 15000) {
  return new Promise((resolve) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers: { "User-Agent": "probe-geo/1.0" }, timeout }, (res) => {
      res.resume();
      resolve({ url, status: res.statusCode, ok: res.statusCode === 200 });
    });
    req.on("timeout", () => { req.destroy(); resolve({ url, status: 0, ok: false, error: "timeout" }); });
    req.on("error", (e) => resolve({ url, status: 0, ok: false, error: e.code || e.message }));
  });
}

(async () => {
  const results = [];
  let networkFault = false;
  for (const [path, expected] of ASSETS) {
    const r = await probe(`${BASE}/${path}`);
    r.path = path;
    r.expected = expected;
    // If any request fails at TCP/DNS level, it is a network fault, not an asset failure
    if (r.error && !networkFault) networkFault = true;
    results.push(r);
  }

  const json = process.argv.includes("--json");
  if (json) {
    console.log(JSON.stringify({ generated_at: new Date().toISOString(), network_fault: networkFault, assets: results }, null, 2));
    process.exit(results.every(r => r.ok) ? 0 : 1);
  }

  const line = "=".repeat(64);
  console.log(line);
  console.log("GEO ASSET HEALTH PROBE — " + new Date().toISOString());
  console.log(line);
  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.error) {
      console.log(`  [NET] ${r.path} — ${r.error}`);
      fail++;
    } else if (r.ok) {
      console.log(`  [OK ] ${r.path} — HTTP ${r.status}`);
      pass++;
    } else {
      console.log(`  [FAIL] ${r.path} — HTTP ${r.status} (expected ${r.expected})`);
      fail++;
    }
  }
  console.log(line);
  console.log(`RESULT: ${pass} OK / ${fail} fail${networkFault ? " (network fault detected — retry later)" : ""}`);
  process.exit(networkFault ? 2 : (fail === 0 ? 0 : 1));
})();
