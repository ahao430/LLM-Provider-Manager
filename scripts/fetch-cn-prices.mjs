#!/usr/bin/env node
/**
 * 维护者侧脚本：抓取国内厂商官网价格页，生成/更新 src-tauri/src/market/data_cn.json。
 * 用法：pnpm market:cn-refresh
 *
 * 原则：
 * - models.dev 只有折算 USD；国内官方 CNY 价以此脚本为准（deepseek / 百炼 / 火山 /
 *   kimi / minimax / 硅基流动 为服务端渲染，可稳定解析）。
 * - 解析失败（JS 渲染 / 改版，如智谱、千问平台）的站点：保留 data_cn.json 旧值；
 *   首次生成时按实时汇率折算 models.dev 的 USD 价并在 note 标注「折算价」。
 * - 运行结果逐站报告；写入文件后需人工 review 再提交。
 */

import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src-tauri/src/market/data_cn.json");
const BASE = JSON.parse(await readFile(path.join(ROOT, "src-tauri/src/market/data.json"), "utf8"));

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 LCM-market-cn-refresh";

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** HTML → 纯文本（去脚本样式与标签、解码常用实体、压缩空白；剔除零宽空格——火山文档等站点大量使用）。 */
function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ");
}

async function fetchFx() {
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=CNY");
    const j = await r.json();
    return j?.rates?.CNY ?? null;
  } catch {
    return null;
  }
}

const round = (v) => Number(v.toFixed(4));
const firstHit = (map, key, val) => {
  if (!map.has(key)) map.set(key, val);
};

/** 从 models.dev 基础快照折算一个厂商（兜底路径）；filter 可筛模型子集。 */
function convertFromUsd(baseId, name, pricingUrl, rate, filter = null) {
  const base = BASE.providers.find((p) => p.id === baseId);
  if (!base) return null;
  return {
    id: baseId,
    name,
    region: "cn",
    pricingUrl,
    models: base.models
      .filter((m) => (filter ? filter(m.model) : true))
      .map((m) => ({
        model: m.model,
        modelType: m.modelType,
        inputPer1m: m.inputPer1m != null ? round(m.inputPer1m * rate) : null,
        cachedInputPer1m: m.cachedInputPer1m != null ? round(m.cachedInputPer1m * rate) : null,
        outputPer1m: m.outputPer1m != null ? round(m.outputPer1m * rate) : null,
        currency: "CNY",
        note: `折算价（models.dev USD × ${rate}），以官方价格页为准`,
      })),
  };
}

const guessType = (name, base) => {
  const n = name.toLowerCase();
  if (n.includes("image")) return "image";
  if (/vl|vision|omni|ocr/.test(n)) return "multimodal";
  const bm = base?.models.find((x) => x.model.toLowerCase().includes(n.split(/[./]/).pop()));
  return bm?.modelType ?? "text";
};

// ------------------------------------------------------------------
// 站点 handler：成功返回 models[]（CNY），抛错走兜底
// ------------------------------------------------------------------

/** DeepSeek：静态 Docusaurus 表格（含空闲/高峰分时段，已验证稳定）。 */
async function scrapeDeepseek() {
  const text = toText(await fetchText("https://api-docs.deepseek.com/zh-cn/quick_start/pricing/"));
  const rows = {};
  for (const [key, label] of [
    ["cacheHit", "百万tokens输入 （缓存命中）"],
    ["cacheMiss", "百万tokens输入 （缓存未命中）"],
    ["output", "百万tokens输出"],
  ]) {
    const m = text.match(
      new RegExp(
        `${label}\\s*空闲时段\\s*([\\d.]+)元\\s*([\\d.]+)元\\s*高峰时段\\s*([\\d.]+)元\\s*([\\d.]+)元`
      )
    );
    if (!m) throw new Error(`未匹配到 ${label} 行`);
    rows[key] = { idle: [Number(m[1]), Number(m[2])], peak: [Number(m[3]), Number(m[4])] };
  }
  const win = text.match(/空闲时段价格为高峰时段价格的一半。(.{0,120}?)为高峰时段/);
  const window = win
    ? `非高峰时段（工作日${win[1].trim()}为高峰；其余含周末/法定节假日为空闲，半价）`
    : "空闲时段半价（详见官方页）";
  const mk = (model, idx, type, note = null) => ({
    model,
    modelType: type,
    inputPer1m: rows.cacheMiss.peak[idx],
    cachedInputPer1m: rows.cacheHit.peak[idx],
    outputPer1m: rows.output.peak[idx],
    currency: "CNY",
    note,
    offPeak: {
      window,
      inputPer1m: rows.cacheMiss.idle[idx],
      cachedInputPer1m: rows.cacheHit.idle[idx],
      outputPer1m: rows.output.idle[idx],
    },
  });
  return [
    mk("deepseek-flash", 0, "multimodal"),
    mk("deepseek-v4-flash", 0, "multimodal", "旧模型名，由 Flash 提供服务并按 Flash 价计费"),
    mk("deepseek-v4-flash-vision-exp", 0, "multimodal", "旧模型名，由 Flash 提供服务并按 Flash 价计费"),
    mk("deepseek-v4-pro", 1, "decision"),
  ];
}

/** 阿里云百炼：服务端渲染大表。反向定位——每个「0<Token≤1M X元 Y元」价格向前找最近的 qwen 模型名。 */
async function scrapeBailian() {
  const text = toText(
    await fetchText("https://docs.bailian.console.aliyun.com/zh/model-studio/model-pricing")
  );
  const base = BASE.providers.find((p) => p.id === "alibaba");
  const found = new Map();
  const re = /0<Token≤1M\s*([\d.]+)元\s*([\d.]+)元/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 220), m.index);
    const names = before.match(/qwen[a-z0-9][a-z0-9.-]+/g);
    if (names) firstHit(found, names[names.length - 1], { input: Number(m[1]), output: Number(m[2]) });
  }
  if (found.size === 0) throw new Error("未匹配到 qwen 模型价格");
  return [...found.entries()].slice(0, 60).map(([name, p]) => ({
    model: name,
    modelType: guessType(name, base),
    inputPer1m: p.input,
    cachedInputPer1m: null,
    outputPer1m: p.output,
    currency: "CNY",
    note: "缓存命中另有折扣价，详见官方页",
  }));
}

/** Kimi（月之暗面）：文档为 JSX 编译产物，价格内联在 rows 数组（输入/输出/缓存 / MTok）。 */
async function scrapeKimi() {
  const html = await fetchText("https://platform.kimi.com/docs/pricing/chat");
  const found = new Map();
  const re = /children:`(kimi-[a-z0-9.-]+)`}\),`¥([\d.]+) \/ MTok`,`¥([\d.]+) \/ MTok`,`¥([\d.]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    firstHit(found, m[1], { input: Number(m[2]), output: Number(m[3]), cache: Number(m[4]) });
  }
  if (found.size === 0) throw new Error("未匹配到 kimi 模型价格（JSX 产物结构可能变化）");
  const base = BASE.providers.find((p) => p.id === "moonshotai");
  return [...found.entries()].map(([name, p]) => ({
    model: name,
    modelType: guessType(name, base),
    inputPer1m: p.input,
    cachedInputPer1m: p.cache,
    outputPer1m: p.output,
    currency: "CNY",
    note: null,
  }));
}

/** MiniMax 国内：服务端渲染。M3.1-Flash 单组三价；M3 为「标准 + 永久五折」双列。 */
async function scrapeMinimax() {
  const text = toText(await fetchText("https://platform.minimax.cn/docs/pricing/overview"));
  const models = [];
  const flash = text.match(/(MiniMax-M[\d.]+-Flash)\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (flash) {
    models.push({
      model: flash[1].toLowerCase(),
      modelType: "text",
      inputPer1m: Number(flash[2]),
      cachedInputPer1m: Number(flash[4]),
      outputPer1m: Number(flash[3]),
      currency: "CNY",
      note: null,
    });
  }
  // M3：≤512k 行，6 个数 = 输入/输出/缓存 的（标准、五折）两列；主价取五折（永久活动即实际价）
  const m3 = text.match(
    /(MiniMax-M3)\s*≤ 512k 输入 tokens\s*永久五折\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/
  );
  if (m3) {
    models.push({
      model: "minimax-m3",
      modelType: "text",
      inputPer1m: Number(m3[5]),
      cachedInputPer1m: Number(m3[7]),
      outputPer1m: Number(m3[6]),
      currency: "CNY",
      note: `永久五折后价格（标准价 ¥${m3[2]}/¥${m3[3]}/¥${m3[4]}）；>512k 输入另有阶梯价`,
    });
  }
  if (models.length === 0) throw new Error("未匹配到 MiniMax 文本模型价格");
  return models;
}

/** 火山方舟（豆包）：服务端渲染表格（含大量零宽空格，toText 已剔除）。
 * 列：输入(非音频) / 音频- / 缓存存储 / 缓存命中(非音频) / 音频- / 输出；取 [0, N] 首段。 */
async function scrapeVolcengine() {
  const text = toText(await fetchText("https://docs.volcengine.com/docs/ark/model-pricing?lang=zh"));
  const found = new Map();
  const re =
    /(doubao-[a-z0-9][a-z0-9.-]{2,60}?)\s*(?:输入长度\s*)?\[0, \d+\]\s*([\d.]+)\s*[-–]\s*([\d.]+)\s*([\d.]+)\s*([\d.]+)\s*[-–]\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    firstHit(found, m[1], {
      input: Number(m[2]),
      cacheStore: Number(m[3]),
      cacheHit: Number(m[4]),
      output: Number(m[5]),
    });
  }
  if (found.size === 0) throw new Error("未匹配到豆包模型价格");
  const base = BASE.providers.find((p) => p.id === "volcengine");
  return [...found.entries()].slice(0, 60).map(([name, p]) => ({
    model: name,
    modelType: guessType(name, base),
    inputPer1m: p.input,
    cachedInputPer1m: p.cacheHit,
    outputPer1m: p.output,
    currency: "CNY",
    note: "首个输入长度分段价格；另有空闲时段折扣，详见官方页",
  }));
}

/** 硅基流动（聚合中转）：两类块——含「费用发生时段」分时段（高峰 0-2/8-24，低谷 2-8）与无时段三连价。 */
async function scrapeSiliconflow() {
  const text = toText(await fetchText("https://www.siliconflow.cn/pricing"));
  const found = new Map();
  // 分时段块：显示名 + slug + 3~6 个「费用发生时段: … ¥价格」
  const reTimed =
    /([A-Za-z][\w.-]{2,60})\s+([a-z0-9-]+\/[A-Za-z0-9._-]+)\s+((?:费用发生时段:[^¥]*¥\s*[\d.]+\s*){3,6})/g;
  let m;
  while ((m = reTimed.exec(text)) !== null) {
    const prices = [...m[3].matchAll(/¥\s*([\d.]+)/g)].map((x) => Number(x[1]));
    if (prices.length >= 3) firstHit(found, m[2], prices);
  }
  // 无时段块：slug + ¥输入 ¥输出 ¥缓存
  const rePlain = /([a-z0-9-]+\/[A-Za-z0-9._-]{3,60})\s+¥\s*([\d.]+)\s+¥\s*([\d.]+)\s+¥\s*([\d.]+)/g;
  while ((m = rePlain.exec(text)) !== null) {
    firstHit(found, m[1], [Number(m[2]), Number(m[3]), Number(m[4])]);
  }
  if (found.size === 0) throw new Error("未匹配到硅基流动模型价格");
  const winPeak = "0点～2点 / 8点～24点";
  const winIdle = "2点～8点";
  return [...found.entries()].slice(0, 80).map(([slug, prices]) => {
    const hasOff = prices.length >= 6;
    return {
      model: slug,
      modelType: guessType(slug),
      inputPer1m: prices[0],
      cachedInputPer1m: prices[2],
      outputPer1m: prices[1],
      currency: "CNY",
      note: null,
      ...(hasOff
        ? {
            offPeak: {
              window: `低谷时段 ${winIdle}（高峰 ${winPeak}）`,
              inputPer1m: prices[3],
              cachedInputPer1m: prices[5],
              outputPer1m: prices[4],
            },
          }
        : {}),
    };
  });
}

// ------------------------------------------------------------------
// 站点配置
// ------------------------------------------------------------------

let FX = 7.2;
const SITES = [
  { id: "deepseek", name: "DeepSeek", pricingUrl: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/", scrape: scrapeDeepseek },
  { id: "alibaba", name: "阿里云百炼（通义千问）", pricingUrl: "https://docs.bailian.console.aliyun.com/zh/model-studio/model-pricing", scrape: scrapeBailian },
  { id: "moonshotai", name: "月之暗面（Kimi）", pricingUrl: "https://platform.kimi.com/docs/pricing/chat", scrape: scrapeKimi },
  { id: "volcengine", name: "火山方舟（豆包）", pricingUrl: "https://docs.volcengine.com/docs/ark/model-pricing?lang=zh", scrape: scrapeVolcengine },
  { id: "stepfun", name: "阶跃星辰", pricingUrl: "https://platform.stepfun.com/docs/pricing", scrape: null },
  { id: "xiaomi", name: "小米", pricingUrl: "https://developers.xiaoimi.com", scrape: null },
];

const DUAL = [
  { id: "minimax_cn", name: "MiniMax（国内）", pricingUrl: "https://platform.minimax.cn/docs/pricing/overview", baseId: "minimax", scrape: scrapeMinimax },
  { id: "zhipuai_cn", name: "智谱 AI（国内）", pricingUrl: "https://docs.bigmodel.cn/cn/guide/start/pricing", baseId: "zhipuai", scrape: null },
];

const PURE_ADDITIONS = [
  { id: "qianwen", name: "通义千问（千问平台）", pricingUrl: "https://platform.qianwenai.com/pricing/api", baseId: "alibaba", filter: (m) => m.startsWith("qwen") },
  { id: "siliconflow", name: "硅基流动（聚合中转）", pricingUrl: "https://www.siliconflow.cn/pricing", scrape: scrapeSiliconflow, baseId: null },
];

async function resolveSite(site, oldEntry) {
  if (site.scrape) {
    try {
      const models = await site.scrape();
      return {
        provider: { id: site.id, name: site.name, region: "cn", pricingUrl: site.pricingUrl, models },
        how: `官网抓取（${models.length} 个模型）`,
      };
    } catch (e) {
      console.log(`⚠ ${site.name} 抓取失败：${e.message}`);
    }
  }
  // 旧值若本身是折算价则直接重算（跟随最新汇率），官网抓来的旧值才保留
  const oldIsConverted = oldEntry?.models?.some?.((m) => m.note?.includes("折算价"));
  if (oldEntry && !oldIsConverted) return { provider: oldEntry, how: "保留旧值（本次未抓到）" };
  const baseId = site.baseId ?? site.id; // replacements 站点 id 即 models.dev base id
  if (baseId) {
    const conv = convertFromUsd(baseId, site.name, site.pricingUrl, FX, site.filter);
    if (conv) return { provider: { ...conv, id: site.id }, how: `折算兜底（× ${FX}）` };
  }
  return { provider: null, how: "跳过" };
}

async function main() {
  const liveFx = await fetchFx();
  if (liveFx) FX = liveFx;
  console.log(`汇率 USD→CNY：${liveFx ?? "获取失败，用默认 7.2"}`);

  let old = null;
  try {
    old = JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    /* 首次生成 */
  }

  const report = [];
  const replacements = {};
  for (const site of SITES) {
    const { provider, how } = await resolveSite(site, old?.replacements?.[site.id]);
    if (provider) {
      replacements[site.id] = provider;
      report.push(`✓ ${site.name}：${how}`);
    }
  }

  const additions = [];
  for (const site of DUAL) {
    const { provider, how } = await resolveSite(
      site,
      old?.additions?.find((p) => p.id === site.id)
    );
    if (provider) {
      additions.push(provider);
      report.push(`✓ ${site.name}：${how}`);
    }
  }
  for (const site of PURE_ADDITIONS) {
    const { provider, how } = await resolveSite(
      site,
      old?.additions?.find((p) => p.id === site.id)
    );
    if (provider) {
      additions.push(provider);
      report.push(`✓ ${site.name}：${how}`);
    }
  }

  const snapshot = {
    snapshotDate: new Date().toISOString().slice(0, 7),
    renames: { zhipuai: "智谱 Z.ai（海外）", minimax: "MiniMax（海外）" },
    replacements,
    additions,
  };
  await writeFile(OUT, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  console.log(report.join("\n"));
  console.log(
    `\n已写入 ${path.relative(ROOT, OUT)}（${Object.keys(replacements).length} 替换 + ${additions.length} 追加条），请人工核对后提交。`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
