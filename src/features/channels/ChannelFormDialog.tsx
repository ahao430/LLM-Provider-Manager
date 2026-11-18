import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ChannelDetail, ChannelInput } from "@/lib/tauri";
import {
  useCreateChannel,
  useProviderTemplates,
  useProviders,
  useUpdateChannel,
} from "@/features/channels/api";

const channelFormSchema = z.object({
  name: z.string().min(1, "渠道名称不能为空"),
  providerId: z.string().min(1, "请选择服务商"),
  chatBaseUrl: z
    .string()
    .min(1, "Chat Base URL 不能为空")
    .refine((v) => /^https?:\/\//.test(v), "必须以 http:// 或 https:// 开头"),
  anthropicBaseUrl: z
    .string()
    .refine((v) => v.trim() === "" || /^https?:\/\//.test(v.trim()), "必须以 http(s):// 开头"),
  responsesBaseUrl: z
    .string()
    .refine((v) => v.trim() === "" || /^https?:\/\//.test(v.trim()), "必须以 http(s):// 开头"),
  officialUrl: z
    .string()
    .refine((v) => v.trim() === "" || /^https?:\/\//.test(v.trim()), "必须以 http(s):// 开头"),
  notes: z.string(),
  primaryCredential: z.string(),
});

type ChannelFormValues = z.infer<typeof channelFormSchema>;

const emptyValues: ChannelFormValues = {
  name: "",
  providerId: "",
  chatBaseUrl: "",
  anthropicBaseUrl: "",
  responsesBaseUrl: "",
  officialUrl: "",
  notes: "",
  primaryCredential: "",
};

function valuesFromDetail(detail: ChannelDetail): ChannelFormValues {
  return {
    name: detail.name,
    providerId: detail.providerId ?? "",
    chatBaseUrl: detail.chatBaseUrl,
    anthropicBaseUrl: detail.anthropicBaseUrl,
    responsesBaseUrl: detail.responsesBaseUrl,
    officialUrl: detail.externalLinks.find((l) => l.kind === "official")?.url ?? "",
    notes: detail.notes ?? "",
    primaryCredential: "",
  };
}

function toChannelInput(values: ChannelFormValues): ChannelInput {
  return {
    name: values.name,
    providerId: values.providerId || null,
    chatBaseUrl: values.chatBaseUrl.trim(),
    anthropicBaseUrl: values.anthropicBaseUrl.trim() || null,
    responsesBaseUrl: values.responsesBaseUrl.trim() || null,
    officialUrl: values.officialUrl.trim() || null,
    notes: values.notes.trim() || null,
    primaryCredential: values.primaryCredential.trim() ? values.primaryCredential.trim() : null,
  };
}

interface ChannelFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel?: ChannelDetail;
  onSaved?: (channelId: string) => void;
}

export function ChannelFormDialog({ open, onOpenChange, channel, onSaved }: ChannelFormDialogProps) {
  const isEdit = channel != null;
  const { data: providers = [] } = useProviders();
  const { data: templates = [] } = useProviderTemplates();
  const createMutation = useCreateChannel();
  const updateMutation = useUpdateChannel(channel?.id ?? "");
  const [showExtraUrls, setShowExtraUrls] = useState(false);

  const form = useForm<ChannelFormValues>({
    resolver: zodResolver(channelFormSchema),
    defaultValues: isEdit && channel ? valuesFromDetail(channel) : emptyValues,
  });

  useEffect(() => {
    if (open) {
      form.reset(isEdit && channel ? valuesFromDetail(channel) : emptyValues);
      setShowExtraUrls(
        isEdit && !!(channel?.anthropicBaseUrl || channel?.responsesBaseUrl)
      );
    }
  }, [open, isEdit, channel, form]);

  /** 新建时：选择服务商后预填模板默认地址（用户已手改过则不覆盖） */
  const handleProviderChange = (providerId: string) => {
    form.setValue("providerId", providerId);
    if (isEdit) return;
    const provider = providers.find((p) => p.id === providerId);
    const template = provider
      ? templates.find((t) => t.code === provider.code)
      : undefined;
    if (!template) return;
    const current = form.getValues("chatBaseUrl").trim();
    const isTemplateDefault = templates.some((t) => t.defaultBaseUrl === current);
    if (!current || isTemplateDefault) {
      form.setValue("chatBaseUrl", template.defaultBaseUrl);
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const row = isEdit
        ? await updateMutation.mutateAsync(toChannelInput(values))
        : await createMutation.mutateAsync(toChannelInput(values));
      toast.success(isEdit ? "渠道已更新" : `渠道「${row.name}」已创建`);
      onOpenChange(false);
      onSaved?.(row.id);
    } catch (error) {
      toast.error(`保存失败：${error}`);
    }
  });

  const busy = createMutation.isPending || updateMutation.isPending;
  const watchChat = form.watch("chatBaseUrl");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `编辑渠道 — ${channel?.name}` : "新建渠道"}</DialogTitle>
          <DialogDescription>
            认证方式按协议自动派生（Anthropic → x-api-key；OpenAI → Bearer）；凭证存系统凭证库。
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>渠道名称 *</FormLabel>
                    <FormControl>
                      <Input placeholder="如：百炼正式环境" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="providerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>服务商 *</FormLabel>
                    <Select value={field.value} onValueChange={handleProviderChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="选择服务商" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {providers.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="chatBaseUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Chat Completions Base URL *</FormLabel>
                  <FormControl>
                    <Input placeholder="https://api.example.com/v1" {...field} />
                  </FormControl>
                  <FormDescription>
                    主地址；工作台 / 模型获取 / 图片工作台 / Codex 启动使用此地址。
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
                onClick={() => setShowExtraUrls(!showExtraUrls)}
              >
                {showExtraUrls ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                Anthropic / Responses 专用地址（可选，默认与上方相同）
              </button>
              {showExtraUrls ? (
                <div className="mt-3 space-y-3">
                  <FormField
                    control={form.control}
                    name="anthropicBaseUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Anthropic Messages Base URL</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={watchChat || "https://anthropic.example.com"}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>留空 = 与 Chat 地址相同</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="responsesBaseUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>OpenAI Responses Base URL</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={watchChat || "https://api.example.com/v1"}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>留空 = 与 Chat 地址相同</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ) : null}
            </div>

            <FormField
              control={form.control}
              name="primaryCredential"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{isEdit ? "API Key（留空保持不变）" : "API Key"}</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="sk-..." autoComplete="off" {...field} />
                  </FormControl>
                  <FormDescription>
                    {isEdit && channel?.hasPrimaryCredential
                      ? `当前：${channel.primaryCredentialMasked}`
                      : "保存到系统凭证库（Keychain / Credential Manager）"}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="officialUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>官网链接（可选）</FormLabel>
                  <FormControl>
                    <Input placeholder="https://example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>备注</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="渠道说明…" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "保存中…" : isEdit ? "保存修改" : "创建渠道"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
