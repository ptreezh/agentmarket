#!/usr/bin/env node
/* L1/L2 敏感加密受限体 · crypt.js（零依赖，Node crypto 原生）
 * 加密身份：X25519 ECDH（签名仍用 ED25519，两者分离）。混合加密信封：
 *   受限体明文 → AES-256-GCM（随机密钥）→ content.enc
 *   AES 密钥 → ECDH(requester_x_priv, worker_x_pub) 派生共享密钥 AES-GCM 加密 → keys/<worker>.key.enc
 * 用法:
 *   node tools/crypt.js keygen <agentId>                      # 生成 X25519 密钥对 + agent.md enc_pub
 *   node tools/crypt.js seal <task> <src> <requesterId>       # 加密受限体 + 为 allowlist 各 worker 封信封
 *   node tools/crypt.js grant <task> <requesterId> <workerId> # 新增白名单 worker + 补信封（重签 allowlist）
 *   node tools/crypt.js revoke <task> <requesterId> <workerId># 移除 worker（删信封 + 重签 allowlist）
 *   node tools/crypt.js open <task> <workerId> <requesterId>  # worker 解密受限体（校验 hash）
 *   node tools/crypt.js scan <path>                           # 敏感 pattern 扫描（D-44）
 *   node tools/crypt.js seal-result <task> <src> <workerId> <requesterId>  # 结果用 Requester 公钥加密
 *   node tools/crypt.js open-result <task> <requesterId>      # Requester 解密结果
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const [cmd, ...rest] = process.argv.slice(2);
const AGENT_DIR = "agents";
const KEYS_DIR = "keys";

// ---------- 通用 ----------
function encPubOf(id) {
  const f = path.join(AGENT_DIR, id, "agent.md");
  if (!fs.existsSync(f)) throw new Error("agent 档案不存在: " + id);
  const s = fs.readFileSync(f, "utf-8");
  const m = s.match(/^enc_pub:\s*(\S+)/m);
  if (!m) throw new Error(id + " 无 enc_pub（先 crypt keygen）");
  return Buffer.from(m[1], "base64");
}
function encPrivOf(id) {
  const f = path.join(KEYS_DIR, id, "private-x.pem");
  if (!fs.existsSync(f)) throw new Error("缺加密私钥: " + f);
  return fs.readFileSync(f, "utf-8");
}
function fingerprintOf(id) {
  return fs.readFileSync(path.join(AGENT_DIR, id, "agent.md"), "utf-8").match(/^key_fingerprint:\s*(\S+)/m)[1];
}
function ecdhShared(xPrivPem, peerXPubDer) {
  const myX = crypto.createPrivateKey({ key: xPrivPem, format: "pem", type: "pkcs8" });
  const peer = crypto.createPublicKey({ key: peerXPubDer, format: "der", type: "spki" });
  return crypto.diffieHellman({ privateKey: myX, publicKey: peer }); // 32B 共享密钥
}
function aesEnc(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { iv, ct, tag: c.getAuthTag() };
}
function aesDec(key, iv, ct, tag) {
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}
function signBody(privPem, buf) {
  return crypto.sign(null, buf, crypto.createPrivateKey(privPem)).toString("hex");
}
function signPrivOf(id) {
  return fs.readFileSync(path.join(KEYS_DIR, id, "private.pem"), "utf-8");
}
function writeManifest(task) {
  const dir = path.join("tasks", task, "restricted");
  const man = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf-8"));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(man, null, 2));
  return man;
}
function readManifest(task) {
  return JSON.parse(fs.readFileSync(path.join("tasks", task, "restricted", "manifest.json"), "utf-8"));
}

// ---------- 子命令 ----------
function doKeygen(id) {
  const agentFile = path.join(AGENT_DIR, id, "agent.md");
  if (!fs.existsSync(agentFile)) throw new Error("agent 档案不存在: " + agentFile);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const pubBuf = Buffer.from(publicKey.export({ type: "spki", format: "der" })); // 完整 SPKI DER（44B）
  fs.mkdirSync(path.join(KEYS_DIR, id), { recursive: true });
  fs.writeFileSync(path.join(KEYS_DIR, id, "private-x.pem"), privPem);
  fs.chmodSync(path.join(KEYS_DIR, id, "private-x.pem"), 0o600);
  let t = fs.readFileSync(agentFile, "utf-8");
  t = t.replace(/^enc_pub:.*$/m, `enc_pub: ${pubBuf.toString("base64")}`);
  if (!/^enc_pub:/m.test(t)) t += `enc_pub: ${pubBuf.toString("base64")}\n`;
  fs.writeFileSync(agentFile, t);
  console.log(`✅ ${id} X25519 加密密钥已生成 (enc_pub=${pubBuf.toString("base64").slice(0, 16)}…，已写 agent.md)`);
}

function doSeal(task, src, requesterId) {
  const rdir = path.join("tasks", task, "restricted");
  fs.mkdirSync(path.join(rdir, "keys"), { recursive: true });
  const plain = fs.readFileSync(src);
  const akey = crypto.randomBytes(32);
  const { iv, ct, tag } = aesEnc(akey, plain);
  fs.writeFileSync(path.join(rdir, "content.enc"), Buffer.concat([iv, tag, ct]));
  const reqPriv = encPrivOf(requesterId);
  const manPath = path.join(rdir, "manifest.json");
  const man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, "utf-8")) : { task, requester: requesterId, workers: [], alg: "X25519+AES-256-GCM", created: new Date().toISOString() };
  // Requester 始终自持信封（grant/revoke 重封时需取回 AES 密钥）
  if (!man.workers.includes(requesterId)) man.workers.push(requesterId);
  const workers = [];
  for (const w of man.workers) {
    const sh = ecdhShared(reqPriv, encPubOf(w));
    const env = aesEnc(sh, akey);
    fs.writeFileSync(path.join(rdir, "keys", w + ".key.enc"), Buffer.concat([env.iv, env.tag, env.ct]));
    workers.push(w);
  }
  man.hash = crypto.createHash("sha256").update(plain).digest("hex");
  man.workers = workers;
  fs.writeFileSync(manPath, JSON.stringify(man, null, 2));
  writeAllowlist(task, requesterId, man.workers);
  console.log(`✅ ${task} 受限体已加密 (${plain.length}B → content.enc)`);
  console.log(`   workers=${man.workers.length ? man.workers.join(",") : "(仅 Requester)"} · sha256=${man.hash.slice(0, 16)}…`);
  return man.hash;
}

function writeAllowlist(task, requesterId, workers) {
  const dir = path.join("tasks", task, "restricted");
  const fp = fingerprintOf(requesterId);
  const body = workers.map(w => `${w} ${fingerprintOf(w)}`).join("\n") + "\n";
  const sig = signBody(signPrivOf(requesterId), Buffer.from(body, "utf-8"));
  fs.writeFileSync(path.join(dir, "allowlist.md"),
    `---\nkind: allowlist\ntask: ${task}\nrequester: ${requesterId}\nsigner: ${fp}\nsignature: ${sig}\n---\n${body}`);
}

function doGrant(task, requesterId, workerId) {
  const man = readManifest(task);
  if (man.requester !== requesterId) throw new Error("非 Requester 无权授权");
  if (man.workers.includes(workerId)) { console.log(`${workerId} 已在白名单`); return; }
  man.workers.push(workerId);
  const sh = ecdhShared(encPrivOf(requesterId), encPubOf(workerId));
  const akey = openContentKey(task, requesterId); // 用 Requester 自己取回 AES 密钥（Requester 有全部信封？）
  const env = aesEnc(sh, akey);
  fs.mkdirSync(path.join("tasks", task, "restricted", "keys"), { recursive: true });
  fs.writeFileSync(path.join("tasks", task, "restricted", "keys", workerId + ".key.enc"), Buffer.concat([env.iv, env.tag, env.ct]));
  writeAllowlist(task, requesterId, man.workers);
  writeManifest(task);
  console.log(`✅ ${workerId} 已加入 ${task} 白名单（信封已补，allowlist 已重签）`);
}
// Requester 自持 AES 密钥：简化实现——Requester 也有自己的信封（doSeal 时 workers 含 requester？）
function openContentKey(task, requesterId) {
  // 重新从 Requester 的信封解出 AES 密钥；若无 requester 信封，则从任一 worker 信封无法（无其私钥）
  // 方案：seal 时始终把 requester 也当 worker 封一封（requester 私钥可解自己的信封）
  const man = readManifest(task);
  if (man.workers.includes(requesterId)) {
    const envBuf = fs.readFileSync(path.join("tasks", task, "restricted", "keys", requesterId + ".key.enc"));
    const iv = envBuf.subarray(0, 12), tag = envBuf.subarray(12, 28), ct = envBuf.subarray(28);
    const sh = ecdhShared(encPrivOf(requesterId), encPubOf(requesterId));
    return aesDec(sh, iv, ct, tag);
  }
  throw new Error("Requester 无自持信封（seal 时需把 requester 纳入 workers）");
}

function doRevoke(task, requesterId, workerId) {
  const man = readManifest(task);
  if (man.requester !== requesterId) throw new Error("非 Requester 无权撤销");
  man.workers = man.workers.filter(w => w !== workerId);
  const f = path.join("tasks", task, "restricted", "keys", workerId + ".key.enc");
  if (fs.existsSync(f)) fs.unlinkSync(f);
  writeAllowlist(task, requesterId, man.workers);
  writeManifest(task);
  console.log(`✅ ${workerId} 已从 ${task} 白名单撤销（信封删除 + allowlist 重签）`);
}

function doOpen(task, workerId, requesterId) {
  const rdir = path.join("tasks", task, "restricted");
  const man = readManifest(task);
  if (man.requester !== requesterId) throw new Error("requester 不匹配");
  const envFile = path.join(rdir, "keys", workerId + ".key.enc");
  if (!fs.existsSync(envFile)) throw new Error(`✗ ${workerId} 无密钥信封（不在白名单或已被撤销）`);
  const envBuf = fs.readFileSync(envFile);
  const sh = ecdhShared(encPrivOf(workerId), encPubOf(requesterId));
  const akey = aesDec(sh, envBuf.subarray(0, 12), envBuf.subarray(28), envBuf.subarray(12, 28));
  const content = fs.readFileSync(path.join(rdir, "content.enc"));
  const plain = aesDec(akey, content.subarray(0, 12), content.subarray(28), content.subarray(12, 28));
  const h = crypto.createHash("sha256").update(plain).digest("hex");
  if (h !== man.hash) throw new Error("✗ 受限体 hash 校验失败（内容被篡改）");
  console.log(`✅ ${workerId} 解密 ${task} 受限体成功（sha256=${h.slice(0, 16)}… 与 manifest 一致）`);
  return plain;
}

const SENSITIVE = [
  { name: "身份证", re: /\b\d{17}[\dXx]\b/ },
  { name: "手机号", re: /\b1[3-9]\d{9}\b/ },
  { name: "疑似密码/密钥", re: /(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S+/i },
  { name: "银行卡", re: /\b\d{16,19}\b/ },
];
function doScan(target) {
  const hits = [];
  const walk = p => {
    if (!fs.existsSync(p)) return;
    if (fs.statSync(p).isDirectory()) { for (const e of fs.readdirSync(p)) walk(path.join(p, e)); return; }
    if (!/\.(md|txt|json|csv|js)$/.test(p)) return;
    const s = fs.readFileSync(p, "utf-8");
    for (const r of SENSITIVE) { if (r.re.test(s)) hits.push({ file: p, type: r.name }); }
  };
  walk(target);
  if (!hits.length) { console.log(`✅ 扫描无命中：${target}`); return 0; }
  for (const h of hits) console.log(`⚠ 命中[${h.type}]: ${h.file}`);
  console.log(`✗ ${hits.length} 处敏感 pattern——明文禁止入 git（D-44），请脱敏或加密外置`);
  return 1;
}

function doSealResult(task, src, workerId, requesterId) {
  const rdir = path.join("tasks", task, "restricted");
  fs.mkdirSync(rdir, { recursive: true });
  const plain = fs.readFileSync(src);
  const akey = crypto.randomBytes(32);
  const { iv, ct, tag } = aesEnc(akey, plain);
  const sh = ecdhShared(encPrivOf(workerId), encPubOf(requesterId));
  const env = aesEnc(sh, akey);
  fs.writeFileSync(path.join(rdir, "result.enc"), Buffer.concat([iv, tag, ct]));
  fs.writeFileSync(path.join(rdir, "result.key.enc"), Buffer.concat([env.iv, env.tag, env.ct]));
  const h = crypto.createHash("sha256").update(plain).digest("hex");
  fs.writeFileSync(path.join(rdir, "result.manifest.json"), JSON.stringify({ task, worker: workerId, requester: requesterId, hash: h, ts: new Date().toISOString() }, null, 2));
  console.log(`✅ 结果已用 Requester 公钥加密交付（result.enc，sha256=${h.slice(0, 16)}…，明文不进 git）`);
  return h;
}

function doOpenResult(task, requesterId) {
  const rdir = path.join("tasks", task, "restricted");
  const rm = JSON.parse(fs.readFileSync(path.join(rdir, "result.manifest.json"), "utf-8"));
  if (rm.requester !== requesterId) throw new Error("requester 不匹配");
  const envBuf = fs.readFileSync(path.join(rdir, "result.key.enc"));
  const sh = ecdhShared(encPrivOf(requesterId), encPubOf(rm.worker));
  const akey = aesDec(sh, envBuf.subarray(0, 12), envBuf.subarray(28), envBuf.subarray(12, 28));
  const content = fs.readFileSync(path.join(rdir, "result.enc"));
  const plain = aesDec(akey, content.subarray(0, 12), content.subarray(28), content.subarray(12, 28));
  const h = crypto.createHash("sha256").update(plain).digest("hex");
  if (h !== rm.hash) throw new Error("✗ 结果 hash 校验失败");
  console.log(`✅ ${requesterId} 解密结果成功（sha256=${h.slice(0, 16)}…）`);
  return plain;
}

// ---------- 入口 ----------
try {
  switch (cmd) {
    case "keygen": doKeygen(rest[0]); break;
    case "seal": doSeal(rest[0], rest[1], rest[2]); break;
    case "grant": doGrant(rest[0], rest[1], rest[2]); break;
    case "revoke": doRevoke(rest[0], rest[1], rest[2]); break;
    case "open": {
      const plain = doOpen(rest[0], rest[1], rest[2]);
      process.stdout.write(plain.toString("utf-8"));
      break;
    }
    case "scan": process.exit(doScan(rest[0])); break;
    case "seal-result": doSealResult(rest[0], rest[1], rest[2], rest[3]); break;
    case "open-result": process.stdout.write(doOpenResult(rest[0], rest[1]).toString("utf-8")); break;
    default:
      console.log("用法: crypt.js keygen|seal|grant|revoke|open|scan|seal-result|open-result");
      process.exit(2);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
