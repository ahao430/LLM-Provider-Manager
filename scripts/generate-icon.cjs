#!/usr/bin/env node
/**
 * 占位应用图标生成器（零依赖，Node 内置 zlib 手写 PNG）。
 *
 * 生成 1024x1024 的 LCM 占位图标到 src-tauri/icons/app-icon.png，
 * 之后运行 `cargo tauri icon`（或 `pnpm tauri icon`）派生全平台图标。
 *
 * 将来有正式品牌图标后可直接替换 app-icon.png 并重新派生，本脚本可删除。
 */
const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");

const W = 1024;
const H = 1024;

// ---------- 颜色 ----------
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

const BG_TOP = hex("#0b1220");
const BG_BOTTOM = hex("#1e293b");
const TILE_A = hex("#4f46e5"); // indigo
const TILE_B = hex("#7c3aed"); // violet
const WHITE = [248, 250, 252];

// ---------- 形状 ----------
function roundedRectSDF(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(dx, dy), 0) - r;
}

// "L" 字母由两根圆角条构成
function letterL(px, py) {
  const cx = W / 2;
  const cy = H / 2;
  const v = roundedRectSDF(px, py, cx - 62, cy, 34, 152, 16); // 竖条
  const h = roundedRectSDF(px, py, cx + 12, cy + 112, 108, 34, 16); // 横条
  return Math.min(v, h);
}

function sample(px, py) {
  // 背景：对角渐变
  const t = Math.min(1, Math.max(0, (px + py) / (W + H)));
  let color = mix(BG_TOP, BG_BOTTOM, t);

  // 中心圆角方块（indigo → violet 渐变）
  const tile = roundedRectSDF(px, py, W / 2, H / 2, 250, 250, 72);
  if (tile <= 0) {
    const g = Math.min(1, Math.max(0, (px - (W / 2 - 250)) / 500));
    color = mix(TILE_A, TILE_B, g);
  }

  // 字母 L（白色，带 4px 抗锯齿过渡）
  const d = letterL(px, py);
  if (d < 2) {
    const a = Math.min(1, Math.max(0, 1 - (d + 2) / 4));
    color = mix(color, WHITE, a);
  }
  return color;
}

// ---------- 2x2 超采样 ----------
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  const rowStart = y * (1 + W * 4);
  raw[rowStart] = 0; // filter: None
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const c = sample(x + ox, y + oy);
      r += c[0]; g += c[1]; b += c[2];
    }
    const i = rowStart + 1 + x * 4;
    raw[i] = Math.round(r / 4);
    raw[i + 1] = Math.round(g / 4);
    raw[i + 2] = Math.round(b / 4);
    raw[i + 3] = 255;
  }
}

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = path.join(__dirname, "..", "src-tauri", "icons");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "app-icon.png");
fs.writeFileSync(outFile, png);
console.log(`✓ 占位图标已生成: ${outFile} (${(png.length / 1024).toFixed(1)} KB)`);
console.log("  下一步: cargo tauri icon（派生全平台图标）");
