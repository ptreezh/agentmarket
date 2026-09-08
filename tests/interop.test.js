#!/usr/bin/env node
/* tests/interop.test.js — T4 跨市场互认骨架测试（退出码 0=全过）
 * 场景（本地双市场模拟，临时 operator 密钥，不碰真实 keys/operator）：
 *  1. trust B（信任列表写入）
 *  2. withdraw 10 → B（凭证生成，operator 签名）
 *  3. deposit 凭证 → 入账成功
 *  4. 重复 deposit → 拒绝（seq 唯一防双花）
 *  5. untrust B → 新 withdraw → deposit → 拒绝（信任列表撤销生效）
 *  6. reconcile → 对账输出
 */
"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const g = (c) => execSync(c, { encoding: "utf-8", stdio: "pipe" }).trim();

const TMP = path.join(process.env.TEMP || "/tmp", "interop-test");
const KEY = path.join(TMP, "operator-keys");
const T = (x) => `node tools/interop.js ${x}`;

function run(cmd) {
  try { return { code: 0, out: g(cmd) }; }
  catch (e) { return { code: e.status ?? 1, out: ((e.stdout || "") + "\n" + (e.stderr || "")).trim() }; }
}

let failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); }
  else { console.log(`  ❌ ${name} — ${detail}`); failed++; }
}

(async () => {
  console.log("T4 interop.test.js");

  // 0. 临时 operator 密钥 + 干净环境
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(KEY + ".pem", privateKey.export({ type: "pkcs8", format: "pem" }), "utf-8");
  fs.writeFileSync(KEY + ".pub.pem", publicKey.export({ type: "spki", format: "pem" }), "utf-8");
  fs.rmSync("trusted-markets.json", { force: true });
  fs.rmSync("interop", { recursive: true, force: true });
  const priv = KEY + ".pem", pub = KEY + ".pub.pem";

  // 1. trust B
  let r = run(T(`trust B "${pub}"`));
  check("信任市场 B", r.code === 0 && /信任市场 B/.test(r.out), r.out);

  // 2. withdraw 10 → B
  r = run(T(`withdraw 10 B "${priv}"`));
  check("提现凭证生成", r.code === 0 && /voucher/.test(r.out), r.out);
  const voucher = fs.readdirSync(path.join("interop", "withdrawals", "B"))[0];
  check("凭证文件存在", !!voucher, "无凭证文件");

  // 3. deposit 凭证
  r = run(T(`deposit "${path.join("interop", "withdrawals", "B", voucher).replace(/\\/g, "/")}"`));
  check("入账成功", r.code === 0 && /入账 \+10/.test(r.out), r.out);

  // 4. 重复 deposit 拒绝
  r = run(T(`deposit "${path.join("interop", "withdrawals", "B", voucher).replace(/\\/g, "/")}"`));
  check("重复入账拒绝（防双花）", r.code !== 0 && /重复入账/.test(r.out), r.out);

  // 5. untrust B → 新 withdraw → deposit 拒绝
  r = run(T("untrust B"));
  check("移除信任 B", r.code === 0, r.out);
  r = run(T(`withdraw 5 B "${priv}"`));
  check("撤销后仍可出凭证（凭证签发端自由）", r.code === 0, r.out);
  const v2 = fs.readdirSync(path.join("interop", "withdrawals", "B")).filter(f => f.includes("voucher"))[1];
  r = run(T(`deposit "${path.join("interop", "withdrawals", "B", v2).replace(/\\/g, "/")}"`));
  check("撤销信任后入账拒绝", r.code !== 0 && /不在信任列表/.test(r.out), r.out);

  // 6. 对账
  r = run(T("reconcile"));
  check("对账输出", r.code === 0 && /对账/.test(r.out), r.out);

  // 7. 清理
  fs.rmSync("trusted-markets.json", { force: true });
  fs.rmSync("interop", { recursive: true, force: true });
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(failed === 0 ? "\n✅ 全部通过" : `\n❌ ${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
