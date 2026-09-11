#!/usr/bin/env node
/* D-19 签名/验签 · sig.js
 * 用法:
 *   node tools/sig.js sign <agentId> <file>     # 对文件正文签名，写 signer+signature 进 frontmatter
 *   node tools/sig.js verify <file>             # 验签（从 agents/<signer>/agent.md 取公钥）
 *   node tools/sig.js test <agentId>            # 自检：签名→验签→篡改检测
 * 签名对象 = frontmatter 之后全部正文（UTF-8）；ED25519 原始签名，hex。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const [cmd, ...rest] = process.argv.slice(2);

function splitFile(text) {
  const m = text.match(/^(---\n[\s\S]*?\n---)\n([\s\S]*)$/);
  return m ? { front: m[1], body: m[2] } : null;
}
function signBody(privPem, body) {
  return crypto.sign(null, Buffer.from(body, "utf-8"), crypto.createPrivateKey(privPem)).toString("hex");
}
function verifyBody(pubPem, body, sigHex) {
  try {
    return crypto.verify(null, Buffer.from(body, "utf-8"), crypto.createPublicKey(pubPem), Buffer.from(sigHex, "hex"));
  } catch (e) { return false; }
}
function getPubFromAgent(signer) {
  // 1) 直接按 AG-ID 查 agents/<signer>/agent.md（auth_sig 场景：signer 是 AG-ID）
  const direct = path.join("agents", signer, "agent.md");
  if (fs.existsSync(direct)) {
    const s = fs.readFileSync(direct, "utf-8");
    const m = s.match(/^public_key:\s*(.+)$/m);
    if (m) return m[1].replace(/\\n/g, "\n");
  }
  // operator 分支（D-111）：signer 指纹匹配 OPERATOR_PUBKEY → 用运营者公钥验签
  try {
    if (fs.existsSync("OPERATOR_PUBKEY")) {
      const opPem = fs.readFileSync("OPERATOR_PUBKEY", "utf-8");
      const opDer = crypto.createPublicKey(opPem).export({ type: "spki", format: "der" });
      const opFp = "SHA256:" + crypto.createHash("sha256").update(opDer).digest("base64");
      if (opFp === signer) return opPem;
    }
  } catch (e) { /* fall through to agent lookup */ }
  // 指纹 → agent 档案解析（扫 agents/*/agent.md 匹配 key_fingerprint）
  const dirs = fs.existsSync("agents") ? fs.readdirSync("agents") : [];
  for (const d of dirs) {
    const f = path.join("agents", d, "agent.md");
    if (!fs.existsSync(f)) continue;
    const s = fs.readFileSync(f, "utf-8");
    const fp = (s.match(/^key_fingerprint:\s*(\S+)/m) || [])[1];
    if (fp === signer) {
      const m = s.match(/^public_key:\s*(.+)$/m);
      if (!m) throw new Error("档案无 public_key（需先 keygen）: " + d);
      return m[1].replace(/\\n/g, "\n");
    }
  }
  throw new Error("找不到 signer 对应的 agent 档案: " + signer);
}

switch (cmd) {
  case "sign": {
    const [id, file] = rest;
    if (!id || !file) { console.error("usage: sign <agentId> <file>"); process.exit(2); }
    const privPath = path.join("keys", id, "private.pem");
    if (!fs.existsSync(privPath)) { console.error(`缺私钥: ${privPath}（先 keygen）`); process.exit(1); }
    const priv = fs.readFileSync(privPath, "utf-8");
    const text = fs.readFileSync(file, "utf-8");
    const sp = splitFile(text);
    if (!sp) { console.error("文件无 frontmatter"); process.exit(1); }
    const fp = fs.readFileSync(path.join("agents", id, "agent.md"), "utf-8").match(/^key_fingerprint:\s*(\S+)/m)[1];
    const sig = signBody(priv, sp.body);
    // 幂等：把 signer/signature 放入 frontmatter（闭合 --- 之前），正文保持纯净（签名只覆盖正文）
    let front = sp.front
      .replace(/^signer:.*$/m, `signer: ${fp}`)
      .replace(/^signature:.*$/m, `signature: ${sig}`)
      .replace(/\n---$/, `\nsigner: ${fp}\nsignature: ${sig}\n---`);
    fs.writeFileSync(file, front + "\n" + sp.body);
    console.log(`✅ 已签名 ${file}`);
    console.log(`   signer=${fp} sig=${sig.slice(0, 16)}…`);
    break;
  }
  case "verify": {
    const [file] = rest;
    if (!file) { console.error("usage: verify <file>"); process.exit(2); }
    const text = fs.readFileSync(file, "utf-8");
    const sp = splitFile(text);
    if (!sp) { console.log(`✗ ${file}: 无 frontmatter`); process.exit(1); }
    // 网关事件（零 node 通道）：auth_sig 优先（评论签名，消息 = 评论原文）
    const authSig = (sp.front.match(/^auth_sig:\s*(\S+)/m) || [])[1];
    if (authSig) {
      const evType = (sp.front.match(/^event:\s*(\S+)/m) || [])[1];
      let msg = null, authSigner = null;
      if (evType === "published") {
        authSigner = (sp.front.match(/^publisher:\s*(\S+)/m) || [])[1];
        msg = "publish " + sp.body.trim();
      } else if (evType === "claimed") {
        authSigner = (sp.front.match(/^worker:\s*(\S+)/m) || [])[1];
        const task = (sp.front.match(/^task:\s*(\S+)/m) || [])[1];
        msg = "claim " + task + " " + authSigner;
      }
      if (msg && authSigner) {
        try {
          const pub = getPubFromAgent(authSigner);
          const ok = verifyBody(pub, msg, authSig);
          console.log(`${ok ? "✅" : "❌"} ${file}: ${ok ? "auth_sig 签名有效" : "auth_sig 验签失败/被篡改"} (signer=${authSigner})`);
          process.exit(ok ? 0 : 1);
        } catch (e) {
          console.log(`✗ ${file}: auth_sig 验签异常 ${e.message}`);
          process.exit(1);
        }
      }
      // 缺消息构造信息（未知 event 类型）→ 回退 signer/signature 逻辑
    }
    const signer = (sp.front.match(/^signer:\s*(\S+)/m) || [])[1];
    const sig = (sp.front.match(/^signature:\s*(\S+)/m) || [])[1];
    if (!signer || !sig) { console.log(`✗ ${file}: 缺 signer/signature（未签名）`); process.exit(1); }
    const pub = getPubFromAgent(signer);
    const ok = verifyBody(pub, sp.body, sig);
    console.log(`${ok ? "✅" : "❌"} ${file}: ${ok ? "签名有效" : "签名无效/被篡改"} (signer=${signer})`);
    process.exit(ok ? 0 : 1);
  }
  case "test": {
    const [id] = rest;
    if (!id) { console.error("usage: test <agentId>"); process.exit(2); }
    const t = path.join(process.env.TMPDIR || "/tmp", `sigtest-${id}-${Date.now()}.md`);
    fs.writeFileSync(t, "---\ntest: 1\n---\n正文 hello\n");
    const r1 = require("child_process").spawnSync(process.execPath, [__filename, "sign", id, t], { stdio: "inherit" });
    const r2 = require("child_process").spawnSync(process.execPath, [__filename, "verify", t], { stdio: "inherit" });
    fs.writeFileSync(t, fs.readFileSync(t, "utf-8").replace("正文 hello", "正文 hello 篡改"));
    console.log("—— 篡改检测 ——");
    const r3 = require("child_process").spawnSync(process.execPath, [__filename, "verify", t], { stdio: "inherit" });
    fs.unlinkSync(t);
    console.log(r3.status === 1 ? "✅ 篡改被检出（验证失败）" : "❌ 篡改未被检出！");
    process.exit(r1.status || r2.status || (r3.status === 1 ? 0 : 1));
  }
  default:
    console.log("用法: sig.js sign <agentId> <file> | verify <file> | test <agentId>");
}
