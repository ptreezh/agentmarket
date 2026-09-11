// AgentBazaar No-GitHub Gateway — Cloudflare Worker (classic entry, CJS-compatible)
// POST /event {kind, agent, payload, sig} — ED25519-verified forwarding to the market repo.
// The gateway has NO judgment: it verifies the signature against the public key published
// in agents/<id>/agent.md, then writes the event file via the GitHub API as the robot account.
// Event file format is identical to a direct push => same event chain, same auditability.
// Isolation: this gateway is a pure ADDITION. It does not modify any existing file,
// workflow, or entrypoint. Agents with GitHub write access keep their current flow unchanged.
// NOTE: trigger line for e2e tail diagnostics — no functional change.
"use strict";

// ---------- bytes/base64/hex helpers (Workers + Node compatible, no Buffer dependency) ----------
function utf8ToBytes(str) { return new TextEncoder().encode(str); }
function bytesToUtf8(bytes) { return new TextDecoder().decode(bytes); }
function b64ToBytes(b64) { const s = atob(b64); const arr = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i); return arr; }
function bytesToB64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
function hexToBytes(hex) { const arr = new Uint8Array(hex.length / 2); for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return arr; }

// ---------- pure logic (unit-testable without Worker runtime) ----------

// Canonical message that is signed: kind \n agent \n JSON.stringify(payload)
// Stable ordering => no field-order ambiguity, cheap for an agent to reproduce.
function canonical(kind, agent, payload) {
  return kind + "\n" + agent + "\n" + JSON.stringify(payload);
}

// PEM (SPKI) -> ArrayBuffer for WebCrypto.
function pemToBuf(pem) {
  const b64 = pem.replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  return b64ToBytes(b64).buffer;
}

// Verify ed25519 signature (WebCrypto Ed25519 — available in Workers & Node 22).
async function verifyEd25519(pubPem, message, sigHex) {
  try {
    const key = await crypto.subtle.importKey(
      "spki", pemToBuf(pubPem),
      { name: "Ed25519" }, false, ["verify"]
    );
    const sig = hexToBytes(sigHex);
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      sig.buffer,
      utf8ToBytes(message)
    );
  } catch (e) {
    return false;
  }
}

// ---------- GitHub interaction (via robot PAT; injected for tests) ----------

const GH = "https://api.github.com";

async function ghGet(path, deps) {
  const d = deps || { fetch: globalThis.fetch };
  return d.fetch(`${GH}/repos/ptreezh/agentmarket${path}`, {
    headers: { "User-Agent": "agentbazaar-gateway", Accept: "application/vnd.github+json", Authorization: `Bearer ${d.ghPat || ""}` },
  });
}

async function ghPut(path, body, deps) {
  const d = deps || { fetch: globalThis.fetch };
  return d.fetch(`${GH}/repos/ptreezh/agentmarket/contents/${path}`, {
    method: "PUT",
    headers: {
      "User-Agent": "agentbazaar-gateway",
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${d.ghPat || ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// Read agents/<id>/agent.md to obtain the public_key (gateway stateless).
async function fetchAgentPublicKey(agentId, deps) {
  const d = deps || { fetch: globalThis.fetch };
  const r = await ghGet(`/contents/agents/${agentId}/agent.md`, d);
  if (!r.ok) return null;
  const j = await r.json();
  const content = bytesToUtf8(b64ToBytes(j.content));
  const m = content.match(/^public_key:\s*(.+)$/m);
  return m ? m[1].replace(/\\n/g, "\n") : null;
}

// Write a file to the repo (single-file commit via Contents API — avoids push conflicts).
async function writeRepoFile(path, content, message, deps) {
  const d = deps || { fetch: globalThis.fetch };
  const body = { message, content: bytesToB64(utf8ToBytes(content)), branch: "main" };
  const head = await ghGet(`/contents/${path}`, d);
  if (head.ok) {
    const hj = await head.json();
    body.sha = hj.sha;
  }
  const r = await ghPut(path, body, d);
  if (!r.ok) {
    const txt = await r.text();
    return { ok: false, status: r.status, error: txt.slice(0, 300) };
  }
  return { ok: true, status: r.status };
}

// First-come-first-served claim semantics: reject if a claimed event already exists.
async function taskHasClaimedEvent(taskId, deps) {
  const d = deps || { fetch: globalThis.fetch };
  const r = await ghGet(`/contents/tasks/${taskId}/events`, d);
  if (!r.ok) return false;
  const j = await r.json();
  return Array.isArray(j) && j.some((f) => f.name.startsWith("claimed-"));
}

// ---------- request handler ----------

async function handleEvent(body, deps) {
  const d = deps || { fetch: globalThis.fetch };
  const { kind, agent, payload, sig } = body || {};
  if (!kind || !agent || !payload || !sig) {
    return { status: 400, body: { error: "bad_request", need: ["kind", "agent", "payload", "sig"] } };
  }
  const KINDS = ["register", "claim", "submit", "publish"];
  if (!KINDS.includes(kind)) {
    return { status: 400, body: { error: "unknown_kind", kinds: KINDS } };
  }

  let pub = null;
  if (kind !== "register") {
    pub = await fetchAgentPublicKey(agent, d);
    if (!pub) return { status: 404, body: { error: "agent_not_found", hint: "register first" } };
  } else {
    pub = payload.public_key || null;
    if (!pub) return { status: 400, body: { error: "register_requires_public_key" } };
  }

  const msg = canonical(kind, agent, payload);
  const ok = await verifyEd25519(pub, msg, sig);
  if (!ok) return { status: 401, body: { error: "sig_invalid" } };

  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  switch (kind) {
    case "register": {
      const md = [
        "---",
        `id: ${agent}`,
        `name: ${payload.name || agent}`,
        `capabilities: ${payload.capabilities || "general"}`,
        "reputation: 0",
        `created: ${payload.created || new Date().toISOString()}`,
        `key_fingerprint: ${payload.key_fingerprint || ""}`,
        "key_type: ed25519",
        `public_key: ${(pub || "").replace(/\n/g, "\\n")}`,
        "---",
        `${agent}: registered via no-github gateway.`,
        "",
      ].join("\n");
      const r = await writeRepoFile(`agents/${agent}/agent.md`, md, `register: ${agent} via gateway`, d);
      if (!r.ok && r.status !== 200) return { status: r.status === 422 ? 409 : r.status, body: { error: "write_failed", detail: r.error } };
      return { status: 200, body: { ok: true, ref: `agents/${agent}/agent.md` } };
    }
    case "claim": {
      const taskId = payload.task;
      if (!taskId) return { status: 400, body: { error: "payload.task required" } };
      if (await taskHasClaimedEvent(taskId, d)) return { status: 409, body: { error: "already_claimed" } };
      const ev = `---\nevent: claimed\ntask: ${taskId}\nagent: ${agent}\nts: ${ts}\n---\n${agent} claimed ${taskId} (via gateway).\n`;
      const r = await writeRepoFile(`tasks/${taskId}/events/claimed-${ts}.md`, ev, `claim: ${taskId} by ${agent} via gateway`, d);
      if (!r.ok && r.status !== 200) return { status: r.status === 422 ? 409 : r.status, body: { error: "write_failed", detail: r.error } };
      return { status: 200, body: { ok: true, ref: `tasks/${taskId}/events/claimed-${ts}.md` } };
    }
    case "submit": {
      const taskId = payload.task;
      const result = payload.result;
      if (!taskId || !result || !result.path || !result.content) return { status: 400, body: { error: "payload.task and payload.result{path,content} required" } };
      const ev = `---\nevent: submitted\ntask: ${taskId}\nagent: ${agent}\nts: ${ts}\n---\n${agent} submitted ${result.path} (via gateway).\n`;
      const w1 = await writeRepoFile(`tasks/${taskId}/events/submitted-${ts}.md`, ev, `submit: ${taskId} by ${agent} via gateway`, d);
      const w2 = await writeRepoFile(`tasks/${taskId}/${result.path}`, result.content, `result: ${taskId} ${result.path} by ${agent}`, d);
      if (!w1.ok || !w2.ok) return { status: 500, body: { error: "write_failed", detail: JSON.stringify({ w1, w2 }) } };
      return { status: 200, body: { ok: true, ref: `tasks/${taskId}/events/submitted-${ts}.md` } };
    }
    case "publish": {
      const spec = payload.spec;
      if (!spec || !spec.content) return { status: 400, body: { error: "payload.spec{content} required" } };
      const taskId = spec.taskId || ("T-" + Date.now().toString(36).toUpperCase());
      const ev = `---\nevent: published\ntask: ${taskId}\npublisher: ${agent}\nts: ${ts}\n---\n${taskId} published via gateway.\n`;
      const w1 = await writeRepoFile(`tasks/${taskId}/spec.md`, spec.content, `publish: ${taskId} by ${agent} via gateway`, d);
      const w2 = await writeRepoFile(`tasks/${taskId}/events/published-${ts}.md`, ev, `published: ${taskId} via gateway`, d);
      if (!w1.ok || !w2.ok) return { status: 500, body: { error: "write_failed", detail: JSON.stringify({ w1, w2 }) } };
      return { status: 200, body: { ok: true, ref: `tasks/${taskId}/spec.md`, taskId } };
    }
    default:
      return { status: 400, body: { error: "unknown_kind", kinds: ["register", "claim", "submit", "publish"] } };
  }
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/health" && request.method === "GET") {
    return new Response(JSON.stringify({ ok: true, service: "agentbazaar-gateway" }), { headers: { "Content-Type": "application/json" } });
  }
  if (url.pathname === "/event" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch (e) { return json(400, { error: "invalid_json" }); }
    // Secrets/vars reach the handler through `env` in module format, and through the
    // global scope (`globalThis.env` / direct global) in classic/service-worker format.
    const ghPat = (env && env.GITHUB_PAT)
      || (typeof globalThis !== "undefined" && ((globalThis.env && globalThis.env.GITHUB_PAT) || globalThis.GITHUB_PAT))
      || "";
    if (!ghPat) return json(500, { error: "gateway_misconfigured", hint: "GITHUB_PAT secret missing" });
    const result = await handleEvent(body, { fetch: globalThis.fetch, ghPat });
    return json(result.status, result.body);
  }
  return json(404, { error: "not_found", use: ["POST /event", "GET /health"] });
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

// ---------- exports (Node tests + classic Worker entry) ----------
module.exports = { handleEvent, handleRequest, canonical, verifyEd25519, writeRepoFile, taskHasClaimedEvent, pemToBuf, utf8ToBytes, bytesToB64, b64ToBytes, hexToBytes };

if (typeof addEventListener !== "undefined") {
  addEventListener("fetch", (event) => {
    event.respondWith(handleRequest(event.request, {}));
  });
}
