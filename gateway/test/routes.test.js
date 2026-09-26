// gateway/test/routes.test.js — TDD for new read-only gateway routes /start and /tasks.
// Run: node --test gateway/test/  (Node 18+)
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { handleRequest } = require("../worker.js");

// Minimal fake fetch for the GitHub API: serve /start script + /tasks listing.
function fakeFetch(scriptContent, taskSpecs) {
  const files = {};
  files["skills/agentbazaar/scripts/ab-quickstart.sh"] = scriptContent;
  files["tasks/T-3006/spec.md"] = taskSpecs["T-3006"];
  files["tasks/T-3010/spec.md"] = taskSpecs["T-3010"];
  const ghApi = async (url, opts = {}) => {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    const ghIdx = parts.indexOf("agentmarket");
    const path = parts.slice(ghIdx + 2).join("/"); // drop /repos/<owner>/<repo>/contents/
    if (path === "tasks") {
      return {
        ok: true, status: 200,
        json: async () => [
          { type: "dir", name: "T-3006" },
          { type: "dir", name: "T-3010" },
          { type: "file", name: ".gitkeep" },
        ],
      };
    }
    if (files[path]) {
      return {
        ok: true, status: 200,
        json: async () => ({ content: Buffer.from(files[path]).toString("base64") }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ message: "not found" }) };
  };
  return ghApi;
}

const SCRIPT = "#!/usr/bin/env bash\necho quickstart-ok\n";
const SPEC3006 = `---
id: T-3006
title: "Community check-in"
budget: 40
deadline: "2026-10-15T00:00:00Z"
---
body
`;
const SPEC3010 = `---
id: T-3010
title: "Translate PROTOCOL"
budget: 20
deadline: "2026-11-01T00:00:00Z"
---
body
`;

test("GET /start returns quickstart script as text/plain", async () => {
  const req = new Request("https://gw/start", { method: "GET" });
  const res = await handleRequest(req, {}, { fetch: fakeFetch(SCRIPT, { "T-3006": SPEC3006, "T-3010": SPEC3010 }) });
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/plain/);
  const body = await res.text();
  assert.match(body, /quickstart-ok/);
});

test("GET /tasks lists open tasks with parsed frontmatter", async () => {
  const req = new Request("https://gw/tasks", { method: "GET" });
  const res = await handleRequest(req, {}, { fetch: fakeFetch(SCRIPT, { "T-3006": SPEC3006, "T-3010": SPEC3010 }) });
  assert.strictEqual(res.status, 200);
  const j = await res.json();
  assert.strictEqual(j.ok, true);
  assert.strictEqual(j.count, 2);
  const t3006 = j.tasks.find((t) => t.id === "T-3006");
  assert.ok(t3006);
  assert.strictEqual(t3006.budget, 40);
  assert.strictEqual(t3006.title, "Community check-in");
  assert.match(t3006.deadline, /2026-10-15/);
});

test("unknown route still 404 with updated hint", async () => {
  const req = new Request("https://gw/nope", { method: "GET" });
  const res = await handleRequest(req, {}, { fetch: fakeFetch(SCRIPT, { "T-3006": SPEC3006, "T-3010": SPEC3010 }) });
  assert.strictEqual(res.status, 404);
  const j = await res.json();
  assert.ok(j.use.includes("GET /start"));
  assert.ok(j.use.includes("GET /tasks"));
});

test("GET /start returns 502 when script missing from repo", async () => {
  const req = new Request("https://gw/start", { method: "GET" });
  const noScript = async () => ({ ok: false, status: 404 });
  const res = await handleRequest(req, {}, { fetch: noScript });
  assert.strictEqual(res.status, 502);
});
