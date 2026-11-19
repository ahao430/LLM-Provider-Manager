import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ImagePlus, Send, Trash2, Upload, Wand2 } from "lucide-react";

import { ElapsedTimer } from "@/components/ElapsedTimer";
import { PageHeader } from "@/components/PageHeader";
import { ResponseText } from "@/components/ResponseText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  editImage,
  generateImage,
  MODEL_TYPE_LABELS,
  sendVisionRequest,
  type ArchivedImage,
  type ModelType,
  type VisionImagePayload,
} from "@/lib/tauri";
import { useChannelsForTest, useModelsForTest } from "@/features/api-testing/api";
import { useImageWorkbenchStore, type ImagePanelState } from "@/stores/imageWorkbench";

/** 测试中心共享的渠道选择状态（画图 / 图像理解各路由页独立持有）。 */
function useImageChannel() {
  const { data: channels = [] } = useChannelsForTest();
  const enabledChannels = useMemo(() => channels.filter((c) => c.enabled), [channels]);
  const [channelId, setChannelId] = useState("");
  const { data: channelModels = [] } = useModelsForTest(channelId);
  return { enabledChannels, channelId, setChannelId, channelModels };
}

/** 画图页（测试中心「画图」Tab）：图片生成 + 图片编辑。 */
export function ImageDrawingPage() {
  const { enabledChannels, channelId, setChannelId, channelModels } = useImageChannel();

  return (
    <>
      <PageHeader
        title="画图"
        description="图片生成（/images/generations）与编辑（/images/edits，multipart 原图 + 可选蒙版）。结果自动归档；URL 形态不自动下载。"
      />
      <Tabs defaultValue="generate">
        <TabsList>
          <TabsTrigger value="generate">图片生成</TabsTrigger>
          <TabsTrigger value="edit">图片编辑</TabsTrigger>
        </TabsList>

        <TabsContent value="generate">
          <ImageGenPanel
            channelId={channelId}
            onChannelChange={setChannelId}
            channels={enabledChannels}
            channelModels={channelModels}
          />
        </TabsContent>

        <TabsContent value="edit">
          <ImageEditPanel
            channelId={channelId}
            onChannelChange={setChannelId}
            channels={enabledChannels}
            channelModels={channelModels}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** 图像理解页（测试中心「图像理解」Tab）：多图提问（base64 原样发送）。 */
export function ImageVisionPage() {
  const { enabledChannels, channelId, setChannelId, channelModels } = useImageChannel();

  return (
    <>
      <PageHeader
        title="图像理解"
        description="上传 / 拖拽 / 粘贴本地图片（base64 原样发送）+ URL，多图提问；请求与响应完整归档。"
      />
      <VisionPanel
        channelId={channelId}
        onChannelChange={setChannelId}
        channels={enabledChannels}
        channelModels={channelModels}
      />
    </>
  );
}

function ChannelPicker({
  channelId,
  onChannelChange,
  channels,
}: {
  channelId: string;
  onChannelChange: (id: string) => void;
  channels: { id: string; name: string }[];
}) {
  return (
    <div className="max-w-md space-y-1.5">
      <Label>渠道 *</Label>
      <Select value={channelId} onValueChange={onChannelChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="选择启用的渠道" />
        </SelectTrigger>
        <SelectContent>
          {channels.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ModelPicker({
  models,
  value,
  onChange,
  disabled,
  onlyType,
}: {
  models: { id: string; actualModelId: string; modelType: ModelType; enabled: boolean }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** 仅显示该类型且已启用的模型（画图 / 图片编辑只提供图像模型） */
  onlyType?: ModelType;
}) {
  const candidates = useMemo(
    () => models.filter((m) => (!onlyType || m.modelType === onlyType) && m.enabled),
    [models, onlyType]
  );
  return (
    <div className="space-y-1.5">
      <Label>模型 *</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="渠道实际模型 ID" disabled={disabled} />
      {candidates.length > 0 ? (
        <div className="flex flex-wrap gap-1 pt-1">
          {candidates
            .filter((m) => m.actualModelId !== value)
            .map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onChange(m.actualModelId)}
                className="bg-muted hover:bg-accent rounded px-1.5 py-0.5 font-mono text-xs"
              >
                {m.actualModelId}
              </button>
            ))}
        </div>
      ) : onlyType && !disabled ? (
        <p className="text-muted-foreground text-xs">
          该渠道暂无已启用的「{MODEL_TYPE_LABELS[onlyType]}」类型模型（可在渠道详情「模型」页签标记）。
        </p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------
// 图片生成
// ------------------------------------------------------------------

function ImageGenPanel({
  channelId,
  onChannelChange,
  channels,
  channelModels,
}: {
  channelId: string;
  onChannelChange: (id: string) => void;
  channels: { id: string; name: string }[];
  channelModels: { id: string; actualModelId: string; modelType: ModelType; enabled: boolean }[];
}) {
  const navigate = useNavigate();
  // 画图状态入 store：跨页面切换（甚至整段路由离开）不丢；invoke 回调只写 store，卸载后也能落位
  const panel = useImageWorkbenchStore((s) => s.gen);
  const setForm = useImageWorkbenchStore((s) => s.setForm);
  const startRun = useImageWorkbenchStore((s) => s.startRun);
  const finishRun = useImageWorkbenchStore((s) => s.finishRun);
  const failRun = useImageWorkbenchStore((s) => s.failRun);
  const busy = panel.status === "running";
  const { model, prompt, size, count, responseFormat } = panel.form;

  // 模型为空时默认选中第一个已启用的图像模型（可手动改）
  useEffect(() => {
    if (model) return;
    const first = channelModels.find((m) => m.modelType === "image" && m.enabled);
    if (first) setForm("gen", { model: first.actualModelId });
  }, [channelModels, model, setForm]);

  async function handleGenerate() {
    if (!channelId || !model.trim() || !prompt.trim()) {
      toast.error("请填写渠道、模型与 Prompt");
      return;
    }
    startRun("gen");
    try {
      const res = await generateImage({
        channelId,
        model: model.trim(),
        prompt: prompt.trim(),
        size: size.trim() || null,
        n: count.trim() ? Number(count) : null,
        responseFormat,
        extraBody: null,
        customHeaders: [],
      });
      finishRun("gen", res);
      if (res.status === "success") {
        toast.success(`生成完成：${res.images.length} 张图片已归档`);
      } else {
        toast.error(`生成失败：${JSON.stringify(res.error)}`);
      }
    } catch (error) {
      failRun("gen", String(error));
      toast.error(`请求失败：${error}`);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>图片生成</CardTitle>
          <CardDescription>OpenAI Images 兼容（/images/generations）。b64_json 归档；url 仅记录。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChannelPicker channelId={channelId} onChannelChange={onChannelChange} channels={channels} />
          <ModelPicker models={channelModels} value={model} onChange={(v) => setForm("gen", { model: v })} disabled={!channelId} onlyType="image" />
          <div className="space-y-1.5">
            <Label>Prompt *</Label>
            <Textarea rows={4} value={prompt} onChange={(e) => setForm("gen", { prompt: e.target.value })} placeholder="描述要生成的图片…" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>尺寸</Label>
              <Input value={size} onChange={(e) => setForm("gen", { size: e.target.value })} placeholder="1024x1024" />
            </div>
            <div className="space-y-1.5">
              <Label>数量 n</Label>
              <Input type="number" value={count} onChange={(e) => setForm("gen", { count: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>返回格式</Label>
              <Select value={responseFormat} onValueChange={(v) => setForm("gen", { responseFormat: v === "url" ? "url" : "b64_json" })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="b64_json">b64_json（归档）</SelectItem>
                  <SelectItem value="url">url（仅记录）</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={handleGenerate} disabled={busy || !channelId}>
            <Send className="size-4" />
            {busy ? "生成中…" : "生成"}
          </Button>
        </CardContent>
      </Card>

      <ResultCard panel={panel} onOpenTrace={(id) => navigate(`/requests/${id}`)} />
    </div>
  );
}

// ------------------------------------------------------------------
// 图片编辑（multipart /images/edits）
// ------------------------------------------------------------------

function ImageEditPanel({
  channelId,
  onChannelChange,
  channels,
  channelModels,
}: {
  channelId: string;
  onChannelChange: (id: string) => void;
  channels: { id: string; name: string }[];
  channelModels: { id: string; actualModelId: string; modelType: ModelType; enabled: boolean }[];
}) {
  const navigate = useNavigate();
  // 编辑面板状态入 store：跨页面切换不丢；invoke 回调只写 store，卸载后也能落位
  const panel = useImageWorkbenchStore((s) => s.edit);
  const setForm = useImageWorkbenchStore((s) => s.setForm);
  const setEditFiles = useImageWorkbenchStore((s) => s.setEditFiles);
  const startRun = useImageWorkbenchStore((s) => s.startRun);
  const finishRun = useImageWorkbenchStore((s) => s.finishRun);
  const failRun = useImageWorkbenchStore((s) => s.failRun);
  const busy = panel.status === "running";
  const { model, prompt, size } = panel.form;
  const imagePreview = panel.imagePreview;
  const maskPreview = panel.maskPreview;

  // 模型为空时默认选中第一个已启用的图像模型（可手动改）
  useEffect(() => {
    if (model) return;
    const first = channelModels.find((m) => m.modelType === "image" && m.enabled);
    if (first) setForm("edit", { model: first.actualModelId });
  }, [channelModels, model, setForm]);

  function loadFile(file: File, isMask: boolean) {
    if (!file.type.startsWith("image/")) {
      toast.warning(`跳过非图片文件：${file.name}`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const [meta, data] = dataUrl.split(",");
      const mime = meta.slice(meta.indexOf(":") + 1, meta.indexOf(";"));
      if (isMask) {
        setEditFiles({ mask: { base64: data, mime }, maskPreview: dataUrl });
      } else {
        setEditFiles({ image: { base64: data, mime }, imagePreview: dataUrl });
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleEdit() {
    const image = panel.imageBase64;
    if (!channelId || !model.trim() || !prompt.trim() || !image) {
      toast.error("请填写渠道、模型、Prompt 并上传原图");
      return;
    }
    startRun("edit");
    try {
      const res = await editImage({
        channelId,
        model: model.trim(),
        prompt: prompt.trim(),
        imageBase64: image.base64,
        imageMime: image.mime,
        maskBase64: panel.maskBase64?.base64 ?? null,
        size: size.trim() || null,
        n: 1,
      });
      finishRun("edit", res);
      if (res.status === "success") {
        toast.success(`编辑完成：${res.images.length} 张结果已归档`);
      } else {
        toast.error(`编辑失败：${JSON.stringify(res.error)}`);
      }
    } catch (error) {
      failRun("edit", String(error));
      toast.error(`请求失败：${error}`);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="size-4" />
            图片编辑
          </CardTitle>
          <CardDescription>
            multipart /images/edits：上传原图（+ 可选蒙版）与编辑 Prompt；图片原样上传不压缩。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChannelPicker channelId={channelId} onChannelChange={onChannelChange} channels={channels} />
          <ModelPicker models={channelModels} value={model} onChange={(v) => setForm("edit", { model: v })} disabled={!channelId} onlyType="image" />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>原图 *</Label>
              {imagePreview ? (
                <div className="relative">
                  <img src={imagePreview} alt="原图" className="h-24 w-full rounded border object-cover" />
                  <button
                    type="button"
                    className="bg-background absolute -top-1.5 -right-1.5 rounded-full border p-0.5"
                    onClick={() => setEditFiles({ image: null, imagePreview: null })}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ) : (
                <label className="flex h-24 cursor-pointer items-center justify-center rounded border border-dashed text-xs">
                  <Upload className="mr-1 size-3" />
                  上传原图
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0], false)}
                  />
                </label>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>蒙版（可选）</Label>
              {maskPreview ? (
                <div className="relative">
                  <img src={maskPreview} alt="蒙版" className="h-24 w-full rounded border object-cover" />
                  <button
                    type="button"
                    className="bg-background absolute -top-1.5 -right-1.5 rounded-full border p-0.5"
                    onClick={() => setEditFiles({ mask: null, maskPreview: null })}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ) : (
                <label className="flex h-24 cursor-pointer items-center justify-center rounded border border-dashed text-xs">
                  <Upload className="mr-1 size-3" />
                  上传蒙版
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0], true)}
                  />
                </label>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>编辑 Prompt *</Label>
            <Textarea rows={3} value={prompt} onChange={(e) => setForm("edit", { prompt: e.target.value })} placeholder="描述要做的编辑…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>尺寸（可选）</Label>
              <Input value={size} onChange={(e) => setForm("edit", { size: e.target.value })} placeholder="1024x1024" />
            </div>
          </div>
          <Button onClick={handleEdit} disabled={busy || !channelId}>
            <Wand2 className="size-4" />
            {busy ? "编辑中…" : "执行编辑"}
          </Button>
        </CardContent>
      </Card>

      <ResultCard panel={panel} onOpenTrace={(id) => navigate(`/requests/${id}`)} />
    </div>
  );
}

// ------------------------------------------------------------------
// 通用结果卡片
// ------------------------------------------------------------------

function ResultCard({
  panel,
  onOpenTrace,
}: {
  panel: ImagePanelState;
  onOpenTrace: (traceId: string) => void;
}) {
  const { result, status, startedAt, finishedAt } = panel;
  const running = status === "running";
  if (!result && !running) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>结果</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground flex min-h-48 items-center justify-center rounded-lg border border-dashed text-sm">
            {status === "error" && panel.error ? `请求失败：${panel.error}` : "结果将在此显示并自动归档"}
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>结果</CardTitle>
        <CardDescription className="flex items-center gap-2">
          <Badge variant={running ? "secondary" : result!.status === "success" ? "default" : "destructive"}>
            {running ? "进行中" : result!.status}
          </Badge>
          <ElapsedTimer startedAt={startedAt} running={running} finishedAt={finishedAt} />
          {result ? (
            <button
              type="button"
              className="text-primary hover:underline text-xs"
              onClick={() => onOpenTrace(result.traceId)}
            >
              {result.traceId.slice(0, 8)}… 记录详情 →
            </button>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {running ? (
          <div className="text-muted-foreground flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm">
            <span className="animate-pulse">生成中，结果返回后自动加载…</span>
            <ElapsedTimer startedAt={startedAt} running={running} finishedAt={finishedAt} />
          </div>
        ) : result!.status === "success" ? (
          <div className="grid grid-cols-2 gap-3">
            {result!.images.map((img, i) => (
              <ArchivedImageCard key={i} image={img} />
            ))}
          </div>
        ) : (
          <pre className="text-destructive max-h-72 overflow-auto rounded-md border p-3 text-xs">
            {JSON.stringify(result!.error, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

function ArchivedImageCard({ image }: { image: ArchivedImage }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const attemptRef = useRef(false);

  async function load() {
    if (!image.filePath || dataUrl) return;
    attemptRef.current = true;
    setLoading(true);
    try {
      const { readArchivedImage } = await import("@/lib/tauri");
      setDataUrl(await readArchivedImage(image.filePath));
    } catch (error) {
      toast.error(`读取归档图片失败：${error}`);
    } finally {
      setLoading(false);
    }
  }

  // 返回即自动加载（不再需要手动点击）；读取失败时保留手动重试入口
  useEffect(() => {
    if (!image.filePath || attemptRef.current) return;
    void load();
  }, [image.filePath]);

  return (
    <div className="space-y-1 rounded-lg border p-2">
      {image.filePath ? (
        dataUrl ? (
          <img src={dataUrl} alt="generated" className="w-full rounded" />
        ) : loading ? (
          <div className="text-muted-foreground flex h-40 w-full items-center justify-center rounded border border-dashed text-xs">
            读取归档图片中…
          </div>
        ) : (
          <button
            type="button"
            onClick={load}
            className="text-muted-foreground hover:text-foreground flex h-40 w-full items-center justify-center rounded border border-dashed text-xs"
          >
            读取失败，点击重试
          </button>
        )
      ) : (
        <a
          href={image.url ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline block h-40 overflow-hidden rounded border border-dashed p-2 text-xs break-all"
        >
          url 形态（不自动下载）：{image.url}
        </a>
      )}
      {image.revisedPrompt ? (
        <p className="text-muted-foreground text-[10px]">revised: {image.revisedPrompt}</p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------
// 图片理解（Vision）
// ------------------------------------------------------------------

interface LocalImage {
  preview: string;
  payload: VisionImagePayload;
}

function VisionPanel({
  channelId,
  onChannelChange,
  channels,
  channelModels,
}: {
  channelId: string;
  onChannelChange: (id: string) => void;
  channels: { id: string; name: string }[];
  channelModels: { id: string; actualModelId: string; modelType: ModelType; enabled: boolean }[];
}) {
  const [model, setModel] = useState("");
  const [system, setSystem] = useState("");
  const [text, setText] = useState("");
  const [images, setImages] = useState<LocalImage[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ traceId: string; status: string; text: string; error: unknown } | null>(null);

  function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        const [meta, data] = dataUrl.split(",");
        const mime = meta.slice(meta.indexOf(":") + 1, meta.indexOf(";"));
        setImages((prev) => [...prev, { preview: dataUrl, payload: { kind: "base64", value: data, mediaType: mime } }]);
      };
      reader.readAsDataURL(file);
    }
  }

  async function handleSend() {
    if (!channelId || !model.trim()) {
      toast.error("请填写渠道与模型");
      return;
    }
    if (!text.trim() || images.length === 0) {
      toast.error("请输入文字或添加图片");
      return;
    }
    setBusy(true);
    try {
      // 协议自动：渠道 Anthropic 地址单独配置过则用 anthropic_messages
      const res = await sendVisionRequest({
        channelId,
        model: model.trim(),
        protocol: "openai_chat",
        system: system.trim() || null,
        text: text.trim(),
        images: images.map((i) => i.payload),
        maxTokens: null,
        customHeaders: [],
      });
      setResult({ traceId: res.traceId, status: res.status, text: res.preview.text, error: res.preview.error });
      if (res.status !== "success") toast.warning(`请求结束：${res.status}`);
      else toast.success("Vision 请求完成");
    } catch (error) {
      toast.error(`请求失败：${error}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>图片理解（Vision）</CardTitle>
          <CardDescription>拖拽 / 粘贴 / 选择本地图片（base64 原样发送）+ URL；多图。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChannelPicker channelId={channelId} onChannelChange={onChannelChange} channels={channels} />
          <ModelPicker models={channelModels} value={model} onChange={setModel} disabled={!channelId} />

          <div
            className="rounded-lg border border-dashed p-4 text-center"
            onDrop={(e) => {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }}
            onDragOver={(e) => e.preventDefault()}
            onPaste={(e) => {
              const items = e.clipboardData?.files;
              if (items && items.length > 0) addFiles(items);
            }}
            tabIndex={0}
          >
            <ImagePlus className="text-muted-foreground mx-auto size-6" />
            <p className="text-muted-foreground mt-1 text-xs">拖拽 / 粘贴图片到此处</p>
            <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-xs text-primary hover:underline">
              <Upload className="size-3.5" />
              或选择本地图片
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
            </label>
          </div>

          {images.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {images.map((img, i) => (
                <div key={i} className="relative">
                  <img src={img.preview} alt={`input-${i}`} className="size-20 rounded border object-cover" />
                  <Badge variant="secondary" className="absolute right-0 bottom-0 text-[9px]">
                    {img.payload.kind}
                  </Badge>
                  <button
                    type="button"
                    className="bg-background absolute -top-1.5 -right-1.5 rounded-full border p-0.5"
                    onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="或输入图片 URL" className="flex-1" />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const url = urlInput.trim();
                if (!url) return;
                setImages((prev) => [...prev, { preview: url, payload: { kind: "url", value: url, mediaType: null } }]);
                setUrlInput("");
              }}
            >
              添加 URL
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label>System Prompt</Label>
            <Textarea rows={2} value={system} onChange={(e) => setSystem(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>提问</Label>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="关于这些图片的问题…" />
          </div>
          <Button onClick={handleSend} disabled={busy || !channelId}>
            <Send className="size-4" />
            {busy ? "发送中…" : "发送"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>响应</CardTitle>
        </CardHeader>
        <CardContent>
          {!result ? (
            <div className="text-muted-foreground flex min-h-48 items-center justify-center rounded-lg border border-dashed text-sm">
              模型回答将在此显示
            </div>
          ) : result.error ? (
            <pre className="text-destructive max-h-72 overflow-auto rounded-md border p-3 text-xs">{JSON.stringify(result.error, null, 2)}</pre>
          ) : (
            <ResponseText content={result.text || ""} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
