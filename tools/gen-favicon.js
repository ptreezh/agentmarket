#!/usr/bin/env node
/* 生成 favicon.ico（32×32 程序化像素 → PNG → ICO 容器，零依赖）· C2
 * 用法: node tools/gen-favicon.js [out.ico]
 * 图标: 深蓝底 + 白色市场 "A"（AgentBazaar 首字母）像素画
 */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = process.argv[2] || path.join(__dirname, "..", "docs", "favicon.ico");
const S = 32;

// 程序化像素：深蓝渐变底 + 白色 A（两像素宽的三角骨架）
function pixel(x, y) {
  // 背景：左上→右下深蓝渐变
  const t = (x + y) / (2 * (S - 1));
  let r = Math.round(30 + 50 * t), g = Math.round(70 + 60 * t), b = Math.round(120 + 80 * t), a = 255;
  // A 字形（居中，底边 y=26，顶点 (15,5)）：两笔 + 横杠
  const inA = (() => {
    const cx = 15.5;
    // 左笔：从 (cx-9, 26) 到 (cx, 5)；右笔：从 (cx, 5) 到 (cx+9, 26)
    const left = lineDist(x + 0.5, y + 0.5, cx - 9, 26, cx, 5);
    const right = lineDist(x + 0.5, y + 0.5, cx + 9, 26, cx, 5);
    if (Math.min(left, right) <= 1.4) return true;
    // 横杠：y=17~19，从 cx-5.5 到 cx+5.5
    if (y >= 16.5 && y <= 19.5 && Math.abs((x + 0.5) - cx) <= 5.5) return true;
    return false;
  })();
  if (inA) { r = 255; g = 255; b = 255; }
  return [r, g, b, a];
}
function lineDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// 构造 PNG（RGBA 32×32）
function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.alloc(S * (1 + S * 4));
for (let y = 0; y < S; y++) {
  raw[y * (1 + S * 4)] = 0;
  for (let x = 0; x < S; x++) {
    const [r, g, b, a] = pixel(x, y);
    const o = y * (1 + S * 4) + 1 + x * 4;
    raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
  }
}
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
]);

// ICO 容器（PNG 格式条目，Vista+ 支持）
const ico = Buffer.alloc(6 + 16 + png.length);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico[6] = S >= 256 ? 0 : S; ico[7] = S >= 256 ? 0 : S;
ico[8] = 0; ico[9] = 0;
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
png.copy(ico, 22);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, ico);
console.log(`✅ favicon.ico 已生成: ${OUT} (${ico.length} bytes)`);
