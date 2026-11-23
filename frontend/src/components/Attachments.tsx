import { useRef, useState } from "react";
import { Download, File, FileImage, FileText, Trash2, UploadCloud } from "lucide-react";
import { openAttachment, useAttachmentMutations, useAttachments, useMe } from "@/hooks/queries";
import { useAppConfig } from "@/hooks/useRealtime";
import { bytes, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { confirmAction } from "./common";

const icon = (mime: string) => mime.startsWith("image/") ? <FileImage className="size-5 text-violet-500" />
  : mime.includes("pdf") || mime.startsWith("text/") ? <FileText className="size-5 text-sky-500" /> : <File className="text-muted-foreground size-5" />;

export function Attachments({ taskId, projectId, canUpload, canModerate }: { taskId: string; projectId: string; canUpload: boolean; canModerate: boolean }) {
  const { data = [], isLoading } = useAttachments(taskId);
  const { upload, remove } = useAttachmentMutations(taskId, projectId);
  const myId = useMe().data?.user.id;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const maxMb = useAppConfig().data?.uploads.maxMb ?? 25;

  const send = (files: FileList | null) => files?.length && upload.mutate([...files].slice(0, 10));

  return (
    <div className="space-y-3">
      {canUpload && (
        <div
          role="button" tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}
          onClick={() => input.current?.click()}
          className={cn("flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            over ? "border-primary bg-primary/5" : "hover:border-foreground/20 hover:bg-accent/50")}
        >
          {upload.isPending ? <Spinner className="size-6" /> : <UploadCloud className="text-muted-foreground size-6" />}
          <span className="font-medium">{upload.isPending ? "Uploading…" : "Drop files or click to upload"}</span>
          <span className="text-muted-foreground text-xs">Up to 10 files, {maxMb} MB each</span>
          <input ref={input} type="file" multiple hidden onChange={(e) => { send(e.target.files); e.target.value = ""; }} />
        </div>
      )}
      {isLoading ? <div className="flex justify-center py-4"><Spinner /></div>
        : !data.length ? <p className="text-muted-foreground py-2 text-center text-sm">No files attached.</p>
        : <ul className="divide-y rounded-lg border">
            {data.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                {icon(a.mimeType)}
                <button className="min-w-0 flex-1 text-left" onClick={() => openAttachment(a.id)}>
                  <span className="hover:text-primary block truncate text-sm font-medium">{a.filename}</span>
                  <span className="text-muted-foreground block text-xs">{bytes(a.sizeBytes)} · {a.uploader?.name ?? "Unknown"} · {timeAgo(a.createdAt)}</span>
                </button>
                <Button variant="ghost" size="icon-sm" aria-label="Download" onClick={() => openAttachment(a.id)}><Download /></Button>
                {(a.uploader?.id === myId || canModerate) && (
                  <Button variant="ghost" size="icon-sm" aria-label="Delete file" className="hover:text-destructive"
                    onClick={async () => (await confirmAction({ title: `Delete ${a.filename}?`, confirmLabel: "Delete", destructive: true })) && remove.mutate(a.id)}><Trash2 /></Button>
                )}
              </li>
            ))}
          </ul>}
    </div>
  );
}
