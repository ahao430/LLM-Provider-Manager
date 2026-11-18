#!/usr/bin/env node
/**
 * 刷新内置市场价格快照（src-tauri/src/market/data.json）。
 *
 * 用法：pnpm market:refresh
 *
 * 数据源：models.dev/api.json（官方第一方厂商、统一 USD / 百万 token）。
 * 与 App 内「抓取数据」按钮使用同一份白名单与映射规则
 * （见 src-tauri/src/market/fetch.rs），两端需保持一致。
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SOURCE_URL = "https://models.dev/api.json";

/** (models.dev id, 展示名, 区域) — 与 src-tauri/src/market/fetch.rs 的白名单一致 */
const PROVIDER_WHITELIST = [
  ["openai", "OpenAI", "global"],
  ["anthropic", "Anthropic", "global"],
  ["google", "Google Gemini", "global"],
  ["xai", "xAI", "global"],
  ["mistral", "Mistral", "global"],
  ["cohere", "Cohere", "global"],
  ["perplexity", "Perplexity", "global"],
  ["meta", "Meta (Llama)", "global"],
  ["deepseek", "DeepSeek", "cn"],
  ["alibaba", "阿里云百炼（通义千问）", "cn"],
  ["moonshotai", "月之暗面（Kimi）", "cn"],
  ["zhipuai", "智谱 AI（GLM）", "cn"],
  ["volcengine", "火山方舟（豆包）", "cn"],
  ["minimax", "MiniMax", "cn"],
  ["stepfun", "阶跃星辰", "cn"],
  ["xiaomi", "小米", "cn"],
];

const num = (cost, key) => {
  const v = cost?.[key];
  return typeof v === "number" ? v : null;
};

/** 与 Rust 端 classify 一致：输出图→图像；输入图→多模态；推理→决策；否则文本 */
function classify(model) {
  const out = model.modalities?.output ?? [];
  const inp = model.modalities?.input ?? [];
  if (out.includes("image")) return "image";
  if (inp.includes("image")) return "multimodal";
  if (model.reasoning === true) return "decision";
  return "text";
}

async function main() {
  console.log(`抓取 ${SOURCE_URL} …`);
  const res = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "LCM-market-refresh/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const root = await res.json();

  const now = new Date();
  const fetchedAt = now.toISOString();
  const providers = [];

  for (const [pid, display, region] of PROVIDER_WHITELIST) {
    const provider = root[pid];
    if (!provider) {
      console.warn(`  ⚠ 白名单厂商缺席：${pid}`);
      continue;
    }
    const models = [];
    for (const [mid, mv] of Object.entries(provider.models ?? {})) {
      const input = num(mv.cost, "input");
      const output = num(mv.cost, "output");
      if (input === null && output === null) continue; // 无价模型不进内置快照
      const cacheRead = num(mv.cost, "cache_read");
      models.push({
        model: mid,
        modelType: classify(mv),
        inputPer1m: input,
        cachedInputPer1m: cacheRead !== null && cacheRead > 0 ? cacheRead : null,
        outputPer1m: output,
        currency: "USD",
        note: null,
      });
    }
    if (models.length === 0) {
      console.warn(`  ⚠ ${pid} 无带价模型，跳过`);
      continue;
    }
    models.sort((a, b) => a.model.localeCompare(b.model));
    providers.push({
      id: pid,
      name: display,
      region,
      pricingUrl: provider.doc ?? SOURCE_URL,
      models,
    });
  }

  if (providers.length === 0) throw new Error("抓取结果为空");

  const snapshot = {
    // 内置快照：数据来源 models.dev，source 标记 bundled（应用内抓取的缓存标记 models.dev）
    snapshotDate: fetchedAt.slice(0, 7),
    source: "bundled",
    fetchedAt,
    providers,
  };

  const outPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src-tauri/src/market/data.json"
  );
  await writeFile(outPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

  const modelCount = providers.reduce((n, p) => n + p.models.length, 0);
  console.log(
    `✓ 已写入 ${path.relative(process.cwd(), outPath)}：${providers.length} 家厂商 / ${modelCount} 个模型（USD/百万 token，快照 ${snapshot.snapshotDate}）`
  );
}

main().catch((err) => {
  console.error(`刷新失败：${err}`);
  process.exit(1);
});
