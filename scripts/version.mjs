#!/usr/bin/env node
/**
 * 版本号同步脚本。
 *
 * 用法：node scripts/version.mjs 0.0.2
 *
 * 将 package.json / src-tauri/Cargo.toml / src-tauri/tauri.conf.json 的版本号
 * 统一设置为指定值。CHANGELOG.md 需要手工维护。
 *
 * 版本策略（见 AGENTS.md）：
 * - 每次改动：第三位 +1（patch）
 * - 较大改动：第二位 +1（minor）
 * - 第一位（major）：仅在用户明确要求时升级
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error("用法: node scripts/version.mjs <X.Y.Z>（例如 0.0.2）");
  process.exit(1);
}

function syncFile(name, update) {
  const filePath = path.join(rootDir, name);
  const before = fs.readFileSync(filePath, "utf8");
  const after = update(before);
  if (before === after) {
    console.log(`• ${name}: 未变化`);
    return;
  }
  fs.writeFileSync(filePath, after, "utf8");
  console.log(`✓ ${name}: -> ${newVersion}`);
}

// package.json
syncFile("package.json", (text) =>
  text.replace(/("version":\s*)"\d+\.\d+\.\d+"/, `$1"${newVersion}"`)
);

// src-tauri/Cargo.toml（仅 [package] 段的第一个 version 字段）
syncFile("src-tauri/Cargo.toml", (text) =>
  text.replace(/^version\s*=\s*"\d+\.\d+\.\d+"/m, `version = "${newVersion}"`)
);

// src-tauri/tauri.conf.json
syncFile("src-tauri/tauri.conf.json", (text) =>
  text.replace(/("version":\s*)"\d+\.\d+\.\d+"/, `$1"${newVersion}"`)
);

console.log(`\n版本已同步为 ${newVersion}。请记得更新 CHANGELOG.md。`);
