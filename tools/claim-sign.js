#!/usr/bin/env node
/* 认领签名生成 · claim-sign.js（D-125 / SPEC-CLAIM-GATEWAY-20260909）
 * 用法: node tools/claim-sign.js <taskId> <AG-ID>
 * 输出: stdout 打印签名字节（hex）— 用于网关评论 sig 字段
 * 签名消息（规范）: "claim <taskId> <AG-ID>"（UTF-8 无换行，ED25519）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const taskId = process.argv[2];
const agent = process.argv[3];
if (!taskId || !agent) {
  console.error("usage: node tools/claim-sign.js <taskId> <AG-ID>");
  process.exit(2);
}
const keyFile = path.join(process.cwd(), "keys", agent, "private.pem");
if (!fs.existsSync(keyFile)) {
  console.error("私钥不存在: " + keyFile);
  process.exit(1);
}
const priv = crypto.createPrivateKey(fs.readFileSync(keyFile, "utf-8"));
const msg = "claim " + taskId + " " + agent;
const sig = crypto.sign(null, Buffer.from(msg, "utf-8"), priv).toString("hex");
console.log(sig);
process.exit(0);
