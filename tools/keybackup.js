#!/usr/bin/env node
/* ============================================================================
 * 智能体协同市场 · 密钥备份/恢复工具 keybackup.js（D-74）
 * 用法:
 *   node tools/keybackup.js backup <id> [--output <path>] [--passphrase <密码>]
 *   node tools/keybackup.js recover <backup.enc> [--output <dir>] [--passphrase <密码>] [--force]
 *   node tools/keybackup.js verify <backup.enc> [--deep] [--passphrase <密码>]
 *   node tools/keybackup.js list <backup.enc> [--passphrase <密码>]
 *
 * 加密: AES-256-GCM + PBKDF2-SHA256 (100000 iterations)
 * 格式: 自定义二进制头部 + JSON+gzip 加密 payload
 * ========================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const readline = require("readline");

// ---------- 常量 ----------
const MAGIC = Buffer.from("AMBK");
const VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const ITERATIONS = 100000;
const KEY_LEN = 32;
const HEADER_SIZE = 4 + 1 + SALT_LEN + 4 + IV_LEN + 4; // = 41
const MAX_PAYLOAD = 1024 * 1024; // 1MB

// ---------- 工具函数 ----------
function log(msg) { console.log(msg); }
function err(msg) { console.error(`❌ ${msg}`); }
function ok(msg) { console.log(`✅ ${msg}`); }
function warn(msg) { console.log(`⚠️  ${msg}`); }

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// 异步 PBKDF2
function pbkdf2Async(passphrase, salt, iterations, keylen, digest) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(passphrase, salt, iterations, keylen, digest, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

// 异步 gzip
function gzipAsync(data) {
  return new Promise((resolve, reject) => {
    zlib.gzip(data, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// 异步 gunzip
function gunzipAsync(data) {
  return new Promise((resolve, reject) => {
    zlib.gunzip(data, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// 交互式密码输入
function promptPassphrase(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    // 隐藏输入
    const stdin = process.stdin;
    const isTTY = process.stdin.isTTY;
    if (isTTY) stdin.setRawMode(true);

    let password = "";
    process.stdout.write(promptText);

    const onData = (charBuf) => {
      const char = charBuf.toString();
      const code = charBuf[0];
      if (code === 3) { // Ctrl+C
        if (isTTY) stdin.setRawMode(false);
        rl.close();
        process.exit(1);
      } else if (code === 13 || code === 10) { // Enter
        if (isTTY) stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        rl.close();
        process.stdout.write("\n");
        resolve(password);
      } else if (code === 127 || code === 8) { // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        password += char;
        if (isTTY) process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

// 获取密码短语（按优先级：参数 > 环境变量 > 交互式）
async function getPassphrase(args, requireConfirm) {
  // 1. 命令行参数
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--passphrase" && args[i + 1]) {
      const pw = args[++i];
      if (!pw || pw.length === 0) {
        err("密码短语不能为空");
        process.exit(1);
      }
      if (pw.length < 8) warn("密码短语少于 8 字符，安全性较低");
      return pw;
    }
    // --passphrase-file
    if (args[i] === "--passphrase-file" && args[i + 1]) {
      const file = args[++i];
      if (!fs.existsSync(file)) {
        err(`密码文件不存在: ${file}`);
        process.exit(1);
      }
      const stat = fs.statSync(file);
      if (stat.mode & 0o077) warn(`密码文件权限过宽 (${(stat.mode & 0o777).toString(8)})，建议 0600`);
      const pw = fs.readFileSync(file, "utf-8").trim();
      if (!pw) { err("密码文件为空"); process.exit(1); }
      return pw;
    }
  }
  // 2. 环境变量
  if (process.env.KEYBACKUP_PASSPHRASE && process.env.KEYBACKUP_PASSPHRASE.length > 0) {
    return process.env.KEYBACKUP_PASSPHRASE;
  }
  // 3. 交互式
  if (!process.stdin.isTTY) {
    err("非交互模式下必须通过 --passphrase / --passphrase-file / KEYBACKUP_PASSPHRASE 提供密码");
    process.exit(1);
  }
  let attempts = 0;
  while (attempts < 3) {
    const pw = await promptPassphrase("请输入密码短语: ");
    if (!pw || pw.length === 0) {
      warn("密码短语不能为空，请重试");
      attempts++;
      continue;
    }
    if (requireConfirm) {
      const pw2 = await promptPassphrase("请再次输入密码短语: ");
      if (pw !== pw2) {
        warn("两次输入不一致，请重试");
        attempts++;
        continue;
      }
    }
    if (pw.length < 8) warn("密码短语少于 8 字符，安全性较低");
    return pw;
  }
  err("密码短语输入失败次数过多");
  process.exit(1);
}

// ---------- 二进制格式读写 ----------
function buildHeader(salt, iterations, iv, payloadLen) {
  const buf = Buffer.alloc(HEADER_SIZE);
  let offset = 0;
  MAGIC.copy(buf, offset); offset += 4;
  buf.writeUInt8(VERSION, offset); offset += 1;
  salt.copy(buf, offset); offset += SALT_LEN;
  buf.writeUInt32BE(iterations, offset); offset += 4;
  iv.copy(buf, offset); offset += IV_LEN;
  buf.writeUInt32BE(payloadLen, offset); offset += 4;
  return buf;
}

function parseHeader(buf) {
  if (buf.length < HEADER_SIZE) throw new Error("文件太小，不是有效的备份文件");
  let offset = 0;
  const magic = buf.slice(offset, offset + 4); offset += 4;
  if (!magic.equals(MAGIC)) throw new Error("Magic 不匹配，不是有效的备份文件");
  const version = buf.readUInt8(offset); offset += 1;
  if (version !== VERSION) throw new Error(`不支持的版本: ${version}（当前版本 ${VERSION}）`);
  const salt = buf.slice(offset, offset + SALT_LEN); offset += SALT_LEN;
  const iterations = buf.readUInt32BE(offset); offset += 4;
  const iv = buf.slice(offset, offset + IV_LEN); offset += IV_LEN;
  const payloadLen = buf.readUInt32BE(offset); offset += 4;
  return { version, salt, iterations, iv, payloadLen, headerSize: offset };
}

// ---------- backup ----------
async function cmdBackup(args) {
  const id = args[0];
  if (!id) {
    err("用法: node tools/keybackup.js backup <id> [--output <path>] [--passphrase <密码>]");
    process.exit(2);
  }

  const keyDir = path.join("keys", id);
  if (!fs.existsSync(keyDir) || !fs.existsSync(path.join(keyDir, "private.pem"))) {
    err(`密钥目录不存在或无 private.pem: ${keyDir}`);
    process.exit(1);
  }

  // 解析 --output
  let outputPath = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) outputPath = args[++i];
  }

  // 收集文件
  const files = [];
  for (const f of ["private.pem", "private-x.pem", "public.pem"]) {
    const fp = path.join(keyDir, f);
    if (fs.existsSync(fp)) {
      const stat = fs.statSync(fp);
      files.push({
        path: f,
        mode: (stat.mode & 0o777).toString(8).padStart(3, "0"),
        content: fs.readFileSync(fp).toString("base64")
      });
    }
  }

  if (files.length === 0) {
    err("密钥目录中没有可备份的文件");
    process.exit(1);
  }

  // 构建 payload
  const payload = JSON.stringify({
    version: 1,
    agent_id: id,
    created_at: new Date().toISOString(),
    files: files
  });

  // 压缩
  const compressed = await gzipAsync(Buffer.from(payload, "utf-8"));

  // 获取密码
  const passphrase = await getPassphrase(args, true);

  // 加密
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = await pbkdf2Async(passphrase, salt, ITERATIONS, KEY_LEN, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();

  // 构建文件
  const header = buildHeader(salt, ITERATIONS, iv, encrypted.length);
  const fileContent = Buffer.concat([header, encrypted, tag]);

  // 确定输出路径（--output 总是目录路径）
  let outDir, outFile;
  if (outputPath) {
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).isFile()) {
      // 已存在的文件：视为完整文件路径
      outDir = path.dirname(outputPath);
      outFile = path.basename(outputPath);
    } else {
      // 目录（存在或不存在）：自动生成文件名
      outDir = outputPath;
      outFile = `${id}-backup-${timestamp()}.enc`;
    }
  } else {
    outDir = ".";
    outFile = `${id}-backup-${timestamp()}.enc`;
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const fullPath = path.join(outDir, outFile);

  fs.writeFileSync(fullPath, fileContent);
  fs.chmodSync(fullPath, 0o600);

  ok(`备份成功: ${fullPath}`);
  log(`   Agent ID: ${id}`);
  log(`   文件数: ${files.length} (${files.map(f => f.path).join(", ")})`);
  log(`   文件大小: ${fileContent.length} bytes`);
  log(`   权限: 0600`);
  warn(`请安全保存备份文件和密码短语！密码短语丢失则备份不可恢复。`);
}

// ---------- recover ----------
async function cmdRecover(args) {
  const backupFile = args[0];
  if (!backupFile) {
    err("用法: node tools/keybackup.js recover <backup.enc> [--output <dir>] [--passphrase <密码>] [--force]");
    process.exit(2);
  }
  if (!fs.existsSync(backupFile)) {
    err(`备份文件不存在: ${backupFile}`);
    process.exit(1);
  }

  // 解析参数
  let outputDir = ".";
  let force = false;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) outputDir = args[++i];
    if (args[i] === "--force") force = true;
  }

  // 读取文件
  const fileContent = fs.readFileSync(backupFile);
  let header;
  try {
    header = parseHeader(fileContent);
  } catch (e) {
    err(`备份文件格式错误: ${e.message}`);
    process.exit(1);
  }

  const { salt, iterations, iv, payloadLen, headerSize } = header;
  if (payloadLen > MAX_PAYLOAD) {
    err(`payload 过大 (${payloadLen} bytes)，可能是恶意文件`);
    process.exit(1);
  }

  const encrypted = fileContent.slice(headerSize, headerSize + payloadLen);
  const tag = fileContent.slice(headerSize + payloadLen, headerSize + payloadLen + TAG_LEN);

  if (tag.length !== TAG_LEN) {
    err("Auth Tag 不完整，备份文件可能已损坏");
    process.exit(1);
  }

  // 获取密码
  const passphrase = await getPassphrase(args, false);

  // 解密
  let compressed;
  try {
    const key = await pbkdf2Async(passphrase, salt, iterations, KEY_LEN, "sha256");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (e) {
    err("解密失败：密码短语错误或备份文件已损坏");
    process.exit(1);
  }

  // 解压
  let payload;
  try {
    const decompressed = await gunzipAsync(compressed);
    payload = JSON.parse(decompressed.toString("utf-8"));
  } catch (e) {
    err(`解压/解析失败: ${e.message}`);
    process.exit(1);
  }

  const id = payload.agent_id;
  const targetDir = path.join(outputDir, "keys", id);

  // 检查目标目录
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0 && !force) {
    if (!process.stdin.isTTY) {
      err(`目标目录已存在且非空: ${targetDir}。使用 --force 覆盖，或手动备份后删除。`);
      process.exit(1);
    }
    warn(`目标目录已存在且非空: ${targetDir}`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => rl.question("是否覆盖？(y/N): ", resolve));
    rl.close();
    if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
      log("已取消恢复");
      process.exit(0);
    }
    // 预恢复备份
    const backupDir = path.join(outputDir, "keys", `${id}.pre-recover-${timestamp()}`);
    fs.renameSync(targetDir, backupDir);
    warn(`原有密钥已备份到: ${backupDir}`);
  }

  // 创建目录
  fs.mkdirSync(targetDir, { recursive: true });

  // 恢复文件
  for (const f of payload.files) {
    const fp = path.join(targetDir, f.path);
    const content = Buffer.from(f.content, "base64");
    fs.writeFileSync(fp, content);
    const mode = parseInt(f.mode, 8);
    if (!isNaN(mode)) fs.chmodSync(fp, mode);
  }

  ok(`恢复成功: ${targetDir}`);
  log(`   Agent ID: ${id}`);
  log(`   文件数: ${payload.files.length}`);
  log(`   备份时间: ${payload.created_at}`);

  // 恢复后验证
  await verifyRecovered(id, targetDir);
}

// 恢复后验证
async function verifyRecovered(id, keyDir) {
  const privPath = path.join(keyDir, "private.pem");
  const pubPath = path.join(keyDir, "public.pem");

  if (!fs.existsSync(privPath)) {
    warn("恢复后验证：未找到 private.pem，跳过签名测试");
    return;
  }

  try {
    const privKey = crypto.createPrivateKey({ key: fs.readFileSync(privPath), format: "pem", type: "pkcs8" });
    const testData = Buffer.from(`agent-market-backup-verify-${Date.now()}`);
    const sig = crypto.sign(null, testData, privKey);

    if (fs.existsSync(pubPath)) {
      const pubKey = crypto.createPublicKey({ key: fs.readFileSync(pubPath), format: "pem", type: "spki" });
      const valid = crypto.verify(null, testData, pubKey, sig);
      if (valid) {
        const der = pubKey.export({ type: "spki", format: "der" });
        const fp = "SHA256:" + crypto.createHash("sha256").update(der).digest("base64");
        ok(`恢复后验证：签名测试通过，公钥指纹: ${fp}`);
      } else {
        warn("恢复后验证：签名测试失败，公钥与私钥不匹配");
      }
    } else {
      ok("恢复后验证：私钥可正常签名（未找到公钥，跳过验证）");
    }

    // 检查 agent.md 指纹对比
    const agentMdPath = path.join("agents", `${id}.md`);
    if (fs.existsSync(agentMdPath)) {
      const content = fs.readFileSync(agentMdPath, "utf-8");
      const match = content.match(/key_fingerprint:\s*(SHA256:[A-Za-z0-9+/=]+)/);
      if (match && fs.existsSync(pubPath)) {
        const pubKey = crypto.createPublicKey({ key: fs.readFileSync(pubPath), format: "pem", type: "spki" });
        const der = pubKey.export({ type: "spki", format: "der" });
        const fp = "SHA256:" + crypto.createHash("sha256").update(der).digest("base64");
        if (match[1] === fp) {
          ok(`恢复后验证：公钥指纹与 agent.md 一致`);
        } else {
          warn(`恢复后验证：公钥指纹与 agent.md 不一致（可能是旧密钥备份）`);
          log(`   agent.md: ${match[1]}`);
          log(`   恢复密钥: ${fp}`);
        }
      }
    } else {
      warn("恢复后验证：未找到 agent.md，跳过指纹对比");
    }
  } catch (e) {
    warn(`恢复后验证失败: ${e.message}`);
  }
}

// ---------- verify ----------
async function cmdVerify(args) {
  const backupFile = args[0];
  if (!backupFile) {
    err("用法: node tools/keybackup.js verify <backup.enc> [--deep] [--passphrase <密码>]");
    process.exit(2);
  }
  if (!fs.existsSync(backupFile)) {
    err(`备份文件不存在: ${backupFile}`);
    process.exit(1);
  }

  const deep = args.includes("--deep");
  const fileContent = fs.readFileSync(backupFile);

  // 快速验证：头部格式
  try {
    const header = parseHeader(fileContent);
    log(`📋 快速验证通过`);
    log(`   版本: ${header.version}`);
    log(`   Salt: ${header.salt.toString("hex").slice(0, 16)}...`);
    log(`   迭代次数: ${header.iterations}`);
    log(`   IV: ${header.iv.toString("hex").slice(0, 16)}...`);
    log(`   Payload 大小: ${header.payloadLen} bytes`);
    log(`   文件总大小: ${fileContent.length} bytes`);

    const expectedSize = header.headerSize + header.payloadLen + TAG_LEN;
    if (fileContent.length !== expectedSize) {
      err(`文件大小不匹配（预期 ${expectedSize}，实际 ${fileContent.length}）`);
      process.exit(1);
    }
    ok(`快速验证通过：格式正确，大小匹配`);
  } catch (e) {
    err(`快速验证失败: ${e.message}`);
    process.exit(1);
  }

  // 深度验证：需要密码
  if (deep) {
    log(``);
    log(`🔐 深度验证（需密码短语）...`);
    const header = parseHeader(fileContent);
    const passphrase = await getPassphrase(args, false);

    try {
      const key = await pbkdf2Async(passphrase, header.salt, header.iterations, KEY_LEN, "sha256");
      const encrypted = fileContent.slice(header.headerSize, header.headerSize + header.payloadLen);
      const tag = fileContent.slice(header.headerSize + header.payloadLen, header.headerSize + header.payloadLen + TAG_LEN);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, header.iv);
      decipher.setAuthTag(tag);
      const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      const decompressed = await gunzipAsync(compressed);
      const payload = JSON.parse(decompressed.toString("utf-8"));
      ok(`深度验证通过：密码正确，Auth Tag 验证通过，payload 可解析`);
      log(`   Agent ID: ${payload.agent_id}`);
      log(`   备份时间: ${payload.created_at}`);
      log(`   文件数: ${payload.files.length}`);
    } catch (e) {
      err(`深度验证失败：密码短语错误或文件已损坏`);
      process.exit(1);
    }
  } else {
    log(``);
    log(`💡 提示：使用 --deep --passphrase <密码> 可进行完整验证（检查 Auth Tag + 解密 payload）`);
  }
}

// ---------- list ----------
async function cmdList(args) {
  const backupFile = args[0];
  if (!backupFile) {
    err("用法: node tools/keybackup.js list <backup.enc> [--passphrase <密码>]");
    process.exit(2);
  }
  if (!fs.existsSync(backupFile)) {
    err(`备份文件不存在: ${backupFile}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(backupFile);
  const header = parseHeader(fileContent);
  const passphrase = await getPassphrase(args, false);

  try {
    const key = await pbkdf2Async(passphrase, header.salt, header.iterations, KEY_LEN, "sha256");
    const encrypted = fileContent.slice(header.headerSize, header.headerSize + header.payloadLen);
    const tag = fileContent.slice(header.headerSize + header.payloadLen, header.headerSize + header.payloadLen + TAG_LEN);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, header.iv);
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const decompressed = await gunzipAsync(compressed);
    const payload = JSON.parse(decompressed.toString("utf-8"));

    log(`📦 备份内容:`);
    log(`   Agent ID: ${payload.agent_id}`);
    log(`   备份时间: ${payload.created_at}`);
    log(`   文件数: ${payload.files.length}`);
    log(``);
    for (const f of payload.files) {
      const size = Buffer.from(f.content, "base64").length;
      log(`   - ${f.path} (${size} bytes, mode ${f.mode})`);
    }
  } catch (e) {
    err("解密失败：密码短语错误或备份文件已损坏");
    process.exit(1);
  }
}

// ---------- 主入口 ----------
const [cmd, ...args] = process.argv.slice(2);

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log(`智能体协同市场 · 密钥备份/恢复工具（D-74）`);
  console.log(``);
  console.log(`用法:`);
  console.log(`  node tools/keybackup.js backup <id> [--output <path>] [--passphrase <密码>]`);
  console.log(`  node tools/keybackup.js recover <backup.enc> [--output <dir>] [--passphrase <密码>] [--force]`);
  console.log(`  node tools/keybackup.js verify <backup.enc> [--deep] [--passphrase <密码>]`);
  console.log(`  node tools/keybackup.js list <backup.enc> [--passphrase <密码>]`);
  console.log(``);
  console.log(`加密: AES-256-GCM + PBKDF2-SHA256 (100000 iterations)`);
  console.log(`密码输入优先级: --passphrase > KEYBACKUP_PASSPHRASE > 交互式输入`);
  process.exit(0);
}

(async () => {
  switch (cmd) {
    case "backup": await cmdBackup(args); break;
    case "recover": await cmdRecover(args); break;
    case "verify": await cmdVerify(args); break;
    case "list": await cmdList(args); break;
    default:
      err(`未知命令: ${cmd}`);
      console.log(`用法: node tools/keybackup.js backup|recover|verify|list`);
      process.exit(2);
  }
})().catch(e => {
  err(`未捕获的错误: ${e.message}`);
  process.exit(1);
});
