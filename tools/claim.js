#!/usr/bin/env node
/* 并发安全认领 · claim.js — 先到先得（D-29/D-47）
 * 用法: node tools/claim.js <taskId> <worker>
 * 流程: 检查已认领→写事件→本地提交→pull --rebase 合并中央→复查他人认领→放弃或 push
 * 退出码: 0=认领成功 1=已被他人认领（放弃） 2=用法错误
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const [taskId, worker] = process.argv.slice(2);
if (!taskId || !worker) { console.error("usage: node tools/claim.js <taskId> <worker>"); process.exit(2); }
const taskDir = path.join("tasks", taskId);
if (!fs.existsSync(path.join(taskDir, "spec.md"))) { console.error("任务不存在: " + taskDir); process.exit(2); }

const evDir = path.join(taskDir, "events");
if (!fs.existsSync(evDir)) fs.mkdirSync(evDir, { recursive: true });
const existing = fs.readdirSync(evDir).filter(f => f.startsWith("claimed-"));
const g = (c) => execSync(c, { encoding: "utf-8" }).trim();
const whoClaimed = (list) => list.map(f => {
  const m = fs.readFileSync(path.join(evDir, f), "utf-8").match(/worker:\s*(\S+)/);
  return m ? m[1] : "?";
});

// 1. 本地/当前是否已被认领
let owners = whoClaimed(existing);
if (owners.some(o => o && o !== worker)) { console.log(`[${worker}] 已被他人认领(${owners.join(",")}) → 放弃`); process.exit(1); }

// 2. 写自己的认领事件（唯一文件名：时间戳+worker）
const ts = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
const fname = `claimed-${ts}-${worker}.md`;
fs.writeFileSync(path.join(evDir, fname),
  `---\nevent: claimed\ntask: ${taskId}\nworker: ${worker}\nop_id: ${fname.replace(/\.md$/, "")}\nts: ${new Date().toISOString()}\n---\n${worker} 认领 ${taskId}。\n`);

// 3. 本地提交
g(`git add tasks/${taskId}/events/${fname}`);
g(`git commit -q -m "claim ${taskId} by ${worker}"`);

// 4. 拉取中央最新（增量，拒全量轮询）
try { g("git pull --rebase origin main"); } catch (e) { /* rebase 可能失败，继续复查 */ }

// 5. 复查：合并后若存在他人认领且先于自己 → 放弃（reset 本地，保持中央一致）
owners = whoClaimed(fs.readdirSync(evDir).filter(f => f.startsWith("claimed-")));
const others = owners.filter(o => o && o !== worker);
if (others.length) {
  g("git reset --hard origin/main");
  console.log(`[${worker}] 合并中央后发现已被他人认领(${others.join(",")}) → 已回滚并放弃`);
  process.exit(1);
}

// 6. push（若被拒=他人先 push，进入冲突路径自愈）
try {
  g("git push origin HEAD:main");
  console.log(`[${worker}] ✅ 认领成功 ${taskId}（events/${fname}）`);
  process.exit(0);
} catch (e) {
  try { g("git pull --rebase origin main"); } catch (_) {}
  owners = whoClaimed(fs.readdirSync(evDir).filter(f => f.startsWith("claimed-")));
  if (owners.some(o => o && o !== worker)) {
    g("git reset --hard origin/main");
    console.log(`[${worker}] push 冲突后确认他人已认领 → 已回滚并放弃`);
    process.exit(1);
  }
  g("git push origin HEAD:main");
  console.log(`[${worker}] ✅ 冲突重试后认领成功`);
  process.exit(0);
}
