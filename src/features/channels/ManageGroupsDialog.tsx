import { useState } from "react";
import { toast } from "sonner";
import { Check, Pencil, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useChannelGroups, useCreateChannelGroup, useDeleteChannelGroup, useRenameChannelGroup } from "@/features/channels/api";

/** 分组管理：新建 / 行内重命名 / 删除（渠道回到未分组）。 */
export function ManageGroupsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: groups = [] } = useChannelGroups();
  const createGroup = useCreateChannelGroup();
  const renameGroup = useRenameChannelGroup();
  const deleteGroup = useDeleteChannelGroup();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  function handleCreate() {
    if (!newName.trim()) {
      toast.error("请输入分组名");
      return;
    }
    createGroup.mutate(newName.trim(), {
      onSuccess: () => {
        toast.success(`分组「${newName.trim()}」已创建`);
        setNewName("");
      },
      onError: (e) => toast.error(`创建失败：${e}`),
    });
  }

  function handleRename() {
    if (!editingId || !editingName.trim()) {
      setEditingId(null);
      return;
    }
    renameGroup.mutate(
      { id: editingId, name: editingName.trim() },
      {
        onSuccess: () => {
          toast.success("分组已重命名");
          setEditingId(null);
        },
        onError: (e) => toast.error(`重命名失败：${e}`),
      }
    );
  }

  function handleDelete(id: string, name: string) {
    if (!window.confirm(`删除分组「${name}」？该分组下的渠道将变为未分组。`)) return;
    deleteGroup.mutate(id, {
      onSuccess: () => toast.success(`分组「${name}」已删除`),
      onError: (e) => toast.error(`删除失败：${e}`),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>管理分组</DialogTitle>
          <DialogDescription>渠道分组用于列表 / 卡片视图分区与筛选；删除分组不会删除渠道。</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {groups.length === 0 ? (
            <p className="text-muted-foreground text-sm">还没有分组，先创建一个吧。</p>
          ) : (
            groups.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                {editingId === g.id ? (
                  <div className="flex flex-1 items-center gap-1.5">
                    <Input value={editingName} onChange={(e) => setEditingName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }} className="h-8" autoFocus />
                    <Button size="icon" variant="ghost" className="size-7" onClick={handleRename}>
                      <Check className="size-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-7" onClick={() => setEditingId(null)}>
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-1 items-center gap-1.5">
                    <span className="text-sm">{g.name}</span>
                  </div>
                )}
                {editingId === g.id ? null : (
                  <div className="flex items-center gap-0.5">
                    <Button size="icon" variant="ghost" className="size-7" title="重命名" onClick={() => { setEditingId(g.id); setEditingName(g.name); }}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-7" title="删除分组（渠道回到未分组）" onClick={() => handleDelete(g.id, g.name)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新分组名，如：上游中转站"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
          <Button onClick={handleCreate} disabled={createGroup.isPending}>
            创建
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
