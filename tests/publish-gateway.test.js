#!/usr/bin/env node
/* TDD 测试：评论发布网关 publish-gateway.js（D-128 / SPEC-COMMENT-PUBLISH-20260909） */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  parsePublishComment,
  extractJsonText,
  verifyPublishSig
} = require("../tools/publish-gateway.js");

/* 辅助：临时 agents 目录 + ed25519 密钥对（agent.md 格式与 claim-gateway 一致） */
function makeTempAgent(id) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pgw-"));
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).replace(/\n/g, "\\n");
  const agentDir = path.join(dir, "agents", id);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "agent.md"),
    "---\nid: " + id + "\n---\npublic_key: " + pubPem + "\n");
  return { dir, privateKey };
}
function signMsg(msg, privateKey) {
  return crypto.sign(null, Buffer.from(msg, "utf-8"), privateKey).toString("hex");
}

/* ---------- 解析 ---------- */

test("[T1] 提取标准 /publish 评论", () => {
  const r = parsePublishComment('/publish {"title":"T","budget":40} agent=AG-TEST sig=abc');
  assert.strictEqual(r.json, '{"title":"T","budget":40}');
  assert.strictEqual(r.agent, "AG-TEST");
  assert.strictEqual(r.sig, "abc");
  assert.strictEqual(r.error, undefined);
});

test("[T2] 嵌套 JSON（assertions 数组）完整提取", () => {
  const body = '/publish {"title":"T","assertions":[{"type":"file_exists","path":"r/1.md"},{"type":"row_count","path":"r/o.csv","op":">","value":0}]} agent=AG-TEST sig=x';
  const r = parsePublishComment(body);
  assert.ok(r.json.startsWith('{"title"'));
  assert.ok(r.json.includes('"row_count"'));
  assert.ok(r.json.endsWith('"value":0}]}'));
  assert.strictEqual(r.agent, "AG-TEST");
});

test("[T3] 字符串内的括号不误切", () => {
  const r = parsePublishComment('/publish {"title":"a } b","desc":"x { y"} agent=AG-TEST sig=x');
  assert.strictEqual(r.json, '{"title":"a } b","desc":"x { y"}');
  assert.strictEqual(r.agent, "AG-TEST");
});

test("[T4] 字符串值含 agent= 不误切", () => {
  const r = parsePublishComment('/publish {"title":"see agent=foo here"} agent=AG-TEST sig=x');
  assert.strictEqual(r.json, '{"title":"see agent=foo here"}');
  assert.strictEqual(r.agent, "AG-TEST");
});

test("[T5] 转义引号处理", () => {
  const r = parsePublishComment('/publish {"desc":"say \\"hi\\" ok"} agent=AG-TEST sig=x');
  assert.strictEqual(r.json, '{"desc":"say \\"hi\\" ok"}');
});

test("[T6] 畸形输入拒绝", () => {
  assert.strictEqual(parsePublishComment("/publish agent=AG-TEST sig=x").error, "missing_json");
  assert.strictEqual(parsePublishComment("/publish {} sig=x").error, "missing_agent");
  assert.strictEqual(parsePublishComment("/publish {} agent=AG-TEST").error, "missing_sig");
  assert.strictEqual(parsePublishComment("no command here").error, "not_publish");
});

test("[T7] 多行/带注释评论（斜杠行首）", () => {
  const body = "Some intro text\n/publish {\"title\":\"T\"} agent=AG-TEST sig=x\n/claim nothing";
  const r = parsePublishComment(body);
  assert.strictEqual(r.json, '{"title":"T"}');
  assert.strictEqual(r.agent, "AG-TEST");
});

/* ---------- extractJsonText 单元 ---------- */

test("[T8] extractJsonText 字符串感知括号匹配", () => {
  const s = '/publish {"a":{"b":1},"c":"}","d":["x","y"]} agent=AG';
  const r = extractJsonText(s);
  assert.strictEqual(r.json, '{"a":{"b":1},"c":"}","d":["x","y"]}');
  assert.ok(r.endIndex > 0);
});

test("[T9] extractJsonText 无 JSON 返回错误", () => {
  assert.strictEqual(extractJsonText("/publish nothing").error, "missing_json");
});

/* ---------- 验签 ---------- */

test("[T10] 验签往返（publish <json> 消息格式）", () => {
  const { dir, privateKey } = makeTempAgent("AG-TEST");
  const json = '{"title":"T","budget":40}';
  const sig = signMsg("publish " + json, privateKey);
  assert.strictEqual(verifyPublishSig(path.join(dir, "agents"), json, "AG-TEST", sig), true);
});

test("[T11] 篡改 payload 验签拒绝", () => {
  const { dir, privateKey } = makeTempAgent("AG-TEST");
  const json = '{"title":"T","budget":40}';
  const sig = signMsg("publish " + json, privateKey);
  assert.strictEqual(verifyPublishSig(path.join(dir, "agents"), '{"title":"T","budget":99}', "AG-TEST", sig), false);
});

test("[T12] 错误消息格式（claim 前缀）验签拒绝", () => {
  const { dir, privateKey } = makeTempAgent("AG-TEST");
  const json = '{"title":"T"}';
  const badSig = signMsg("claim " + json, privateKey);
  assert.strictEqual(verifyPublishSig(path.join(dir, "agents"), json, "AG-TEST", badSig), false);
});

test("[T13] 未注册 agent 拒绝", () => {
  const { dir, privateKey } = makeTempAgent("AG-TEST");
  const json = '{"title":"T"}';
  const sig = signMsg("publish " + json, privateKey);
  assert.strictEqual(verifyPublishSig(path.join(dir, "agents"), json, "AG-NOPE", sig), false);
});

test("[T14] 无效 sig hex 拒绝（不抛异常）", () => {
  const { dir } = makeTempAgent("AG-TEST");
  assert.strictEqual(verifyPublishSig(path.join(dir, "agents"), '{"title":"T"}', "AG-TEST", "zzz-not-hex"), false);
});

test("[T15] 与 claim-sign 消息风格一致性：不同 payload 不同签名", () => {
  const { dir, privateKey } = makeTempAgent("AG-TEST");
  const sig1 = signMsg("publish {\"title\":\"A\"}", privateKey);
  const sig2 = signMsg("publish {\"title\":\"B\"}", privateKey);
  assert.notStrictEqual(sig1, sig2);
  assert.strictEqual(verifyPublishSig(path.join(dir, "agents"), '{"title":"A"}', "AG-TEST", sig1), true);
  assert.strictEqual(verifyPublishSig(path.join(dir, "agents"), '{"title":"A"}', "AG-TEST", sig2), false);
});
