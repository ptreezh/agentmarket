#!/usr/bin/env node
/* tests/recap.test.js — T3 复核工具测试（node:assert，退出码 0=全过）
 * 用例：
 *  1. T-3001 完整签名链 → recap 返回 0 全过
 *  2. 篡改例（settled payment 34→35）→ 返回非 0 且指明守恒失败
 *  3. 无签名例（删除 settled signature 行）→ 返回非 0 且指明签名失败
 *  4. T-3002（settled 无签名，allow-unsigned 测试产物）→ 返回非 0 且指明 settled 失败（预期行为）
 */
"use strict";
const assert = require("assert");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const g = (c) => execSync(c, { encoding: "utf-8", stdio: "pipe" }).trim();

function runRecap(arg) {
  try {
    return { code: 0, out: g(`node tools/recap.js ${arg}`) };
  } catch (e) {
    return { code: e.status ?? 1, out: ((e.stdout || "") + "\n" + (e.stderr || "")).trim() };
  }
}

// 构造破坏例：复制 T-3001 到临时目录
function makeCopy(tag, mutate) {
  const tmp = path.join(process.env.TEMP || "/tmp", `recap-${tag}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(path.join("tasks", "T-3001"), tmp, { recursive: true });
  const evDir = path.join(tmp, "events");
  const settled = fs.readdirSync(evDir).filter((f) => f.startsWith("settled"))[0];
  const sp = path.join(evDir, settled);
  let c = fs.readFileSync(sp, "utf-8");
  c = mutate(c);
  fs.writeFileSync(sp, c, "utf-8");
  return tmp;
}

let failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); }
  else { console.log(`  ❌ ${name} — ${detail}`); failed++; }
}

console.log("T3 recap.test.js");
console.log("用例1: T-3001 应全过（返回 0）");
{
  const r = runRecap("T-3001");
  check("T-3001 退出码 0", r.code === 0, `code=${r.code}\n${r.out}`);
}
console.log("用例2: 篡改 settled payment 34→35 应失败并指明守恒");
{
  const t = makeCopy("tamper", (c) => c.replace("payment: 34", "payment: 35"));
  const r = runRecap(`"${t}"`);
  check("篡改例退出码非0", r.code !== 0, `code=${r.code}`);
  check("指明守恒失败", /守恒|conservation|payment/i.test(r.out), r.out);
}
console.log("用例3: 删除 settled signature 应失败并指明签名");
{
  const t = makeCopy("nosig", (c) => c.replace(/^signature: .*$/m, "signature: "));
  const r = runRecap(`"${t}"`);
  check("无签名例退出码非0", r.code !== 0, `code=${r.code}`);
  check("指明签名失败", /签名|signature|settled/i.test(r.out), r.out);
}
console.log("用例4: T-3002（settled 无签名）应报 settled 失败（预期）");
{
  const r = runRecap("T-3002");
  check("T-3002 退出码非0", r.code !== 0, `code=${r.code}`);
  check("指明 settled 未签名", /settled.*(签名|signature)|签名.*settled/i.test(r.out), r.out);
}

console.log(failed === 0 ? "\n✅ 全部通过" : `\n❌ ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
