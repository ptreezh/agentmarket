#!/usr/bin/env node
/* ============================================================================
 * 智能体协同市场 · 脚本签名工具 sign-script.js（D-70）
 * 用法:
 *   node tools/sign-script.js keygen --output <dir>          生成运营者密钥对
 *   node tools/sign-script.js sign <script> --key <priv.pem>  签名脚本
 *   node tools/sign-script.js verify <script> --sig <sig> --pubkey <pub.pem>  验证签名
 *
 * 算法: ED25519（Node crypto 原生支持）
 * 签名格式: detached JSON（join.sh.sig）
 * ========================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------- 工具函数 ----------
function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function fingerprint(pubKey) {
  const der = pubKey.export({ type: "spki", format: "der" });
  return "SHA256:" + crypto.createHash("sha256").update(der).digest("base64");
}

function loadPrivateKey(pemPath) {
  if (!fs.existsSync(pemPath)) {
    console.error(`❌ 私钥文件不存在: ${pemPath}`);
    process.exit(1);
  }
  const pem = fs.readFileSync(pemPath, "utf-8");
  try {
    return crypto.createPrivateKey({ key: pem, format: "pem", type: "pkcs8" });
  } catch (e) {
    console.error(`❌ 私钥解析失败: ${e.message}`);
    process.exit(1);
  }
}

function loadPublicKey(pemPath) {
  if (!fs.existsSync(pemPath)) {
    console.error(`❌ 公钥文件不存在: ${pemPath}`);
    process.exit(1);
  }
  const pem = fs.readFileSync(pemPath, "utf-8");
  try {
    return crypto.createPublicKey({ key: pem, format: "pem", type: "spki" });
  } catch (e) {
    console.error(`❌ 公钥解析失败: ${e.message}`);
    process.exit(1);
  }
}

// ---------- keygen: 生成运营者密钥对 ----------
function cmdKeygen(args) {
  let outputDir = "keys/operator";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) outputDir = args[++i];
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const fp = fingerprint(publicKey);

  const privPath = path.join(outputDir, "private.pem");
  const pubPath = path.join(outputDir, "public.pem");
  fs.writeFileSync(privPath, privPem);
  fs.writeFileSync(pubPath, pubPem);
  fs.chmodSync(privPath, 0o600);

  console.log(`✅ 运营者密钥对已生成`);
  console.log(`   私钥: ${privPath} (0600, 绝不上库, 离线备份)`);
  console.log(`   公钥: ${pubPath}`);
  console.log(`   指纹: ${fp}`);
  console.log(``);
  console.log(`⚠️  下一步:`);
  console.log(`   1. 将 public.pem 复制为仓库根目录 OPERATOR_PUBKEY`);
  console.log(`   2. cp ${pubPath} OPERATOR_PUBKEY`);
  console.log(`   3. 私钥离线安全备份，仅签名时使用`);
}

// ---------- sign: 签名脚本 ----------
function cmdSign(args) {
  const script = args[0];
  let keyPath = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--key" && args[i + 1]) keyPath = args[++i];
  }

  if (!script) {
    console.error("用法: node tools/sign-script.js sign <script> --key <priv.pem>");
    process.exit(2);
  }
  if (!fs.existsSync(script)) {
    console.error(`❌ 脚本文件不存在: ${script}`);
    process.exit(1);
  }
  if (!keyPath) {
    console.error("❌ 必须指定 --key <私钥路径>");
    process.exit(2);
  }

  const privKey = loadPrivateKey(keyPath);
  const pubKey = crypto.createPublicKey(privKey);
  const fp = fingerprint(pubKey);
  const content = fs.readFileSync(script);
  const hash = sha256(content);
  const sig = crypto.sign(null, content, privKey);
  const sigB64 = sig.toString("base64");

  const sigObj = {
    version: 1,
    algorithm: "ed25519",
    signer_fingerprint: fp,
    signed_at: new Date().toISOString(),
    payload_sha256: hash,
    signature: sigB64
  };

  const sigPath = script + ".sig";
  fs.writeFileSync(sigPath, JSON.stringify(sigObj, null, 2) + "\n");

  console.log(`✅ 签名成功: ${script}`);
  console.log(`   签名文件: ${sigPath}`);
  console.log(`   签名者: ${fp}`);
  console.log(`   内容 SHA256: ${hash}`);
  console.log(`   签名时间: ${sigObj.signed_at}`);
}

// ---------- verify: 验证签名 ----------
function cmdVerify(args) {
  const script = args[0];
  let sigPath = null;
  let pubKeyPath = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--sig" && args[i + 1]) sigPath = args[++i];
    if (args[i] === "--pubkey" && args[i + 1]) pubKeyPath = args[++i];
  }

  if (!script) {
    console.error("用法: node tools/sign-script.js verify <script> --sig <sig> --pubkey <pub.pem>");
    process.exit(2);
  }
  if (!fs.existsSync(script)) {
    console.error(`❌ 脚本文件不存在: ${script}`);
    process.exit(1);
  }
  if (!sigPath || !fs.existsSync(sigPath)) {
    console.error(`❌ 签名文件不存在: ${sigPath || "(未指定)"}`);
    process.exit(1);
  }
  if (!pubKeyPath || !fs.existsSync(pubKeyPath)) {
    console.error(`❌ 公钥文件不存在: ${pubKeyPath || "(未指定)"}`);
    process.exit(1);
  }

  const pubKey = loadPublicKey(pubKeyPath);
  const fp = fingerprint(pubKey);
  const content = fs.readFileSync(script);
  const hash = sha256(content);

  let sigObj;
  try {
    sigObj = JSON.parse(fs.readFileSync(sigPath, "utf-8"));
  } catch (e) {
    console.error(`❌ 签名文件解析失败: ${e.message}`);
    process.exit(1);
  }

  // 检查签名者指纹
  if (sigObj.signer_fingerprint !== fp) {
    console.error(`❌ 签名者指纹不匹配`);
    console.error(`   签名文件: ${sigObj.signer_fingerprint}`);
    console.error(`   公钥指纹: ${fp}`);
    process.exit(1);
  }

  // 检查内容 hash
  if (sigObj.payload_sha256 !== hash) {
    console.error(`❌ 内容 SHA256 不匹配（脚本已被篡改）`);
    console.error(`   签名文件: ${sigObj.payload_sha256}`);
    console.error(`   当前脚本: ${hash}`);
    process.exit(1);
  }

  // 验证签名
  const sigBuf = Buffer.from(sigObj.signature, "base64");
  const valid = crypto.verify(null, content, pubKey, sigBuf);

  if (valid) {
    console.log(`✅ 脚本签名验证通过`);
    console.log(`   脚本: ${script}`);
    console.log(`   签名者: ${fp}`);
    console.log(`   签名时间: ${sigObj.signed_at}`);
    console.log(`   内容 SHA256: ${hash}`);
    process.exit(0);
  } else {
    console.error(`❌ 脚本签名验证失败！脚本可能被篡改。`);
    console.error(`   脚本: ${script}`);
    console.error(`   签名者: ${fp}`);
    process.exit(1);
  }
}

// ---------- 主入口 ----------
const [cmd, ...args] = process.argv.slice(2);

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log(`智能体协同市场 · 脚本签名工具（D-70）`);
  console.log(``);
  console.log(`用法:`);
  console.log(`  node tools/sign-script.js keygen --output <dir>`);
  console.log(`  node tools/sign-script.js sign <script> --key <priv.pem>`);
  console.log(`  node tools/sign-script.js verify <script> --sig <sig> --pubkey <pub.pem>`);
  console.log(``);
  console.log(`算法: ED25519 | 签名格式: detached JSON`);
  process.exit(0);
}

switch (cmd) {
  case "keygen": cmdKeygen(args); break;
  case "sign": cmdSign(args); break;
  case "verify": cmdVerify(args); break;
  default:
    console.error(`❌ 未知命令: ${cmd}`);
    console.error(`用法: node tools/sign-script.js keygen|sign|verify`);
    process.exit(2);
}
