import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ImageGenResult } from "@/lib/tauri";

/** 画图工作台单面板状态（生成 / 编辑共用同一结构）。 */
export type PanelStatus = "idle" | "running" | "done" | "error";

/** 面板表单字段（编辑面板不用 count / responseFormat，忽略即可）。 */
export interface ImageFormState {
  model: string;
  prompt: string;
  size: string;
  count: string;
  responseFormat: "b64_json" | "url";
}

export interface ImagePanelState {
  form: ImageFormState;
  /** idle=未发过；running=进行中（计时中）；done/error=已结束 */
  status: PanelStatus;
  startedAt: number | null;
  finishedAt: number | null;
  result: ImageGenResult | null;
  error: string | null;
  /** 编辑面板原图 / 蒙版（内存字段，不持久化：base64 体积大）。 */
  imageBase64: { base64: string; mime: string } | null;
  maskBase64: { base64: string; mime: string } | null;
  imagePreview: string | null;
  maskPreview: string | null;
}

interface ImageWorkbenchState {
  gen: ImagePanelState;
  edit: ImagePanelState;
  /** 更新面板表单字段。 */
  setForm: (panel: "gen" | "edit", patch: Partial<ImageFormState>) => void;
  /** 编辑面板的原图 / 蒙版文件（内存字段）。 */
  setEditFiles: (files: { image?: { base64: string; mime: string } | null; mask?: { base64: string; mime: string } | null; imagePreview?: string | null; maskPreview?: string | null }) => void;
  /** 面板开始一次请求（重置清空结果并开始计时）。 */
  startRun: (panel: "gen" | "edit") => void;
  /** 面板请求成功返回（无论业务成功失败，只要 invoke 返回了 ImageGenResult）。 */
  finishRun: (panel: "gen" | "edit", result: ImageGenResult) => void;
  /** 面板 invoke 本身抛错。 */
  failRun: (panel: "gen" | "edit", error: string) => void;
  /** 清空结果与计时（保留表单），回到初始态。 */
  resetPanel: (panel: "gen" | "edit") => void;
}

function initialPanel(): ImagePanelState {
  return {
    form: { model: "", prompt: "", size: "", count: "1", responseFormat: "b64_json" },
    status: "idle",
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
    imageBase64: null,
    maskBase64: null,
    imagePreview: null,
    maskPreview: null,
  };
}

/** 画图工作台跨页面状态（localStorage 持久化；base64 文件字段除外）。 */
export const useImageWorkbenchStore = create<ImageWorkbenchState>()(
  persist(
    (set) => ({
      gen: initialPanel(),
      edit: initialPanel(),
      setForm: (panel, patch) =>
        set((state) => ({
          [panel]: { ...state[panel], form: { ...state[panel].form, ...patch } },
        })),
      setEditFiles: (files) =>
        set((state) => ({
          edit: {
            ...state.edit,
            imageBase64: files.image !== undefined ? files.image : state.edit.imageBase64,
            maskBase64: files.mask !== undefined ? files.mask : state.edit.maskBase64,
            imagePreview: files.imagePreview !== undefined ? files.imagePreview : state.edit.imagePreview,
            maskPreview: files.maskPreview !== undefined ? files.maskPreview : state.edit.maskPreview,
          },
        })),
      startRun: (panel) =>
        set((state) => ({
          [panel]: {
            ...state[panel],
            status: "running",
            startedAt: Date.now(),
            finishedAt: null,
            result: null,
            error: null,
          },
        })),
      finishRun: (panel, result) =>
        set((state) => ({
          [panel]: {
            ...state[panel],
            status: result.status === "success" ? "done" : "error",
            finishedAt: Date.now(),
            result,
            error: null,
          },
        })),
      failRun: (panel, error) =>
        set((state) => ({
          [panel]: {
            ...state[panel],
            status: "error",
            finishedAt: Date.now(),
            result: null,
            error,
          },
        })),
      resetPanel: (panel) =>
        set((state) => ({
          [panel]: {
            ...state[panel],
            status: "idle",
            startedAt: null,
            finishedAt: null,
            result: null,
            error: null,
          },
        })),
    }),
    {
      name: "lcm-image-workbench",
      partialize: (state) => ({
        gen: { ...state.gen, imageBase64: null, maskBase64: null, imagePreview: null, maskPreview: null },
        edit: { ...state.edit, imageBase64: null, maskBase64: null, imagePreview: null, maskPreview: null },
      }),
    }
  )
);

