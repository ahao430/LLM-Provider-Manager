import { Channel, invoke } from "@tauri-apps/api/core";

/** 应用基础信息（Tauri command: get_app_info） */
export interface AppInfo {
  name: string;
  version: string;
  dataDir: string;
}

/** 数据库表统计（Tauri command: get_database_stats） */
export interface TableStat {
  table: string;
  rows: number;
}

export function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("get_app_info");
}

export function getDatabaseStats(): Promise<TableStat[]> {
  return invoke<TableStat[]>("get_database_stats");
}

// ------------------------------------------------------------------
// 渠道管理
// ------------------------------------------------------------------

export type Protocol = "openai_chat" | "openai_responses" | "anthropic_messages";
export const PROTOCOL_LABELS: Record<Protocol, string> = {
  openai_chat: "OpenAI Chat Completions",
  openai_responses: "OpenAI Responses",
  anthropic_messages: "Anthropic Messages",
};

export interface ProviderRow {
  id: string;
  code: string;
  name: string;
  notes: string | null;
}

export interface ProviderTemplate {
  code: string;
  name: string;
  defaultBaseUrl: string;
  defaultProtocol: Protocol;
  note: string;
}

export interface ExternalLinkInput {
  label: string;
  url: string;
  kind: string;
}

export interface ChannelInput {
  name: string;
  providerId: string | null;
  /** 主地址（基础域名，不带 /v1） */
  chatBaseUrl: string;
  /** Chat Completions 专用地址（可空 = 主地址 + /v1） */
  chatCompletionsUrl?: string | null;
  anthropicBaseUrl: string | null;
  responsesBaseUrl: string | null;
  officialUrl: string | null;
  notes: string | null;
  primaryCredential: string | null;
  /** 归属分组 id（可空 = 未分组；空串按未分组处理） */
  groupId: string | null;
}

export interface ProtocolUrls {
  openaiChat: string;
  anthropicMessages: string;
  openaiResponses: string;
}

export interface ChannelRow {
  id: string;
  name: string;
  providerId: string | null;
  providerName: string | null;
  channelType: string;
  /** 兼容旧字段 = chatBaseUrl */
  baseUrl: string;
  chatBaseUrl: string;
  anthropicBaseUrl: string;
  responsesBaseUrl: string;
  /** Chat Completions 专用地址（空 = 主地址 + /v1） */
  chatCompletionsUrl: string;
  effectiveUrls: ProtocolUrls;
  enabled: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** 官网链接（未配置为 null） */
  officialUrl: string | null;
  hasPrimaryCredential: boolean;
  primaryCredentialMasked: string | null;
  /** 归属分组（可空 = 未分组） */
  groupId: string | null;
  groupName: string | null;
  /** 置顶到首页仪表盘 */
  dashboardPinned: boolean;
}

export interface ChannelGroupRow {
  id: string;
  name: string;
  createdAt: string;
}

export interface BalanceQuery {
  /** generic / new_api / aliyun_bss（由渠道服务商派生） */
  provider: string;
  path: string;
  jsonPath: string;
  /** NewAPI 用户 ID */
  userId: string;
  /** 余额币种（写快照用；旧配置缺省 CNY；new_api 固定 USD） */
  currency: string;
}

export interface ChannelDetail extends ChannelRow {
  tlsVerify: boolean;
  externalLinks: ExternalLinkInput[];
  balanceQuery: BalanceQuery | null;
}

export function listProviders(): Promise<ProviderRow[]> {
  return invoke<ProviderRow[]>("list_providers");
}

export function getProviderTemplates(): Promise<ProviderTemplate[]> {
  return invoke<ProviderTemplate[]>("provider_templates");
}

export function listChannels(): Promise<ChannelRow[]> {
  return invoke<ChannelRow[]>("list_channels");
}

export function getChannel(id: string): Promise<ChannelDetail> {
  return invoke<ChannelDetail>("get_channel", { id });
}

export function createChannel(input: ChannelInput): Promise<ChannelRow> {
  return invoke<ChannelRow>("create_channel", { input });
}

export function updateChannel(id: string, input: ChannelInput): Promise<ChannelRow> {
  return invoke<ChannelRow>("update_channel", { id, input });
}

export function deleteChannel(id: string): Promise<void> {
  return invoke<void>("delete_channel", { id });
}

export function setChannelEnabled(id: string, enabled: boolean): Promise<void> {
  return invoke<void>("set_channel_enabled", { id, enabled });
}

// ------------------------------------------------------------------
// 渠道分组与仪表盘置顶（v0.17.0）
// ------------------------------------------------------------------

export function listChannelGroups(): Promise<ChannelGroupRow[]> {
  return invoke<ChannelGroupRow[]>("list_channel_groups");
}

export function createChannelGroup(name: string): Promise<ChannelGroupRow> {
  return invoke<ChannelGroupRow>("create_channel_group", { name });
}

export function renameChannelGroup(id: string, name: string): Promise<ChannelGroupRow> {
  return invoke<ChannelGroupRow>("rename_channel_group", { id, name });
}

export function deleteChannelGroup(id: string): Promise<void> {
  return invoke<void>("delete_channel_group", { id });
}

export function setChannelDashboardPinned(id: string, pinned: boolean): Promise<void> {
  return invoke<void>("set_channel_dashboard_pinned", { id, pinned });
}

// ------------------------------------------------------------------
// 凭证（受控）
// ------------------------------------------------------------------

export type CredentialKind = "primary" | `header:${string}`;

export function setChannelCredential(channelId: string, kind: CredentialKind, value: string): Promise<void> {
  return invoke<void>("set_channel_credential", { channelId, kind, value });
}

export function revealChannelCredential(channelId: string, kind: CredentialKind): Promise<string | null> {
  return invoke<string | null>("reveal_channel_credential", { channelId, kind });
}

export function clearChannelCredential(channelId: string, kind: CredentialKind): Promise<void> {
  return invoke<void>("clear_channel_credential", { channelId, kind });
}

// ------------------------------------------------------------------
// Agent 兼容性
// ------------------------------------------------------------------

export type AgentCompatStatus = "supported" | "unsupported" | "unverified";

export interface AgentCompatRow {
  id: string;
  channelId: string;
  agent: string;
  status: AgentCompatStatus;
  evidence: string | null;
  testedAt: string | null;
  notes: string | null;
  updatedAt: string;
}

export function listAgentCompat(channelId: string): Promise<AgentCompatRow[]> {
  return invoke<AgentCompatRow[]>("list_agent_compat", { channelId });
}

export function upsertAgentCompat(
  channelId: string,
  agent: string,
  status: AgentCompatStatus,
  evidence: string | null,
  notes: string | null
): Promise<AgentCompatRow> {
  return invoke<AgentCompatRow>("upsert_agent_compat", { channelId, agent, status, evidence, notes });
}

// ------------------------------------------------------------------
// Agent 启动器
// ------------------------------------------------------------------

export type AgentType = "claude_code_cli" | "codex_cli";

export const AGENT_LABELS: Record<AgentType, string> = {
  claude_code_cli: "Claude Code CLI",
  codex_cli: "Codex CLI",
};

export interface LaunchRequest {
  agentType: AgentType;
  channelId: string;
  model: string | null;
  workingDirectory: string;
}

export interface LaunchOutcome {
  launchId: string;
  agentType: AgentType;
  launchMethod: string;
  baseUrl: string;
  model: string | null;
  processId: number;
  logFile: string;
  warnings: string[];
}

export interface AgentLaunchRow {
  launchId: string;
  agentType: string;
  channelId: string | null;
  channelName: string | null;
  workingDirectory: string | null;
  launchMethod: string;
  baseUrl: string | null;
  model: string | null;
  processId: number | null;
  startedAt: string;
  exitedAt: string | null;
}

export function launchAgent(req: LaunchRequest): Promise<LaunchOutcome> {
  return invoke<LaunchOutcome>("launch_agent", { req });
}

export function listAgentLaunches(limit?: number): Promise<AgentLaunchRow[]> {
  return invoke<AgentLaunchRow[]>("list_agent_launches", { limit: limit ?? 50 });
}

// ------------------------------------------------------------------
// 真实 Agent 探针（单次调用 claude / codex CLI）
// ------------------------------------------------------------------

export interface AgentProbeRequest {
  agentType: AgentType;
  channelId: string;
  model: string | null;
  workingDirectory: string;
  prompt: string;
  /** CLI 可执行文件路径覆盖（默认 PATH 查找；GUI 环境 PATH 可能不同） */
  binaryPath: string | null;
  /** 续接 claude 会话（--resume <id>）；null = 新会话 */
  sessionId: string | null;
  /** codex 续接最近线程（exec resume --last，实验特性） */
  resumeLast: boolean;
}

export interface AgentProbeOutcome {
  launchId: string;
  agentType: AgentType;
  launchMethod: string;
  /** success / exit_error / timeout / spawn_error */
  status: string;
  exitCode: number | null;
  /** Agent 回复正文（claude 取 JSON result 字段；codex 取 stdout 原文） */
  result: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  warnings: string[];
  logFile: string;
  /** claude --output-format json 补充信息 */
  sessionId: string | null;
  agentDurationMs: number | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** 真实 Agent 单次调用：spawn 真实 CLI 进程收集输出（最长 10 分钟）。 */
export function runAgentProbe(req: AgentProbeRequest): Promise<AgentProbeOutcome> {
  return invoke<AgentProbeOutcome>("run_agent_probe", { req });
}

/**
 * 复制 Claude Code 终端启动命令（渠道 env 注入转单行 shell 命令，仅进剪贴板）。
 * Codex 不支持：依赖 CODEX_HOME 配置目录，无法单行命令表达。
 */
export function copyAgentCliCommand(channelId: string, model: string | null): Promise<string> {
  return invoke<string>("copy_agent_cli_command", { channelId, model });
}

// ------------------------------------------------------------------
// 凭证一览 / 批量导出（用户显式触发的明文操作）
// ------------------------------------------------------------------

export interface ChannelCredentialRow {
  channelId: string;
  channelName: string;
  providerName: string | null;
  baseUrl: string;
  /** 主凭证明文（未配置渠道为空串） */
  token: string;
}

export function listChannelCredentials(): Promise<ChannelCredentialRow[]> {
  return invoke<ChannelCredentialRow[]>("list_channel_credentials");
}

/** 导出全部渠道凭证到指定路径（csv / xlsx），返回导出条数。 */
export function exportChannelCredentials(path: string, format: "csv" | "xlsx"): Promise<number> {
  return invoke<number>("export_channel_credentials", { path, format });
}

// ------------------------------------------------------------------
// 画图历史（v0.22.0：历史面板，点击回填表单）
// ------------------------------------------------------------------

export interface ImageHistoryRow {
  traceId: string;
  /** image_generation / image_edit */
  requestType: string;
  status: string;
  channelId: string | null;
  channelName: string | null;
  model: string | null;
  createdAt: string;
  prompt: string | null;
  size: string | null;
  n: number | null;
  responseFormat: string | null;
  /** 首张归档图相对路径（readArchivedImage 加载缩略图） */
  firstImagePath: string | null;
  /** url 形态首图（不自动下载） */
  firstImageUrl: string | null;
}

export function listImageHistory(limit?: number): Promise<ImageHistoryRow[]> {
  return invoke<ImageHistoryRow[]>("list_image_history", { limit: limit ?? 50 });
}

// ------------------------------------------------------------------
// 模型与价格（Phase 2）
// ------------------------------------------------------------------

export type CapabilityStatus = "supported" | "unsupported" | "unknown";

export interface GlobalModelRow {
  id: string;
  name: string;
  family: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  channelModelCount: number;
}

export type ModelType = "multimodal" | "image" | "text" | "reasoning" | "decision";

export const MODEL_TYPE_LABELS: Record<ModelType, string> = {
  multimodal: "多模态",
  image: "图像",
  text: "文本",
  reasoning: "推理",
  decision: "决策",
};

export interface ChannelModelRow {
  id: string;
  channelId: string;
  modelId: string;
  modelName: string | null;
  actualModelId: string;
  protocol: Protocol;
  modelType: ModelType;
  enabled: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** 标注价格（每百万 token；null = 未标注）。仅展示比较用，不参与费用估算。 */
  priceInputPer1m: number | null;
  priceOutputPer1m: number | null;
  /** 空字符串 = 未标注 */
  priceCurrency: string;
  /** 倍率：实际价 = 原价 × 倍率（1.0 = 原价） */
  priceMultiplier: number;
  /** 阶梯价（upTo = 累计输入 token 上限，单位百万；null = 无上限最后一档） */
  priceTiers: PriceTier[] | null;
  /** 分时段（低谷）价 */
  priceOffPeak: PriceOffPeak | null;
}

/** 阶梯价一档（与市场价统一格式）。 */
export interface PriceTier {
  upTo: number | null;
  input: number | null;
  output: number | null;
}

/** 分时段（低谷）价。 */
export interface PriceOffPeak {
  window: string;
  input: number | null;
  output: number | null;
}

export interface ChannelModelInput {
  id: string | null;
  channelId: string;
  modelId: string;
  actualModelId: string;
  protocol: Protocol;
  modelType: ModelType | null;
  notes: string | null;
  enabled: boolean | null;
  /** 标注价格：整行覆盖保存，编辑其他字段时须回传现有值 */
  priceInputPer1m: number | null;
  priceOutputPer1m: number | null;
  priceCurrency: string | null;
  /** 倍率（null/缺省 = 按 1.0 处理） */
  priceMultiplier?: number | null;
  priceTiers?: PriceTier[] | null;
  priceOffPeak?: PriceOffPeak | null;
}

export interface RemoteModel {
  id: string;
  displayName: string | null;
}

/** 全渠道模型视图行（模型列表页按模型聚合用）。 */
export interface AllChannelModelRow {
  id: string;
  channelId: string;
  channelName: string;
  channelEnabled: boolean;
  modelId: string;
  actualModelId: string;
  protocol: Protocol;
  modelType: ModelType;
  enabled: boolean;
  priceInputPer1m: number | null;
  priceOutputPer1m: number | null;
  priceCurrency: string;
  priceMultiplier: number;
  priceTiers: PriceTier[] | null;
  priceOffPeak: PriceOffPeak | null;
}

export interface RemoteModelList {
  channelId: string;
  url: string;
  httpStatus: number;
  models: RemoteModel[];
  note: string | null;
}

export interface ImportItem {
  actualModelId: string;
}

export interface ImportOutcome {
  created: string[];
  skipped: { actualModelId: string; reason: string }[];
}

export interface ModelPriceRow {
  id: string;
  channelModelId: string;
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
  imagePrice: number | null;
  otherUsagePrice: number | null;
  currency: string;
  pricingUnit: string;
  discountPercent: number | null;
  effectiveDate: string;
  notes: string | null;
  createdAt: string;
}

export interface AddPriceInput {
  channelModelId: string;
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
  imagePrice: number | null;
  otherUsagePrice: number | null;
  currency: string;
  pricingUnit: string;
  discountPercent: number | null;
  effectiveDate: string;
  notes: string | null;
}

export interface DiscountedPrices {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  image: number | null;
  otherUsage: number | null;
}

export interface EffectivePrice extends ModelPriceRow {
  discounted: DiscountedPrices;
}

export function listGlobalModels(): Promise<GlobalModelRow[]> {
  return invoke<GlobalModelRow[]>("list_global_models");
}

export function createGlobalModel(name: string, family: string | null): Promise<GlobalModelRow> {
  return invoke<GlobalModelRow>("create_global_model", { name, family });
}

export function renameGlobalModel(id: string, name: string, family: string | null): Promise<void> {
  return invoke<void>("rename_global_model", { id, name, family });
}

export function deleteGlobalModel(id: string): Promise<void> {
  return invoke<void>("delete_global_model", { id });
}

export function listChannelModels(channelId: string): Promise<ChannelModelRow[]> {
  return invoke<ChannelModelRow[]>("list_channel_models", { channelId });
}

export function upsertChannelModel(input: ChannelModelInput): Promise<ChannelModelRow> {
  return invoke<ChannelModelRow>("upsert_channel_model", { input });
}

export function deleteChannelModel(id: string): Promise<void> {
  return invoke<void>("delete_channel_model", { id });
}

export function listAllChannelModels(): Promise<AllChannelModelRow[]> {
  return invoke<AllChannelModelRow[]>("list_all_channel_models");
}

export function fetchChannelModelList(channelId: string): Promise<RemoteModelList> {
  return invoke<RemoteModelList>("fetch_channel_model_list", { channelId });
}

export function importChannelModels(
  channelId: string,
  items: ImportItem[]
): Promise<ImportOutcome> {
  return invoke<ImportOutcome>("import_channel_models", { channelId, items });
}

/** 接口类型默认规则（与后端 default_protocol_for 一致）：claude → Anthropic，否则 Chat Completions。 */
export function defaultProtocolFor(modelId: string): Protocol {
  return modelId.toLowerCase().includes("claude") ? "anthropic_messages" : "openai_chat";
}

/** 类型默认规则（与后端 default_model_type_for 一致）：图像 / 多模态命名推断，其余默认文本。 */
export function defaultModelTypeFor(modelId: string): ModelType {
  const name = modelId.trim().toLowerCase();
  const IMAGE_MARKERS = [
    "image",
    "dall-e",
    "seedream",
    "seededit",
    "cogview",
    "wanx",
    "flux",
    "stable-diffusion",
  ];
  // 多模态家族与视觉系命名（Claude 3+ 全系、Gemini 全系、GPT-4o/4.1/4-turbo/5 系、OpenAI o 系）
  const VISION_MARKERS = [
    "omni",
    "vision",
    "-vl",
    "vl-",
    "qvq",
    "4o",
    "claude",
    "gemini",
    "gpt-4.1",
    "gpt-4-turbo",
    "gpt-5",
  ];
  // 用户指定的已知多模态型号（精确匹配）
  const KNOWN_MULTIMODAL = ["deepseek-v4.1-flash", "glm-5.3-flash"];
  if (IMAGE_MARKERS.some((m) => name.includes(m))) return "image";
  if (
    VISION_MARKERS.some((m) => name.includes(m)) ||
    KNOWN_MULTIMODAL.includes(name) ||
    name.startsWith("o1") ||
    name.startsWith("o3") ||
    name.startsWith("o4")
  ) {
    return "multimodal";
  }
  return "text";
}

export function listModelPrices(channelModelId: string): Promise<ModelPriceRow[]> {
  return invoke<ModelPriceRow[]>("list_model_prices", { channelModelId });
}

export function getEffectivePrice(channelModelId: string): Promise<EffectivePrice | null> {
  return invoke<EffectivePrice | null>("get_effective_price", { channelModelId });
}

export function addModelPrice(input: AddPriceInput): Promise<string> {
  return invoke<string>("add_model_price", { input });
}

export function deleteModelPrice(id: string): Promise<void> {
  return invoke<void>("delete_model_price", { id });
}

// ------------------------------------------------------------------
// API 测试工作台（Phase 3）
// ------------------------------------------------------------------

export interface ApiTestMessagePayload {
  role: string;
  content: string;
}

export interface ApiTestRequestPayload {
  channelId: string;
  channelModelId: string | null;
  model: string;
  protocol: Protocol;
  stream: boolean;
  system: string | null;
  messages: ApiTestMessagePayload[];
  params: {
    temperature: number | null;
    topP: number | null;
    maxTokens: number | null;
    stop: string[];
  };
  extraBody: unknown | null;
  customHeaders: [string, string][];
  customQuery: [string, string][];
  rawJson: unknown | null;
}

export type ApiTestStreamEvent =
  | { type: "delta"; index: number; delta: string; rawBlock: string }
  | { type: "status"; message: string };

export interface ToolCallPreview {
  id: string | null;
  name: string | null;
  arguments: string;
}

export interface UsagePreview {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
}

export interface ResponsePreview {
  text: string;
  thinking: string;
  toolCalls: ToolCallPreview[];
  finish: string | null;
  usage: UsagePreview | null;
  providerRequestId: string | null;
  error: unknown | null;
}

export interface TestRunResult {
  traceId: string;
  status: string;
  httpStatus: number | null;
  preview: ResponsePreview;
  requestRef: string | null;
  responseRef: string | null;
  ttfbMs: number | null;
  ttftMs: number | null;
  durationMs: number | null;
  tokensPerSecond: number | null;
  warnings: string[];
}

export interface RequestRecordRow {
  traceId: string;
  parentTraceId: string | null;
  channelId: string | null;
  channelName: string | null;
  channelModelId: string | null;
  model: string | null;
  protocol: string | null;
  requestType: string | null;
  status: string;
  requestRef: string | null;
  responseRef: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  providerRequestId: string | null;
  httpStatus: number | null;
  ttfbMs: number | null;
  ttftMs: number | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheTokens: number | null;
  tokensPerSecond: number | null;
  createdAt: string;
  completedAt: string | null;
  /** Agent 探针所属会话 id（多轮续接合并展示用）；其余请求类型为 null */
  sessionId: string | null;
}

export interface ProcessingEventRow {
  eventId: string;
  traceId: string;
  stage: string;
  operation: string;
  status: string;
  changed: boolean;
  description: string | null;
  metadataJson: string | null;
  createdAt: string;
}

export interface TestRecordDetail extends RequestRecordRow {
  processingEvents: ProcessingEventRow[];
}

function tauriChannel(onEvent: (event: ApiTestStreamEvent) => void): unknown {
  const channel = new Channel<ApiTestStreamEvent>();
  channel.onmessage = onEvent;
  return channel;
}

export function sendTestRequest(req: ApiTestRequestPayload): Promise<TestRunResult> {
  return invoke<TestRunResult>("send_test_request", { req });
}

export async function sendTestStream(
  req: ApiTestRequestPayload,
  onEvent?: (event: ApiTestStreamEvent) => void
): Promise<TestRunResult> {
  const onEventChannel = onEvent ? await tauriChannel(onEvent) : undefined;
  return invoke<TestRunResult>("send_test_stream", { req, onEvent: onEventChannel });
}

export function listTestRecords(limit?: number): Promise<RequestRecordRow[]> {
  return invoke<RequestRecordRow[]>("list_test_records", { limit: limit ?? 100 });
}

export function getTestRecord(traceId: string): Promise<TestRecordDetail> {
  return invoke<TestRecordDetail>("get_test_record", { traceId });
}

export function getTestRaw(traceId: string, kind: "request" | "response"): Promise<string> {
  return invoke<string>("get_test_raw", { traceId, kind });
}

/** 以 curl 命令复制测试请求（含真实凭证，仅进剪贴板；仅 API 测试记录支持）。 */
export function copyTestCurl(traceId: string): Promise<string> {
  return invoke<string>("copy_test_curl", { traceId });
}

/** 知识条目（诊断命中时返回）。 */
export interface DiagnosisMatched {
  id: string;
  errorType: string;
  title: string;
  /** 事实：从错误记录中观察到的东西 */
  facts: string;
  /** 建议：推测性内容，LCM 不会自动执行 */
  advice: string;
}

/** 多层网关归因：错误出自中转网关 / 上游厂商的规则式判定（事实与推测分开）。 */
export interface Attribution {
  /** gateway（中转网关层）/ upstream（上游厂商）/ unknown */
  layer: "gateway" | "upstream" | "unknown";
  confidence: "confirmed" | "probable" | "unknown";
  /** 观察到的事实（命中特征串、上游请求 ID 有无） */
  facts: string[];
  /** 推测（仅供参考） */
  speculation: string;
  /** 命中的网关类型提示（如 NewAPI / OneAPI 系中转） */
  gatewayHint: string | null;
}

/** 诊断结果：事实（evidence / facts）与建议分开，置信度必填。 */
export interface Diagnosis {
  traceId: string;
  status: string;
  confidence: "confirmed" | "probable" | "unknown";
  /** 命中依据 */
  evidence: string;
  matched: DiagnosisMatched | null;
  advice: string;
  failedEvents: string[];
  /** 多层网关归因 */
  attribution: Attribution;
}

/** 对测试记录做知识库诊断（只读，不自动执行建议）。 */
export function diagnoseRequest(traceId: string): Promise<Diagnosis> {
  return invoke<Diagnosis>("diagnose_request", { traceId });
}

export function reparseTestResponse(traceId: string): Promise<ResponsePreview> {
  return invoke<ResponsePreview>("reparse_test_response", { traceId });
}

// ------------------------------------------------------------------
// Dashboard 与重放（Phase 5）
// ------------------------------------------------------------------

export interface CurrencyAmount {
  currency: string;
  amount: number;
}

export interface MonthRequests {
  month: string;
  total: number;
  success: number;
}

export interface MonthCost {
  month: string;
  currency: string;
  amount: number;
}

export interface DashboardStats {
  channelTotal: number;
  channelEnabled: number;
  globalModels: number;
  channelModels: number;
  requests: { total: number; success: number; failed: number; pending: number };
  tokensInput: number;
  tokensOutput: number;
  tokensCache: number;
  estimatedCosts: CurrencyAmount[];
  rechargeTotals: CurrencyAmount[];
  rechargeCount: number;
  billTotals: CurrencyAmount[];
  monthlyRequests: MonthRequests[];
  monthlyCosts: MonthCost[];
  recentRequests: RequestRecordRow[];
  recentErrors: RequestRecordRow[];
}

export function getDashboardStats(): Promise<DashboardStats> {
  return invoke<DashboardStats>("get_dashboard_stats");
}

export function replayTestRequest(traceId: string): Promise<TestRunResult> {
  return invoke<TestRunResult>("replay_test_request", { traceId });
}

// ------------------------------------------------------------------
// 画图工作台（Phase 4）
// ------------------------------------------------------------------

export interface ImageGenRequestPayload {
  channelId: string;
  model: string;
  prompt: string;
  size: string | null;
  n: number | null;
  responseFormat: string | null;
  extraBody: unknown | null;
  customHeaders: [string, string][];
}

export interface ArchivedImage {
  filePath: string | null;
  url: string | null;
  revisedPrompt: string | null;
}

export interface ImageGenResult {
  traceId: string;
  status: string;
  httpStatus: number | null;
  images: ArchivedImage[];
  error: unknown | null;
  rawResponseRef: string | null;
  usageNote: string | null;
}

export interface VisionImagePayload {
  /** url | base64 */
  kind: string;
  /** url 地址或纯 base64（无 data: 前缀） */
  value: string;
  mediaType: string | null;
}

export interface VisionRequestPayload {
  channelId: string;
  model: string;
  protocol: "openai_chat" | "anthropic_messages";
  system: string | null;
  text: string;
  images: VisionImagePayload[];
  maxTokens: number | null;
  customHeaders: [string, string][];
}

export function generateImage(req: ImageGenRequestPayload): Promise<ImageGenResult> {
  return invoke<ImageGenResult>("generate_image", { req });
}

export function sendVisionRequest(req: VisionRequestPayload): Promise<TestRunResultShape> {
  return invoke<TestRunResultShape>("send_vision_request", { req });
}

export function readArchivedImage(relPath: string): Promise<string> {
  return invoke<string>("read_archived_image", { relPath });
}

// ------------------------------------------------------------------
// 资金与账单（Phase 6）
// ------------------------------------------------------------------

export interface RechargeRow {
  id: string;
  channelId: string;
  channelName: string | null;
  amount: number;
  currency: string;
  paymentMethod: string | null;
  transactionId: string | null;
  rechargedAt: string;
  notes: string | null;
  createdAt: string;
}

export interface RechargeInput {
  channelId: string;
  amount: number;
  currency: string;
  paymentMethod: string | null;
  transactionId: string | null;
  rechargedAt: string;
  notes: string | null;
}

export interface BillRow {
  id: string;
  channelId: string;
  channelName: string | null;
  billingPeriod: string;
  amount: number;
  currency: string;
  source: string;
  notes: string | null;
  createdAt: string;
}

export interface BalanceSnapshotRow {
  id: string;
  channelId: string;
  channelName: string | null;
  balance: number;
  currency: string;
  capturedAt: string;
  notes: string | null;
  createdAt: string;
}

export interface CurrencyAmount {
  currency: string;
  amount: number;
}

export interface ChannelFunds {
  rechargeTotals: CurrencyAmount[];
  rechargeCount: number;
  billTotals: CurrencyAmount[];
  estimatedBalance: { currency: string; amount: number }[];
  latestBalanceSnapshots: BalanceSnapshotRow[];
}

export function listRecharges(channelId?: string): Promise<RechargeRow[]> {
  return invoke<RechargeRow[]>("list_recharges", { channelId: channelId ?? null });
}

export function addRecharge(input: RechargeInput): Promise<string> {
  return invoke<string>("add_recharge", { input });
}

export function updateRecharge(id: string, input: RechargeInput): Promise<void> {
  return invoke<void>("update_recharge", { id, input });
}

export function deleteRecharge(id: string): Promise<void> {
  return invoke<void>("delete_recharge", { id });
}

export function listBills(channelId?: string): Promise<BillRow[]> {
  return invoke<BillRow[]>("list_bills", { channelId: channelId ?? null });
}

export function addBill(params: {
  channelId: string;
  billingPeriod: string;
  amount: number;
  currency: string;
  source: string | null;
  notes: string | null;
}): Promise<string> {
  return invoke<string>("add_bill", params);
}

export function deleteBill(id: string): Promise<void> {
  return invoke<void>("delete_bill", { id });
}

/** 账单文件导入结果（逐行写入：重复跳过、失败行不中断整体）。 */
export interface BillImportReport {
  total: number;
  created: number;
  skipped: number;
  failed: { row: number; reason: string }[];
  /** csv_import / excel_import */
  source: string;
}

/** 从 CSV / Excel 导入供应商账单（列序：账期 YYYY-MM、金额、币种、备注）。 */
export function importBillsFromFile(channelId: string, path: string): Promise<BillImportReport> {
  return invoke<BillImportReport>("import_bills_from_file", { channelId, path });
}

export function listBalanceSnapshots(channelId?: string): Promise<BalanceSnapshotRow[]> {
  return invoke<BalanceSnapshotRow[]>("list_balance_snapshots", { channelId: channelId ?? null });
}

export function addBalanceSnapshot(params: {
  channelId: string;
  balance: number;
  currency: string;
  capturedAt: string;
  notes: string | null;
}): Promise<string> {
  return invoke<string>("add_balance_snapshot", params);
}

export function deleteBalanceSnapshot(id: string): Promise<void> {
  return invoke<void>("delete_balance_snapshot", { id });
}

export function getChannelFunds(channelId: string): Promise<ChannelFunds> {
  return invoke<ChannelFunds>("get_channel_funds", { channelId });
}

// ------------------------------------------------------------------
// 备份与维护（Phase 7）
// ------------------------------------------------------------------

export interface BackupSummary {
  filePath: string;
  bytes: number;
  archivedFiles: number;
  includesCredentials: boolean;
}

export interface RestoreSummary {
  restoredDb: boolean;
  restoredFiles: number;
  restoredCredentials: number;
  credentialErrors: string[];
  preRestoreBackupDir: string;
  restartRequired: boolean;
}

export interface ConsistencyReport {
  archiveFiles: number;
  referencedFiles: number;
  missingFiles: string[];
  orphanFiles: string[];
  orphanBytes: number;
}

export interface CleanupSummary {
  deletedRecords: number;
  deletedFiles: number;
  before: string;
}

export function createBackup(params: {
  targetPath: string;
  password: string;
  includeCredentials: boolean;
}): Promise<BackupSummary> {
  return invoke<BackupSummary>("create_backup", params);
}

export function restoreBackup(params: {
  backupPath: string;
  password: string;
}): Promise<RestoreSummary> {
  return invoke<RestoreSummary>("restore_backup", params);
}

export function checkArchiveConsistency(): Promise<ConsistencyReport> {
  return invoke<ConsistencyReport>("check_archive_consistency");
}

export function cleanupOldData(before: string): Promise<CleanupSummary> {
  return invoke<CleanupSummary>("cleanup_old_data", { before });
}

type TestRunResultShape = {
  traceId: string;
  status: string;
  httpStatus: number | null;
  preview: ResponsePreview;
};

// ------------------------------------------------------------------
// 快速测试 / 图片编辑 / 余额查询
// ------------------------------------------------------------------

export interface QuickTestResult {
  traceId: string;
  text: string;
  status: string;
  httpStatus: number | null;
  usage: UsagePreview | null;
}

export function quickTestChannel(
  channelId: string,
  protocol: Protocol,
  model?: string
): Promise<QuickTestResult> {
  return invoke<QuickTestResult>("quick_test_channel", {
    channelId,
    protocol,
    model: model ?? null,
  });
}

/** 复制渠道主凭证到系统剪贴板（后端 keyring 读取，明文不进 UI）。 */
export function copyChannelCredential(channelId: string): Promise<void> {
  return invoke<void>("copy_channel_credential", { channelId });
}

export interface ImageEditRequestPayload {
  channelId: string;
  model: string;
  prompt: string;
  imageBase64: string;
  imageMime: string;
  maskBase64: string | null;
  size: string | null;
  n: number | null;
}

export function editImage(req: ImageEditRequestPayload): Promise<ImageGenResult> {
  return invoke<ImageGenResult>("edit_image", { req });
}

/** 余额查询配置输入。查询方式不在此选择，由渠道服务商派生；凭证 Some("")=清除 / null=不变。 */
export interface SetBalanceQueryInput {
  path: string;
  jsonPath: string;
  currency?: string;
  /** NewAPI 用户 ID */
  userId?: string | null;
  billingAccessKeyId?: string | null;
  billingAccessKeySecret?: string | null;
  /** NewAPI 系统访问令牌 */
  billingSystemToken?: string | null;
}

export function setBalanceQuery(
  channelId: string,
  input: SetBalanceQueryInput
): Promise<void> {
  return invoke<void>("set_balance_query", { channelId, input });
}

export interface BalanceResult {
  url: string;
  httpStatus: number | null;
  jsonPath: string;
  value: unknown;
  rawSnippet: string | null;
  /** 本次查询是否已写入余额快照（refresh 时为 true） */
  savedSnapshot: boolean;
  /** 写入快照的币种 */
  currency: string | null;
}

/** 查询并保存余额（渠道列表「查询」按钮）：数值可解析时写入余额快照。 */
export function refreshChannelBalance(channelId: string): Promise<BalanceResult> {
  return invoke<BalanceResult>("refresh_channel_balance", { channelId });
}

/** 各渠道最近一次余额快照。 */
export interface LatestBalanceRow {
  channelId: string;
  balance: number;
  currency: string;
  capturedAt: string;
}

export function listLatestBalances(): Promise<LatestBalanceRow[]> {
  return invoke<LatestBalanceRow[]>("list_latest_balances");
}

// ------------------------------------------------------------------
// 百炼（阿里云费用中心）余额与账单
// ------------------------------------------------------------------

export interface BailianTransaction {
  transactionTime: string;
  transactionType: string;
  /** 原始金额字符串（消费为负、充值为正） */
  amount: string;
  fundType: string;
  remarks: string;
}

export interface BailianTransactions {
  accountName: string;
  transactions: BailianTransaction[];
  nextToken: string;
  totalCount: number;
}

export interface MonthlyBill {
  billingPeriod: string;
  amount: number;
  count: number;
}

/** 查询百炼收支明细（start/end 为 YYYY-MM-DD；nextToken 翻页）。 */
export function queryBailianTransactions(
  channelId: string,
  start: string,
  end: string,
  nextToken?: string
): Promise<BailianTransactions> {
  return invoke<BailianTransactions>("query_bailian_transactions", {
    channelId,
    start,
    end,
    nextToken: nextToken ?? null,
  });
}

/** 把收支明细按月汇总导入账单（source=aliyun_bss，同渠道同账期覆盖替换）。 */
export function importBailianBills(
  channelId: string,
  currency: string,
  transactions: { transactionTime: string; amount: string }[]
): Promise<MonthlyBill[]> {
  return invoke<MonthlyBill[]>("import_bailian_bills", {
    channelId,
    currency,
    transactions,
  });
}

/** 每个 (渠道, 模型) 最近一次测试（模型列表 / 渠道管理展示）。 */
export interface LatestModelTestRow {
  channelId: string;
  model: string;
  traceId: string;
  status: string;
  createdAt: string;
  /** 首字时间；未产生首 Token 时为 null */
  ttftMs: number | null;
  /** 总耗时；请求未走完时为 null */
  durationMs: number | null;
  /** 失败原因摘要；仅少数场景非空，详情以测试记录为准 */
  errorMessage: string | null;
}

export function listLatestModelTests(): Promise<LatestModelTestRow[]> {
  return invoke<LatestModelTestRow[]>("list_latest_model_tests");
}

export function queryChannelBalance(channelId: string): Promise<BalanceResult> {
  return invoke<BalanceResult>("query_channel_balance", { channelId });
}

// ------------------------------------------------------------------
// 更新（检测与一键安装均走 updater 插件，见 lib/updater.ts）
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// 市场信息（内置价格快照 + 渠道标注价对比）
// ------------------------------------------------------------------

/** 低谷（分时段）折扣价，与主价同币种。 */
export interface MarketOffPeak {
  window: string;
  inputPer1m: number | null;
  cachedInputPer1m: number | null;
  outputPer1m: number | null;
}

export interface MarketModel {
  model: string;
  modelType: ModelType;
  inputPer1m: number | null;
  cachedInputPer1m: number | null;
  outputPer1m: number | null;
  currency: string;
  note: string | null;
  /** 低谷时段价（deepseek / 智谱 / 硅基流动等分时段计费）；无则 null */
  offPeak: MarketOffPeak | null;
}

export interface MarketProvider {
  id: string;
  name: string;
  /** global / cn */
  region: string;
  pricingUrl: string;
  models: MarketModel[];
}

export interface MarketSnapshot {
  snapshotDate: string;
  /** bundled（内置快照）或 models.dev（应用内抓取） */
  source: string;
  /** 抓取/生成时间（RFC3339） */
  fetchedAt: string | null;
  providers: MarketProvider[];
}

export function listMarketPrices(): Promise<MarketSnapshot> {
  return invoke<MarketSnapshot>("list_market_prices");
}

/** 抓取最新市场价格（models.dev，顺带更新汇率），写入缓存并返回新快照。 */
export function fetchMarketPrices(): Promise<MarketSnapshot> {
  return invoke<MarketSnapshot>("fetch_market_prices");
}

/** USD → CNY 汇率（市场页币种切换折算；从未获取过为 null，前端兜底 7.20）。 */
export interface MarketFx {
  rate: number | null;
  fetchedAt: string | null;
}

export function getMarketFx(): Promise<MarketFx> {
  return invoke<MarketFx>("get_market_fx");
}

/** 渠道模型标注价（已标注的行），与市场快照并排比较。 */
export interface ChannelPriceAnnotation {
  channelId: string;
  channelName: string;
  channelModelId: string;
  actualModelId: string;
  modelName: string | null;
  priceInputPer1m: number | null;
  priceOutputPer1m: number | null;
  priceCurrency: string;
  priceMultiplier: number;
  priceTiers: PriceTier[] | null;
  priceOffPeak: PriceOffPeak | null;
}

export function listChannelPriceAnnotations(): Promise<ChannelPriceAnnotation[]> {
  return invoke<ChannelPriceAnnotation[]>("list_channel_price_annotations");
}

// ------------------------------------------------------------------
// 自定义市场数据源（v0.25.0：NewAPI 类站点模型广场抓取）
// ------------------------------------------------------------------

/** 一条市场数据源（builtin 行只读）。 */
export interface MarketSourceRow {
  id: string;
  name: string;
  /** newapi / sub2api（TODO）/ builtin（内置只读） */
  kind: string;
  /** 模型广场页面地址 */
  baseUrl: string;
  enabled: boolean;
  builtin: boolean;
  /** 站点 favicon（data URL；null 用字母回退） */
  iconData: string | null;
  cachedModelCount: number | null;
  fetchedAt: string | null;
}

export interface MarketSourceInput {
  /** 编辑时提供，新建为 null */
  id: string | null;
  name: string;
  kind: string;
  baseUrl: string;
  enabled?: boolean | null;
}

export function listMarketSources(): Promise<MarketSourceRow[]> {
  return invoke<MarketSourceRow[]>("list_market_sources");
}

export function saveMarketSource(input: MarketSourceInput): Promise<string> {
  return invoke<string>("save_market_source", { input });
}

export function deleteMarketSource(sourceId: string): Promise<void> {
  return invoke<void>("delete_market_source", { sourceId });
}

export function toggleMarketSource(sourceId: string, enabled: boolean): Promise<void> {
  return invoke<void>("toggle_market_source", { sourceId, enabled });
}

/** 抓取 NewAPI 源（/api/pricing 换算 + favicon），返回该源快照。 */
export function fetchMarketSource(sourceId: string): Promise<MarketSnapshot> {
  return invoke<MarketSnapshot>("fetch_market_source", { sourceId });
}
