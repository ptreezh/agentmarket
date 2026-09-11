#!/usr/bin/env node
/* 镜像探活 · probe-mirrors.js（A4 / D-92~D-96 验证面）
 * 探测 primary(origin) 与 mirror 的可达性、HEAD、镜像落后程度。
 * 用法: node tools/probe-mirrors.js [--repo <dir>] [--json]
 * 退出码: 0=primary 可达; 1=primary 不可达但 mirror 可达; 2=都不可达; 3=参数错误
 * 无 mirror 时视为 primary-only（退出码只反映 primary）。
 */
"use strict";
const { execSync } = require("child_process");
const path = require("path");
const argv = process.argv.slice(2);

function opt(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
const repo = opt("--repo") || process.cwd();
const asJson = argv.includes("--json");

function probe(remote) {
  if (!remote) return { reachable: false, head: null, error: "no-remote" };
  try {
    const out = execSync(`git ls-remote ${remote} HEAD`, {
      encoding: "utf-8", stdio: "pipe", timeout: 15000, cwd: repo,
    }).trim();
    const head = out.split(/\s+/)[0] || null;
    return { reachable: !!head, head, error: null };
  } catch (e) {
    return { reachable: false, head: null, error: (e.message || "").split("\n")[0].slice(0, 120) };
  }
}

let remoteNames = ["origin"];
try {
  const all = execSync("git remote", { encoding: "utf-8", cwd: repo }).trim().split(/\n/).filter(Boolean);
  if (all.includes("mirror")) remoteNames = ["origin", "mirror"];
} catch { /* 非 git 仓库 → probe 全失败 */ }

const res = { ts: new Date().toISOString(), repo };
for (const n of remoteNames) res[n] = probe(n);
res.mirror_lag = null;
if (res.origin && res.origin.reachable && res.mirror && res.mirror.reachable &&
    res.origin.head && res.mirror.head) {
  res.mirror_lag = res.origin.head === res.mirror.head ? 0 : "behind-or-different";
}

if (asJson) {
  console.log(JSON.stringify(res));
} else {
  const line = (n, r) => r && r.reachable
    ? `  [${n}] OK  HEAD=${(r.head || "").slice(0, 12)}`
    : `  [${n}] DOWN (${r && r.error || "unknown"})`;
  console.log(`probe ${path.basename(repo)} @ ${res.ts}`);
  for (const n of remoteNames) console.log(line(n, res[n]));
  if (res.mirror) {
    console.log(res.mirror_lag === 0 ? "  mirror 与 primary 同步" :
      res.mirror.reachable ? "  mirror 落后于 primary（正常镜像延迟）" : "  mirror 不可达");
  }
}

const primaryOk = res.origin && res.origin.reachable;
const mirrorOk = res.mirror && res.mirror.reachable;
process.exit(primaryOk ? 0 : (mirrorOk ? 1 : 2));
