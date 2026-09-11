// gateway/test/gateway.test.js — TDD: local tests for the no-github gateway logic.
// Run: node --test gateway/test/  (Node 18+)
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const { handleEvent, canonical } = require("../worker.js");

// ---------- helpers ----------
function makeAgent() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const sign = (msg) => crypto.sign(null, Buffer.from(msg, "utf-8"), privPem).toString("hex");
  return { pubPem, sign };
}

// In-memory fake repo: path -> {content, sha}
function fakeRepo() {
  const files = {};
  const fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    const ghIdx = parts.indexOf("agentmarket");
    // URL is /repos/<owner>/<repo>/contents/<path> — drop the leading "contents"
    const path = parts.slice(ghIdx + 2).join("/");
    if (opts.method === "PUT") {
      const body = JSON.parse(opts.body);
      const content = Buffer.from(body.content, "base64").toString("utf-8");
      files[path] = { content, sha: "sha-" + Object.keys(files).length };
      return { ok: true, status: 200, json: async () => ({ sha: files[path].sha }) };
    }
    if (files[path]) {
      return {
        ok: true, status: 200,
        json: async () => ({ content: Buffer.from(files[path].content).toString("base64"), sha: files[path].sha }),
      };
    }
    if (path.endsWith("/events") || path.endsWith("/events/")) {
      const prefix = path.replace(/\/$/, "") + "/";
      const names = Object.keys(files).filter((p) => p.startsWith(prefix)).map((p) => ({ name: p.slice(prefix.length) }));
      return { ok: names.length > 0, status: names.length > 0 ? 200 : 404, json: async () => names };
    }
    return { ok: false, status: 404, text: async () => "not found" };
  };
  return { files, fetch };
}

const deps = (repo) => ({ fetch: repo.fetch, ghPat: "test-pat" });

// ---------- tests ----------

test("T1 register: valid ed25519 signature => agent.md written", async () => {
  const agent = makeAgent();
  const repo = fakeRepo();
  const payload = { name: "AG-TEST01", public_key: agent.pubPem, capabilities: "general", created: "2026-09-11T00:00:00Z" };
  const sig = agent.sign(canonical("register", "AG-TEST01", payload));
  const r = await handleEvent({ kind: "register", agent: "AG-TEST01", payload, sig }, deps(repo));
  assert.equal(r.status, 200);
  assert.ok(repo.files["agents/AG-TEST01/agent.md"]);
  assert.match(repo.files["agents/AG-TEST01/agent.md"].content, /id: AG-TEST01/);
});

test("T2 forged signature => 401 sig_invalid", async () => {
  const agent = makeAgent();
  const repo = fakeRepo();
  const payload = { name: "AG-TEST02", public_key: agent.pubPem };
  const sig = "deadbeef".repeat(16);
  const r = await handleEvent({ kind: "register", agent: "AG-TEST02", payload, sig }, deps(repo));
  assert.equal(r.status, 401);
  assert.equal(r.body.error, "sig_invalid");
});

test("T3 claim twice => 409 already_claimed", async () => {
  const agent = makeAgent();
  const repo = fakeRepo();
  const regPayload = { name: "AG-TEST03", public_key: agent.pubPem };
  await handleEvent({ kind: "register", agent: "AG-TEST03", payload: regPayload, sig: agent.sign(canonical("register", "AG-TEST03", regPayload)) }, deps(repo));
  repo.files["tasks/T-X/events/claimed-20260911000000.md"] = { content: "---\nevent: claimed\n---\n", sha: "s1" };
  const payload = { task: "T-X" };
  const sig = agent.sign(canonical("claim", "AG-TEST03", payload));
  const r = await handleEvent({ kind: "claim", agent: "AG-TEST03", payload, sig }, deps(repo));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "already_claimed");
});

test("T4 unknown kind => 400 unknown_kind", async () => {
  const agent = makeAgent();
  const repo = fakeRepo();
  const r = await handleEvent({ kind: "hack", agent: "AG-TEST04", payload: {}, sig: agent.sign(canonical("hack", "AG-TEST04", {})) }, deps(repo));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "unknown_kind");
});

test("T5 missing fields => 400 bad_request", async () => {
  const repo = fakeRepo();
  const r = await handleEvent({ kind: "claim", agent: "", payload: null }, deps(repo));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "bad_request");
});

test("T6 claim valid => 200 with ref", async () => {
  const agent = makeAgent();
  const repo = fakeRepo();
  const regPayload = { name: "AG-TEST06", public_key: agent.pubPem };
  await handleEvent({ kind: "register", agent: "AG-TEST06", payload: regPayload, sig: agent.sign(canonical("register", "AG-TEST06", regPayload)) }, deps(repo));
  const payload = { task: "T-2000" };
  const sig = agent.sign(canonical("claim", "AG-TEST06", payload));
  const r = await handleEvent({ kind: "claim", agent: "AG-TEST06", payload, sig }, deps(repo));
  assert.equal(r.status, 200);
  assert.ok(r.body.ref.startsWith("tasks/T-2000/events/claimed-"));
});

test("T7 submit => event + result file written", async () => {
  const agent = makeAgent();
  const repo = fakeRepo();
  const regPayload = { name: "AG-TEST07", public_key: agent.pubPem };
  await handleEvent({ kind: "register", agent: "AG-TEST07", payload: regPayload, sig: agent.sign(canonical("register", "AG-TEST07", regPayload)) }, deps(repo));
  const payload = { task: "T-2000", result: { path: "result/ok.md", content: "OK\n" } };
  const sig = agent.sign(canonical("submit", "AG-TEST07", payload));
  const r = await handleEvent({ kind: "submit", agent: "AG-TEST07", payload, sig }, deps(repo));
  assert.equal(r.status, 200);
  assert.equal(repo.files["tasks/T-2000/result/ok.md"].content, "OK\n");
  assert.ok(Object.keys(repo.files).some((p) => p.includes("submitted-")));
});

test("T8 claim by unregistered agent => 404 agent_not_found", async () => {
  const repo = fakeRepo();
  const agent = makeAgent();
  const payload = { task: "T-2000" };
  const sig = agent.sign(canonical("claim", "AG-NOREG", payload));
  const r = await handleEvent({ kind: "claim", agent: "AG-NOREG", payload, sig }, deps(repo));
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "agent_not_found");
});
