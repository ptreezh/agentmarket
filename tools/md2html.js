#!/usr/bin/env node
/**
 * md2html.js — deterministic Markdown → standalone HTML converter for GEO articles.
 * Converts docs/geo/*.md (public articles) into Pages-servable .html files.
 * Pages deploys docs/ as site root, so articles live at /geo/*.html.
 * Usage: node tools/md2html.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const GEO_DIR = "F:/market-repo-extracted/market-repo/docs/geo";
const BASE = "https://ptreezh.github.io/agentmarket/geo";
const SKIP = new Set(["SPEC-GEO-GROWTH-20260911.md"]);

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s) {
  s = s.replace(/`([^`]+)`/g, (_, c) => "<code>" + esc(c) + "</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => {
    const href = /^https?:/.test(u) ? u : (BASE + "/" + u);
    return '<a href="' + esc(href) + '">' + t + "</a>";
  });
  return s;
}

function parseTable(lines, i) {
  const rows = [];
  while (i < lines.length && lines[i].trim().startsWith("|")) {
    const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
    if (!cells.every(c => /^:?-{2,}:?$/.test(c))) rows.push(cells);
    i++;
  }
  let h = "<table>\n";
  if (rows.length) {
    h += "  <thead><tr>" + rows[0].map(c => "<th>" + inline(c) + "</th>").join("") + "</tr></thead>\n";
    h += "  <tbody>\n";
    for (let r = 1; r < rows.length; r++) {
      h += "    <tr>" + rows[r].map(c => "<td>" + inline(c) + "</td>").join("") + "</tr>\n";
    }
    h += "  </tbody>\n";
  }
  return [h + "</table>", i];
}

function md2html(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      out.push("<h" + lvl + ">" + inline(h[2]) + "</h" + lvl + ">");
      i++; continue;
    }
    if (t.startsWith("```")) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { buf.push(lines[i]); i++; }
      i++;
      out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>");
      continue;
    }
    if (t.startsWith("|")) {
      const [html, ni] = parseTable(lines, i);
      out.push(html); i = ni; continue;
    }
    if (t.startsWith(">")) {
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) { buf.push(lines[i].trim().replace(/^>\s?/, "")); i++; }
      out.push("<blockquote>" + inline(buf.join(" ")) + "</blockquote>");
      continue;
    }
    if (/^\s*[-*]\s+/.test(t)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i].trim())) { buf.push(inline(lines[i].trim().replace(/^\s*[-*]\s+/, ""))); i++; }
      out.push("<ul>" + buf.map(x => "<li>" + x + "</li>").join("") + "</ul>");
      continue;
    }
    if (/^\s*\d+\.\s+/.test(t)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i].trim())) { buf.push(inline(lines[i].trim().replace(/^\s*\d+\.\s+/, ""))); i++; }
      out.push("<ol>" + buf.map(x => "<li>" + x + "</li>").join("") + "</ol>");
      continue;
    }
    if (t === "---") { out.push("<hr>"); i++; continue; }
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" &&
           !/^(#{1,4})\s/.test(lines[i].trim()) && !lines[i].trim().startsWith("```") &&
           !lines[i].trim().startsWith("|") && !lines[i].trim().startsWith(">") &&
           !/^\s*[-*]\s+/.test(lines[i].trim()) && !/^\s*\d+\.\s+/.test(lines[i].trim())) {
      buf.push(lines[i]); i++;
    }
    out.push("<p>" + inline(buf.join(" ")) + "</p>");
  }
  return out.join("\n");
}

function render(name, md) {
  const titleMatch = md.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : name.replace(/-/g, " ");
  const firstP = md.replace(/^#.*$/m, "").match(/^\s*([^\n]+)/);
  const desc = firstP ? firstP[1].slice(0, 160) : title;
  const body = md2html(md);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | AgentBazaar</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${BASE}/${name.replace(/\.md$/, ".html")}">
<meta name="robots" content="index,follow">
<style>
body{font-family:Roboto,'PingFang SC','Segoe UI',Arial,sans-serif;line-height:1.6;color:#1A1B1C;max-width:860px;margin:0 auto;padding:24px 20px;background:#F4F3EE}
h1{font-size:26px}h2{font-size:20px;margin-top:28px}h3{font-size:16px}code{background:#E9E7E0;padding:2px 5px;border-radius:4px;font-size:14px}
pre{background:#1E1E1E;color:#E6E6E6;padding:14px;border-radius:8px;overflow-x:auto}pre code{background:none;color:inherit}
table{border-collapse:collapse;width:100%;margin:14px 0}th,td{border:1px solid #D5D2C8;padding:8px 10px;text-align:left;font-size:14px}th{background:#E9E7E0}
blockquote{border-left:4px solid #9EACEA;margin:14px 0;padding:6px 14px;background:#EFEEF8;color:#3A3B3F}
a{color:#4A5BC7}.foot{margin-top:40px;padding-top:14px;border-top:1px solid #D5D2C8;font-size:13px;color:#6B7280}
</style>
</head>
<body>
<article>
${body}
</article>
<div class="foot">AgentBazaar — open, zero-cost, Git-native AI agent gig marketplace.
<a href="https://ptreezh.github.io/agentmarket/">Market dashboard</a> · <a href="https://github.com/ptreezh/agentmarket">Repository</a></div>
</body>
</html>
`;
}

let n = 0;
for (const f of fs.readdirSync(GEO_DIR)) {
  if (!f.endsWith(".md") || SKIP.has(f)) continue;
  const md = fs.readFileSync(path.join(GEO_DIR, f), "utf8");
  const html = render(f, md);
  const out = path.join(GEO_DIR, f.replace(/\.md$/, ".html"));
  fs.writeFileSync(out, html, "utf8");
  console.log("OK " + f + " -> " + out.replace(/.*docs/, "docs") + " (" + html.length + " bytes)");
  n++;
}
console.log("TOTAL: " + n + " articles rendered");
