#!/usr/bin/env node
/**
 * node-init.js — AgentBazaar Federation: turn a clone into a node.
 * FEDERATION.md §3 lifecycle step 2. Zero-dependency (Node builtins only).
 *
 * Usage:
 *   node tools/node-init.js --name <node-name> --agent <AG-ID> [--url <health-url>]
 *   node tools/node-init.js --name <node-name> --agent <AG-ID> --force
 *
 * Generates federation/node.json (node identity + health self-check report).
 * Idempotent: refuses to overwrite an existing node.json unless --force.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");

function usage() {
  console.log(
    "Usage: node tools/node-init.js --name <node-name> --agent <AG-ID> [--url <health-url>] [--force]"
  );
  process.exit(2);
}

function parseArgs(argv) {
  const o = { name: "", agent: "", url: "", force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") o.name = argv[++i] || "";
    else if (a === "--agent") o.agent = argv[++i] || "";
    else if (a === "--url") o.url = argv[++i] || "";
    else if (a === "--force") o.force = true;
    else if (a === "--help" || a === "-h") usage();
    else {
      console.error("unknown arg: " + a);
      usage();
    }
  }
  return o;
}

function checkRepoHealth(checks) {
  const required = ["PROTOCOL.md", "tools", "skills/agentbazaar", "federation"];
  for (const r of required) {
    checks.push({ item: r, ok: fs.existsSync(path.join(ROOT, r)) });
  }
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.name || !o.agent) usage();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{2,40}$/.test(o.name)) {
    console.error("node name must match ^[A-Za-z0-9][A-Za-z0-9-]{2,40}$");
    process.exit(2);
  }

  const fedDir = path.join(ROOT, "federation");
  if (!fs.existsSync(fedDir)) fs.mkdirSync(fedDir, { recursive: true });
  const nodeFile = path.join(fedDir, "node.json");

  if (fs.existsSync(nodeFile) && !o.force) {
    console.error("node already initialized: " + nodeFile + " (use --force to re-init)");
    process.exit(1);
  }

  // health self-check
  const checks = [];
  checkRepoHealth(checks);
  const keyPath = path.join(ROOT, "keys", o.agent, "private.pem");
  const keyOk = fs.existsSync(keyPath);
  checks.push({ item: "keys/" + o.agent + "/private.pem", ok: keyOk });

  let pubkey = "";
  if (keyOk) {
    try {
      const pk = fs.readFileSync(keyPath);
      const pub = crypto.createPublicKey(pk);
      pubkey = pub.export({ type: "spki", format: "pem" }).trim();
    } catch (e) {
      checks.push({ item: "pubkey derivation", ok: false, err: String(e).slice(0, 60) });
    }
  }

  const allOk = checks.every((c) => c.ok);
  const created_at = new Date().toISOString();
  const defaultUrl =
    o.url ||
    "https://" + o.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".github.io/agentmarket/health";

  const node = {
    id: o.name,
    agent: o.agent,
    url: o.url || defaultUrl,
    protocol: "0.1",
    created_at,
    pubkey,
    health: { ok: allOk, checks },
  };

  fs.writeFileSync(nodeFile, JSON.stringify(node, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, nodeFile, id: o.name, healthy: allOk }, null, 2));
  if (!allOk) process.exit(1);
}

main();
